#!/usr/bin/env python3
"""Бэкап базы Supabase с проверкой восстановления (#204). Запускает человек на своём компьютере.

    python3 tools/backup-db.py                 # спросит строку подключения (ввод скрыт)
    python3 tools/backup-db.py --out ~/Backups # папка для бэкапов (по умолчанию ~/DropDiceBackups)

Строка — Supabase → Connect → Direct → Session pooler (порт 5432) с паролем базы. Пароль не попадает
в аргументы процессов, вывод и файлы: он уходит в pg_dump через PGPASSWORD.

Что сохраняется (папка <out>/<ref проекта>/<время UTC>/, вне репозитория):
  app.dump       — схемы public и supabase_migrations целиком (структура и данные);
  platform.dump  — только данные auth.users, auth.identities, storage.buckets, storage.objects
                   (сами схемы auth/storage принадлежат Supabase и создаются проектом);
  manifest.json  — версия сервера, SHA-256 файлов, число строк: в живой базе, в архиве, после восстановления.
Файлы в бакетах (картинки карт, токенов, библиотеки) в дамп не входят — только их записи в storage.objects.

Проверка восстановления: оба архива читаются pg_restore; app.dump разворачивается в одноразовый
локальный PostgreSQL (те же заглушки Supabase, что в tests/postgres/library_harness.py), и число строк
каждой таблицы после восстановления должно совпасть с числом строк в архиве. Удалённую базу проверка
не трогает. Нужны pg_dump/pg_restore/initdb той же или более новой версии, чем сервер
(brew install postgresql@17; путь можно задать PG_BIN=/opt/homebrew/opt/postgresql@17/bin).
"""
from datetime import datetime, timezone
from getpass import getpass
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit, unquote
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / 'tests' / 'postgres'))
from library_harness import BOOTSTRAP  # noqa: E402  заглушки auth/storage/realtime

PLATFORM_TABLES = ['auth.users', 'auth.identities', 'storage.buckets', 'storage.objects']
APP_SCHEMAS = ['public', 'supabase_migrations']
# Ожидаемые ошибки восстановления в заглушку: схема public уже есть.
ALLOWED_RESTORE_ERRORS = [re.compile(r'schema "public" already exists')]


def binaries():
    candidates = [os.environ.get('PG_BIN'), '/opt/homebrew/opt/postgresql@17/bin', '/usr/local/opt/postgresql@17/bin',
                  '/usr/lib/postgresql/17/bin']
    for d in candidates:
        if d and Path(d, 'pg_dump').exists():
            return Path(d)
    found = shutil.which('pg_dump')
    if not found:
        raise SystemExit('Не найден pg_dump. Установите PostgreSQL 17: brew install postgresql@17')
    return Path(found).parent


def split_url(url):
    """postgresql://user:pass@host:port/db → (dsn без пароля, пароль, ref проекта)."""
    parts = urlsplit(url.strip())
    if parts.scheme not in ('postgres', 'postgresql') or not parts.hostname:
        raise SystemExit('Нужна строка вида postgresql://postgres.<ref>:<пароль>@<host>:5432/postgres')
    if '[YOUR-PASSWORD]' in url or not parts.password:
        raise SystemExit('В строке нет пароля: замените [YOUR-PASSWORD] на пароль базы (без квадратных скобок).')
    user = unquote(parts.username or 'postgres')
    host = parts.hostname + (f':{parts.port}' if parts.port else '')
    dsn = urlunsplit((parts.scheme, f'{user}@{host}', parts.path or '/postgres', parts.query, ''))
    ref = user.split('.', 1)[1] if '.' in user else (parts.hostname.split('.')[1] if parts.hostname.startswith('db.') else parts.hostname)
    return dsn, unquote(parts.password), re.sub(r'[^\w.-]', '_', ref)


def run(cmd, env=None, **kw):
    result = subprocess.run(cmd, env=env, text=True, capture_output=True, **kw)
    if result.returncode:
        raise SystemExit(f'{Path(cmd[0]).name} завершился с ошибкой:\n{result.stderr.strip()[-2000:]}')
    return result.stdout


def live_counts(psql, dsn, env):
    tables = run([psql, '-X', '-qtA', '-d', dsn, '-c',
                  "select quote_ident(table_schema)||'.'||quote_ident(table_name) from information_schema.tables "
                  "where table_type='BASE TABLE' and table_schema in ('public','supabase_migrations') "
                  "or (table_schema||'.'||table_name) in (" + ','.join(f"'{t}'" for t in PLATFORM_TABLES) + ") order by 1"],
                 env=env).split()
    if not tables:
        return {}
    query = ' union all '.join(f"select '{t}', count(*) from {t}" for t in tables)
    rows = run([psql, '-X', '-qtA', '-F', '|', '-d', dsn, '-c', query], env=env).splitlines()
    return {name.replace('"', ''): int(n) for name, n in (r.split('|') for r in rows if r)}


def archive_counts(pg_restore, path):
    """Число строк каждой таблицы в архиве: считаем строки блоков COPY в SQL-представлении данных."""
    counts, current = {}, None
    proc = subprocess.Popen([pg_restore, '-a', '-f', '-', str(path)], stdout=subprocess.PIPE, text=True)
    for line in proc.stdout:
        if current is None:
            m = re.match(r'COPY ([\w."]+) ', line)
            if m:
                current = m.group(1).replace('"', '')
                counts[current] = 0
        elif line == '\\.\n':
            current = None
        else:
            counts[current] += 1
    if proc.wait():
        raise SystemExit(f'pg_restore не прочитал архив {path.name}')
    return counts


def verify_restore(bin_dir, app_dump):
    """Разворачивает app.dump в одноразовый локальный PostgreSQL и возвращает число строк по таблицам."""
    root = Path(tempfile.mkdtemp(prefix='dd-restore-'))
    port = '55498'
    pg_ctl, psql = str(bin_dir / 'pg_ctl'), str(bin_dir / 'psql')
    local_env = {**os.environ, 'LC_ALL': 'C'}  # macOS: без явной локали PostgreSQL 17 не стартует
    started = False
    try:
        run([str(bin_dir / 'initdb'), '-D', str(root / 'data'), '-A', 'trust', '--no-locale', '--encoding=UTF8', '-U', 'postgres'], env=local_env)
        run([pg_ctl, '-D', str(root / 'data'), '-l', str(root / 'pg.log'), '-o',
             f"-c listen_addresses=127.0.0.1 -c unix_socket_directories='' -p {port}", 'start', '-w'], env=local_env)
        started = True
        dsn = f'postgresql://postgres@127.0.0.1:{port}/postgres'
        run([psql, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', dsn], input=BOOTSTRAP)
        restore = subprocess.run([str(bin_dir / 'pg_restore'), '--no-owner', '--no-privileges', '--section=pre-data',
                                  '--section=data', '-d', dsn, str(app_dump)], text=True, capture_output=True)
        errors = [l for l in restore.stderr.splitlines() if 'ERROR' in l and not any(p.search(l) for p in ALLOWED_RESTORE_ERRORS)]
        if errors:
            raise SystemExit('Восстановление в локальный PostgreSQL с ошибками:\n' + '\n'.join(errors[:20]))
        return live_counts(psql, dsn, None)
    finally:
        if started:
            subprocess.run([pg_ctl, '-D', str(root / 'data'), 'stop', '-m', 'fast'], capture_output=True, env=local_env)
        shutil.rmtree(root, ignore_errors=True)


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser(description='Бэкап базы Supabase с проверкой восстановления')
    ap.add_argument('--out', default=str(Path.home() / 'DropDiceBackups'), help='папка для бэкапов (не внутри репозитория)')
    args = ap.parse_args()

    out_root = Path(args.out).expanduser().resolve()
    if out_root == REPO or REPO in out_root.parents:
        raise SystemExit('Папка бэкапов внутри репозитория — выберите другую: данные базы не должны попасть в Git.')
    url = os.environ.get('BACKUP_DATABASE_URL') or getpass('Строка подключения (Session pooler, ввод скрыт): ')
    dsn, password, ref = split_url(url)
    bin_dir = binaries()
    pg_dump, pg_restore, psql = (str(bin_dir / b) for b in ('pg_dump', 'pg_restore', 'psql'))
    env = {**os.environ, 'PGPASSWORD': password, 'PGCONNECT_TIMEOUT': '15'}

    server = run([psql, '-X', '-qtA', '-d', dsn, '-c', 'show server_version_num'], env=env).strip()
    local = re.search(r'(\d+)(?:\.\d+)*', run([pg_dump, '--version'])).group(0)
    if int(local.split('.')[0]) < int(server) // 10000:
        raise SystemExit(f'pg_dump {local} старше сервера ({server}); нужен PostgreSQL {int(server) // 10000}+ (PG_BIN=…).')

    stamp = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H-%M-%SZ')
    folder = out_root / ref / stamp
    folder.mkdir(parents=True, exist_ok=False)
    os.chmod(folder, 0o700)
    print(f'Проект {ref}, PostgreSQL {server}, папка {folder}')

    counts = live_counts(psql, dsn, env)
    app_dump, platform_dump = folder / 'app.dump', folder / 'platform.dump'
    run([pg_dump, '-Fc', '-d', dsn, '-f', str(app_dump), *sum((['-n', s] for s in APP_SCHEMAS), [])], env=env)
    run([pg_dump, '-Fc', '-a', '-d', dsn, '-f', str(platform_dump), *sum((['-t', t] for t in PLATFORM_TABLES), [])], env=env)
    for f in (app_dump, platform_dump):
        os.chmod(f, 0o600)
    print('Дамп снят, проверяю восстановление…')

    in_app, in_platform = archive_counts(pg_restore, app_dump), archive_counts(pg_restore, platform_dump)
    restored = verify_restore(bin_dir, app_dump)
    mismatch = {t: (n, restored.get(t)) for t, n in in_app.items() if restored.get(t) != n}
    manifest = {
        'project': ref, 'created_utc': stamp, 'server_version_num': server, 'pg_dump': local,
        'files': {f.name: {'bytes': f.stat().st_size, 'sha256': sha256(f)} for f in (app_dump, platform_dump)},
        'rows_live_before_dump': counts, 'rows_in_archive': {**in_app, **in_platform}, 'rows_restored_locally': restored,
        'restore_check': 'ok' if not mismatch else {'mismatch': mismatch},
        'not_included': 'файлы бакетов Storage (только их записи в storage.objects)',
    }
    (folder / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
    os.chmod(folder / 'manifest.json', 0o600)
    if mismatch:
        raise SystemExit(f'Проверка восстановления НЕ прошла: {mismatch}. Файлы сохранены в {folder}')
    rows = sum(in_app.values())
    print(f'Готово: {len(in_app)} таблиц приложения, {rows} строк восстановлены локально и совпали с архивом; '
          f'платформа — {sum(in_platform.values())} строк. Папка: {folder}')


if __name__ == '__main__':
    main()
