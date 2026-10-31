#!/usr/bin/env python3
"""Изолированный PostgreSQL: миграции и RLS, без подключения к проекту Supabase.

Нужны initdb, pg_ctl и psql. Auth/Storage/Realtime здесь только минимальные схемы
для SQL-проверок; это не проверка PostgREST, JWT, загрузки файлов или Realtime.
"""
from pathlib import Path
import shutil
import subprocess
import tempfile
import json

ROOT = Path(__file__).resolve().parents[2]
BOOTSTRAP = r"""
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users(id uuid primary key, raw_user_meta_data jsonb default '{}', aud text, role text);
create function auth.uid() returns uuid language sql stable as $$
 select (nullif(current_setting('request.jwt.claims',true),'')::jsonb ->> 'sub')::uuid;
$$;
create schema storage;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,metadata jsonb,unique(bucket_id,name));
alter table storage.objects enable row level security;
grant select,insert,update,delete on storage.objects to authenticated;
create function storage.foldername(name text) returns text[] language sql immutable as $$
 select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1];
$$;
create schema realtime;
create table realtime.messages(id bigint,extension text,topic text);
alter table realtime.messages enable row level security;
create function realtime.topic() returns text language sql stable as $$ select current_setting('realtime.topic',true); $$;
grant usage on schema public,auth,storage,realtime to authenticated,anon;
create publication supabase_realtime;
"""


def concurrency_checks(psql, run):
    """Две реальные сессии: CAS, одинаковый ID операции и гонка постановки/архива."""
    master = '30000000-0000-0000-0000-000000000001'
    player = '30000000-0000-0000-0000-000000000002'
    run(psql, input=f"""
      insert into auth.users(id,raw_user_meta_data) values ('{master}','{{"full_name":"Race master"}}'),('{player}','{{"full_name":"Race player"}}');
      select set_config('request.jwt.claims','{{"sub":"{master}","role":"authenticated"}}',false);
      insert into public.campaigns(id,owner_id,name) values('c-race','{master}','Race');
      insert into public.campaign_members(campaign_id,user_id,role,status,character_id) values('c-race','{player}','player','active','ch-race');
      insert into public.characters(id,campaign_id,owner_id,data) values('ch-race','c-race','{player}','{{"hp":10,"hpMax":20,"tempHp":0,"conditions":[]}}');
      insert into public.scenes(id,campaign_id) values('s-race','c-race');
    """)
    def call(version, operation, kind='adjust'):
        return f"select public.character_command('c-race','ch-race',{version},'{operation}','{kind}','" + ('{"hp":-1}' if kind == 'adjust' else '{}') + "');"
    def race(statements):
        processes = []
        for statement in statements:
            args = psql + ['-qAt', '-v', 'VERBOSITY=verbose', '-c', 'begin;', '-c',
                f"select set_config('request.jwt.claims','{{\"sub\":\"{player}\",\"role\":\"authenticated\"}}',true); set local role authenticated;",
                '-c', statement, '-c', 'commit;']
            processes.append(subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True))
        outcomes = []
        for process in processes:
            stdout, stderr = process.communicate(timeout=30)
            outcomes.append((process.returncode, stdout, stderr))
        return outcomes
    operations = ['40000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000002']
    outcomes = race([call(0, op) for op in operations])
    assert sum(code == 0 for code, _, _ in outcomes) == 1, outcomes
    assert any(code and '40001' in error for code, _, error in outcomes), outcomes
    assert run(psql + ['-qAt', '-c', "select (data ->> 'hp') || ':' || sheet_version::text from public.characters where id = 'ch-race'"]).strip() == '9:1'
    print('concurrency OK: one stale writer rejected', flush=True)

    same = '40000000-0000-0000-0000-000000000003'
    outcomes = race([call(1, same), call(1, same)])
    assert all(code == 0 for code, _, _ in outcomes), outcomes
    replies = [json.loads(next(line for line in stdout.splitlines() if '"replayed"' in line)) for _, stdout, _ in outcomes]
    assert sorted(r['replayed'] for r in replies) == [False, True], replies
    assert run(psql + ['-qAt', '-c', "select (data ->> 'hp') || ':' || sheet_version::text from public.characters where id = 'ch-race'"]).strip() == '8:2'
    print('concurrency OK: same operation applied once', flush=True)

    edits = [('notes', 'A'), ('background', 'B')]
    statements = [f"select public.character_command('c-race','ch-race',2,'40000000-0000-0000-0000-00000000000{n+5}','patch','{json.dumps({key:value})}');" for n, (key, value) in enumerate(edits)]
    outcomes = race(statements)
    assert sum(code == 0 for code, _, _ in outcomes) == 1, outcomes
    loser = next(n for n, result in enumerate(outcomes) if result[0])
    assert '40001' in outcomes[loser][2], outcomes
    key, value = edits[loser]
    # Явная сверка/повтор с новой версией и новым ID, не слепое повторение старого объекта.
    retry = f"select public.character_command('c-race','ch-race',3,'40000000-0000-0000-0000-000000000007','patch','{json.dumps({key:value})}');"
    assert race([retry])[0][0] == 0
    assert run(psql + ['-qAt', '-c', "select (data ->> 'notes') || ':' || (data ->> 'background') || ':' || sheet_version::text from public.characters where id = 'ch-race'"]).strip() == 'A:B:4'
    print('concurrency OK: independent edits survive explicit rebase', flush=True)

    outcomes = race([
        call(4, '40000000-0000-0000-0000-000000000004', 'archive'),
        "insert into public.tokens(id,campaign_id,scene_id,character_id,data) values('t-race','c-race','s-race','ch-race','{\"kind\":\"hero\"}');",
    ])
    assert outcomes[0][0] == 0, outcomes
    assert outcomes[1][0] == 0 or 'P0001' in outcomes[1][2], outcomes
    assert run(psql + ['-qAt', '-c', "select (archived_at is not null)::text || ':' || (select count(*) from public.tokens where character_id = 'ch-race')::text from public.characters where id = 'ch-race'"]).strip() == 'true:0'
    print('concurrency OK: archive leaves no active token', flush=True)


def main():
    programs = {name: shutil.which(name) for name in ('initdb', 'pg_ctl', 'psql')}
    if not all(programs.values()):
        raise SystemExit('Нужны локальные initdb, pg_ctl и psql; удалённая БД не используется')
    with tempfile.TemporaryDirectory(prefix='rasputye-task004-', dir='/tmp') as folder:
        work = Path(folder)
        socket = work / 'socket'
        socket.mkdir(mode=0o700)
        cluster = work / 'cluster'
        def run(args, **kwargs):
            result = subprocess.run(args, capture_output=True, text=True, timeout=60, **kwargs)
            if result.returncode:
                raise RuntimeError(result.stderr + '\n' + result.stdout[-1800:])
            return result.stdout
        run([programs['initdb'], '-D', str(cluster), '-U', 'task004_admin', '--auth=trust', '--no-locale', '--encoding=UTF8'])
        try:
            run([programs['pg_ctl'], '-D', str(cluster), '-l', str(work / 'postgres.log'), '-o', f"-k {socket} -h '' -F -c wal_level=logical", '-w', 'start'])
            psql = [programs['psql'], '-X', '-h', str(socket), '-U', 'task004_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1']
            run(psql, input=BOOTSTRAP)
            migrations = sorted((ROOT / 'supabase/migrations').glob('*.sql'))
            for migration in migrations:
                run(psql + ['-f', str(migration)])
                print('migration OK:', migration.name, flush=True)
            output = run(psql + ['-q', '-f', str(ROOT / 'supabase/tests/rls.sql'), '-c',
                "do $$ declare failures text; begin select string_agg(test || ': ' || coalesce(info,''), E'\\n') into failures from _r where not ok; if failures is not null then raise exception 'RLS tests failed: %',failures; end if; end $$;",
                '-c', "select 'TASK004_RESULT=' || count(*) from _r;", '-c', 'rollback;'])
            print('\n'.join(line for line in output.splitlines() if 'TASK004_RESULT=' in line), flush=True)
            concurrency_checks(psql, run)
        finally:
            if (cluster / 'postmaster.pid').exists():
                run([programs['pg_ctl'], '-D', str(cluster), '-m', 'immediate', '-w', 'stop'])


if __name__ == '__main__':
    main()
