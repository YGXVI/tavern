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
SCENE_BEFORE = r"""
insert into auth.users(id) values ('50000000-0000-0000-0000-000000000001');
insert into public.campaigns(id, owner_id, name, data) values ('c-mig', '50000000-0000-0000-0000-000000000001', 'Перенос', '{"activeSceneId":"s-mig"}');
insert into public.scenes(id, campaign_id, data) values ('s-mig', 'c-mig', '{"note":"Тайна","walls":[{"id":"w1","a":{"x":0,"y":0},"b":{"x":1,"y":0},"kind":"secret","lockDc":18}]}'), ('s-mig2', 'c-mig', '{}');
"""
SCENE_AFTER = r"""
select not s.data ? 'note', s.data#>>'{walls,0,kind}' = 'wall', h.data#>>'{walls,w1,lockDc}' = '18', s.revealed and not (select revealed from public.scenes where id='s-mig2')
from public.scenes s join public.scene_hidden h on h.scene_id = s.id where s.id = 's-mig';
"""
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
      insert into public.scenes(id,campaign_id,revealed) values('s-race','c-race',true);
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


def create_checks(psql, run):
    """TASK-186 P4a: create_character_sheet — replay, conflicts, atomic claim, HP formula, two real sessions."""
    fixtures = json.loads((ROOT / 'supabase/tests/character_create_fixtures.json').read_text())
    master, player, other, outsider = ('50000000-0000-0000-0000-00000000000' + c for c in 'abcd')
    run(psql, input=f"""
      insert into auth.users(id,raw_user_meta_data) values ('{master}','{{"full_name":"M"}}'),('{player}','{{"full_name":"P"}}'),('{other}','{{"full_name":"O"}}'),('{outsider}','{{"full_name":"X"}}');
      select set_config('request.jwt.claims','{{"sub":"{master}","role":"authenticated"}}',false);
      insert into public.campaigns(id,owner_id,name) values('c-create','{master}','Create');
      insert into public.campaign_members(campaign_id,user_id,role,status) values('c-create','{player}','player','active'),('c-create','{other}','player','active');
    """)
    def q(sql):
        return run(psql + ['-qAt', '-c', sql]).strip()
    def call(who, fixture, payload=None, claim=True, operation=None, character=None):
        body = json.dumps(payload if payload is not None else fixture['data']).replace("'", "''")
        statement = (f"select public.create_character_sheet('c-create','{character or fixture['characterId']}',"
                     f"'{operation or fixture['operationId']}','{body}'::jsonb,{str(claim).lower()});")
        args = psql + ['-qAt', '-v', 'VERBOSITY=verbose', '-c', 'begin;', '-c',
            f"select set_config('request.jwt.claims','{{\"sub\":\"{who}\",\"role\":\"authenticated\"}}',true); set local role authenticated;",
            '-c', statement, '-c', 'commit;']
        result = subprocess.run(args, capture_output=True, text=True, timeout=30)
        reply = next((json.loads(line) for line in result.stdout.splitlines() if line.startswith('{')), None)
        return result.returncode, reply, result.stderr
    def rows():
        return q("select (select count(*) from public.characters where campaign_id='c-create') || ':' || (select count(*) from public.character_operations where campaign_id='c-create')")
    fighter = fixtures[0]
    code, reply, err = call(player, fighter)
    assert code == 0 and reply['ok'] and reply['replayed'] is False, err
    sheet = reply['sheet']
    assert sheet['ownerId'] == player and sheet['managed'] is True and sheet['data']['creation']['verified'] == 'client', sheet
    assert q(f"select character_id from public.campaign_members where campaign_id='c-create' and user_id='{player}'") == fighter['characterId']
    assert q(f"select kind from public.character_history where character_id='{fighter['characterId']}' order by version limit 1") == 'create'
    assert rows() == '1:1'
    code, again, err = call(player, fighter)
    assert code == 0 and again['replayed'] is True and again['sheet'] == sheet, (err, again)
    assert rows() == '1:1'
    print('create OK: claim, history, exact replay', flush=True)

    renamed = dict(fighter['data'], name='Другое имя')
    def refused(expect, *args, **kwargs):
        before = rows()
        code, reply, err = call(*args, **kwargs)
        assert code != 0 and expect in err, (expect, code, reply, err[-400:])
        assert rows() == before, 'nothing written on refusal'
    refused('22023', player, fighter, payload=renamed)                      # same operation, other payload
    refused('23505', player, fighter, operation='60000000-0000-4000-8000-000000000001')  # character id already used
    bad_hp = dict(fighter['data'], hpMax=fighter['data']['hpMax'] + 1, hp=fighter['data']['hp'] + 1)
    fresh = lambda n: dict(operation=f'60000000-0000-4000-8000-0000000000{n:02d}', character=f'70000000-0000-4000-8000-0000000000{n:02d}')
    refused('22023', player, fighter, payload=bad_hp, **fresh(2))
    refused('22023', player, fighter, payload=dict(fighter['data'], ownerId=other), **fresh(3))
    refused('22023', player, fighter, payload={k: v for k, v in fighter['data'].items() if k != 'creation'}, **fresh(4))
    refused('22023', player, fighter, payload=dict(fighter['data'], profile='creature'), **fresh(5))
    refused('22023', player, fighter, payload=dict(fighter['data'], deathSaves={'s': 5, 'f': 0}), **fresh(6))  # sheet guard, whole call rolls back
    refused('42501', outsider, fighter, **fresh(7))
    refused('42501', master, fighter, claim=True, **fresh(8))
    refused('22023', player, fighter, character='not-a-uuid', operation='60000000-0000-4000-8000-000000000009')
    print('create OK: conflicts, forbidden fields, HP, guard and rights refuse without writes', flush=True)

    for fixture in fixtures[1:]:
        code, reply, err = call(other if fixture is fixtures[1] else player, fixture)
        assert code == 0 and reply['sheet']['data']['hpMax'] == fixture['data']['hpMax'], (fixture['name'], err[-400:])
    assert q(f"select character_id from public.campaign_members where campaign_id='c-create' and user_id='{player}'") == fighter['characterId'], 'second hero keeps the main seat'
    print('create OK: sorcerer/cleric/multiclass/barbarian fixtures and HP formula', flush=True)

    racer = dict(fighter, characterId='80000000-0000-4000-8000-000000000001', operationId='80000000-0000-4000-8000-000000000002')
    def race(calls):
        processes = []
        for who, fixture, operation, character in calls:
            body = json.dumps(fixture['data']).replace("'", "''")
            statement = f"select public.create_character_sheet('c-create','{character}','{operation}','{body}'::jsonb,false);"
            processes.append(subprocess.Popen(psql + ['-qAt', '-v', 'VERBOSITY=verbose', '-c', 'begin;', '-c',
                f"select set_config('request.jwt.claims','{{\"sub\":\"{who}\",\"role\":\"authenticated\"}}',true); set local role authenticated;",
                '-c', statement, '-c', 'select pg_sleep(0.2);', '-c', 'commit;'], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True))
        return [(p.wait(30), *p.communicate()) for p in processes]
    outcomes = race([(other, racer, racer['operationId'], racer['characterId'])] * 2)
    assert all(code == 0 for code, _, _ in outcomes), outcomes
    replies = [json.loads(next(l for l in out.splitlines() if l.startswith('{'))) for _, out, _ in outcomes]
    assert sorted(r['replayed'] for r in replies) == [False, True], replies
    outcomes = race([(other, racer, '80000000-0000-4000-8000-000000000003', '80000000-0000-4000-8000-000000000009'),
                     (player, racer, '80000000-0000-4000-8000-000000000004', '80000000-0000-4000-8000-000000000009')])
    assert sorted(code == 0 for code, _, _ in outcomes) == [False, True] and any('23505' in e for _, _, e in outcomes), outcomes
    assert q("select count(*) from public.characters where id in ('80000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000009')") == '2'
    print('create OK: concurrent same operation applied once; concurrent same ID one winner', flush=True)


def level_up_checks(psql, run):
    """#202: level_up_character — рост на уровень, хиты сервера, повтор, версия, права и отказы без записи."""
    fixture = json.loads((ROOT / 'supabase/tests/character_level_up_fixture.json').read_text())
    created = next(f for f in json.loads((ROOT / 'supabase/tests/character_create_fixtures.json').read_text()) if f['name'] == fixture['from'])
    master, player, other = ('50000000-0000-0000-0000-00000000000' + c for c in 'abc')
    hero, op = '90000000-0000-4000-8000-000000000001', fixture['operationId']
    def as_user(who, statement):
        args = psql + ['-qAt', '-v', 'VERBOSITY=verbose', '-c', 'begin;', '-c',
            f"select set_config('request.jwt.claims','{{\"sub\":\"{who}\",\"role\":\"authenticated\"}}',true); set local role authenticated;",
            '-c', statement, '-c', 'commit;']
        result = subprocess.run(args, capture_output=True, text=True, timeout=30)
        reply = next((json.loads(line) for line in result.stdout.splitlines() if line.startswith('{')), None)
        return result.returncode, reply, result.stderr
    q = lambda sql: run(psql + ['-qAt', '-c', sql]).strip()
    body = lambda v: json.dumps(v).replace("'", "''")
    code, reply, err = as_user(player, f"select public.create_character_sheet('c-create','{hero}','90000000-0000-4000-8000-000000000002','{body(created['data'])}'::jsonb,false);")
    assert code == 0, err[-400:]
    def level_up(who, payload=None, version=None, operation=op, character=hero):
        v = version if version is not None else q(f"select sheet_version from public.characters where id='{character}'")
        return as_user(who, f"select public.level_up_character('c-create','{character}',{v},'{operation}','{body(payload or fixture['payload'])}'::jsonb);")
    state = lambda: q(f"select sheet_version || ':' || (data->>'level') || ':' || (data->>'hpMax') from public.characters where id='{hero}'")
    def refused(expect, *args, **kwargs):
        before = state()
        code, reply, err = level_up(*args, **kwargs)
        assert code != 0 and expect in err, (expect, code, reply, err[-400:])
        assert state() == before, 'nothing written on refusal'

    v0 = q(f"select sheet_version from public.characters where id='{hero}'")
    refused('40001', player, version=int(v0) + 5, operation='90000000-0000-4000-8000-000000000010')
    refused('42501', other, operation='90000000-0000-4000-8000-000000000011')
    two = json.loads(json.dumps(fixture['payload'])); two['creation']['levelHistory'].append(two['creation']['levelHistory'][-1])
    refused('22023', player, payload=two, operation='90000000-0000-4000-8000-000000000012')
    moved = json.loads(json.dumps(fixture['payload'])); moved['creation']['ancestry'] = {'raceId': 'srd51:race:elf', 'subraceId': None}
    refused('22023', player, payload=moved, operation='90000000-0000-4000-8000-000000000013')
    with_hp = json.loads(json.dumps(fixture['payload'])); with_hp['patch']['hpMax'] = 99
    refused('22023', player, payload=with_hp, operation='90000000-0000-4000-8000-000000000014')
    rewritten = json.loads(json.dumps(fixture['payload'])); rewritten['creation']['levelHistory'][0] = {'classId': 'srd51:class:wizard'}
    refused('22023', player, payload=rewritten, operation='90000000-0000-4000-8000-000000000015')
    print('level_up OK: stale version, rights, two levels, ancestry, hp and old levels refuse without writes', flush=True)

    hp_before = created['data']['hpMax']
    code, reply, err = level_up(player)
    assert code == 0 and reply['ok'] and reply['replayed'] is False and reply['hpGain'] == fixture['hpGain'], err[-400:]
    data = reply['sheet']['data']
    assert data['level'] == 2 and data['hpMax'] == hp_before + fixture['hpGain'] and data['hp'] == data['hpMax'], data
    assert len(data['creation']['levelHistory']) == 2 and data['creation']['verified'] == 'client'
    assert q(f"select kind from public.character_history where character_id='{hero}' order by version desc limit 1") == 'level_up'
    after = state()
    code, again, err = level_up(player, version=v0)
    assert code == 0 and again['replayed'] is True and state() == after, err[-400:]
    refused('22023', player, payload=two, version=v0)  # тот же operationId, другой запрос
    print('level_up OK: level 2, server HP gain, history, exact replay', flush=True)

    # Простое повышение старого героя (без creation): только уровень, классы и кости; хиты считает сервер.
    old = '90000000-0000-4000-8000-000000000020'
    legacy = {'name': 'Торин', 'classId': 'fighter', 'className': 'Воин', 'level': 5, 'stats': {'str': 16, 'dex': 12, 'con': 16, 'int': 10, 'wis': 12, 'cha': 8}, 'hp': 30, 'hpMax': 44}
    code, _, err = as_user(player, f"insert into public.characters(id,campaign_id,owner_id,data) values('{old}','c-create','{player}','{body(legacy)}'::jsonb);")
    assert code == 0, err[-400:]
    simple = {'patch': {'level': 6, 'classes': [{'ref': 'srd51:class:fighter', 'levels': 6}], 'hitDicePools': [{'id': 'p1', 'name': 'd10', 'die': 10, 'total': 6, 'spent': 0}]}}
    old_state = lambda: q(f"select sheet_version || ':' || (data->>'level') || ':' || (data->>'hpMax') from public.characters where id='{old}'")
    def refused_old(expect, payload, operation):
        before = old_state()
        code, reply, err = level_up(player, payload=payload, operation=operation, character=old)
        assert code != 0 and expect in err, (expect, code, reply, err[-400:])
        assert old_state() == before, 'nothing written on refusal'
    refused_old('22023', {'patch': dict(simple['patch'], stats={'con': 20})}, '90000000-0000-4000-8000-000000000021')
    refused_old('22023', {'patch': dict(simple['patch'], level=7, classes=[{'ref': 'srd51:class:fighter', 'levels': 7}])}, '90000000-0000-4000-8000-000000000022')
    refused_old('22023', {'patch': dict(simple['patch'], classes=[{'ref': 'srd51:class:wizard', 'levels': 6}])}, '90000000-0000-4000-8000-000000000023')
    refused_old('22023', {'creation': fixture['payload']['creation'], 'patch': simple['patch']}, '90000000-0000-4000-8000-000000000024')
    code, reply, err = level_up(player, payload=simple, operation='90000000-0000-4000-8000-000000000025', character=old)
    assert code == 0 and reply['hpGain'] == 9, err[-400:]
    data = reply['sheet']['data']
    assert data['level'] == 6 and data['hpMax'] == 53 and data['hp'] == 39 and 'creation' not in data, data
    assert q(f"select sheet_managed from public.characters where id='{old}'") == 't', 'after a command the sheet is managed'
    multi = {'patch': {'level': 7, 'classes': [{'ref': 'srd51:class:fighter', 'levels': 6}, {'ref': 'srd51:class:wizard', 'levels': 1}],
                       'hitDicePools': [{'id': 'p1', 'name': 'd10', 'die': 10, 'total': 6, 'spent': 0}, {'id': 'p2', 'name': 'd6', 'die': 6, 'total': 1, 'spent': 0}]}}
    code, reply, err = level_up(player, payload=multi, operation='90000000-0000-4000-8000-000000000026', character=old)
    assert code == 0 and reply['hpGain'] == 7 and reply['sheet']['data']['hpMax'] == 60, err[-400:]  # d6: 4 + 3
    print('level_up OK: simple level-up for legacy heroes (class, multiclass, server HP) and refusals', flush=True)


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
                # Перенос данных проверяем на данных: сцена с тайным, созданная до миграции (на пустой базе ошибка не видна).
                if migration.name.startswith('20261106160000'):
                    run(psql + ['-c', SCENE_BEFORE])
                run(psql + ['-f', str(migration)])
                if migration.name.startswith('20261106160000'):
                    out = run(psql + ['-At', '-c', SCENE_AFTER])
                    assert out.strip().endswith('t|t|t|t'), out
                    run(psql + ['-c', "delete from public.campaigns where id='c-mig'"])
                    print('scene migration OK: existing secret door, lock DC, note and active scene')
                print('migration OK:', migration.name, flush=True)
            output = run(psql + ['-q', '-f', str(ROOT / 'supabase/tests/rls.sql'), '-c',
                "do $$ declare failures text; begin select string_agg(test || ': ' || coalesce(info,''), E'\\n') into failures from _r where not ok; if failures is not null then raise exception 'RLS tests failed: %',failures; end if; end $$;",
                '-c', "select 'TASK004_RESULT=' || count(*) from _r;", '-c', 'rollback;'])
            print('\n'.join(line for line in output.splitlines() if 'TASK004_RESULT=' in line), flush=True)
            concurrency_checks(psql, run)
            create_checks(psql, run)
            level_up_checks(psql, run)
        finally:
            if (cluster / 'postmaster.pid').exists():
                run([programs['pg_ctl'], '-D', str(cluster), '-m', 'immediate', '-w', 'stop'])


if __name__ == '__main__':
    main()
