"""TASK-125: isolated PostgreSQL RLS/real concurrency checks, never a remote DB.

Run: python3 tests/postgres/library_harness.py
Requires local PostgreSQL binaries on PATH. Auth/Storage/Realtime are schema
stubs; this checks actual PostgreSQL roles/RLS/triggers, not Supabase HTTP APIs.
"""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import json
import shutil
import subprocess
import tempfile

REPO = Path(__file__).resolve().parents[2]
BOOTSTRAP = """
create role authenticated; create role anon;
create schema auth; create schema storage; create schema realtime;
create table auth.users(id uuid primary key,raw_user_meta_data jsonb,aud text,role text);
create function auth.uid() returns uuid language sql stable as $$
 select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
$$;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid default gen_random_uuid() primary key,bucket_id text references storage.buckets(id),name text,metadata jsonb,unique(bucket_id,name));
alter table storage.objects enable row level security;
create function storage.foldername(n text) returns text[] language sql immutable as $$
 select (string_to_array(n,'/'))[1:array_length(string_to_array(n,'/'),1)-1]
$$;
create table realtime.messages(topic text,extension text);
alter table realtime.messages enable row level security;
create function realtime.topic() returns text language sql stable as $$select current_setting('realtime.topic',true)$$;
create publication supabase_realtime;
grant usage on schema public,auth,storage,realtime to authenticated,anon;
grant select,insert,update,delete on storage.objects to authenticated;
"""


def main():
    for binary in ['initdb', 'pg_ctl', 'psql']:
        if not shutil.which(binary):
            raise SystemExit(f'Missing local {binary}; no database was contacted.')
    root = Path(tempfile.mkdtemp(prefix='rasputye-library-'))
    (root / 'socket').mkdir()
    started = False
    try:
        subprocess.run(['initdb', '-D', str(root / 'data'), '-A', 'trust', '--no-locale', '--encoding=UTF8'], check=True, capture_output=True)
        # No TCP listener. Socket path is unique, so parallel runs do not collide.
        subprocess.run(['pg_ctl', '-D', str(root / 'data'), '-l', str(root / 'postgres.log'), '-o',
                        f"-k {root / 'socket'} -h '' -p 55497", 'start', '-w'], check=True, capture_output=True)
        started = True
        args = ['psql', '-X', '-h', str(root / 'socket'), '-p', '55497', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-tA']

        def sql(text, check=True):
            result = subprocess.run(args, input=text, text=True, capture_output=True, timeout=30)
            if check and result.returncode:
                raise RuntimeError(result.stderr + '\n' + result.stdout[-5000:])
            return result

        sql(BOOTSTRAP)
        for migration in sorted((REPO / 'supabase/migrations').glob('*.sql')):
            sql(migration.read_text())
        suite = (REPO / 'supabase/tests/rls.sql').read_text()
        suite += """
select 'TOTAL_RLS='||count(*) from _r;
do $$begin
 if exists(select 1 from _r where not ok) then raise exception 'RLS failures'; end if;
end$$;
rollback;
"""
        result = sql(suite)
        count = next(line for line in result.stdout.splitlines() if line.startswith('TOTAL_RLS='))
        sql("""
insert into auth.users(id,raw_user_meta_data) values('00000000-0000-0000-0000-00000000000e','{"full_name":"Race test"}');
insert into public.creatures(id,owner_id,data)
 select 'race-'||g,'00000000-0000-0000-0000-00000000000e','{"name":"Race","source":"manual"}' from generate_series(1,499) g;
""")

        def race(index):
            return sql("""
begin;
set local role authenticated;
set local request.jwt.claims='{"sub":"00000000-0000-0000-0000-00000000000e","role":"authenticated"}';
insert into public.creatures(id,owner_id,data)
 values('race-extra-%s','00000000-0000-0000-0000-00000000000e','{"name":"Race extra","source":"manual"}');
select pg_sleep(0.3);
commit;
""" % index, check=False)

        with ThreadPoolExecutor(2) as pool:
            results = list(pool.map(race, [1, 2]))
        assert sorted(r.returncode for r in results) == [0, 3], [r.stderr for r in results]
        rejected = next(r for r in results if r.returncode != 0)
        assert 'creature_library_quota_used_check' in rejected.stderr, rejected.stderr
        totals = sql("""
select (select count(*) from public.creatures where owner_id='00000000-0000-0000-0000-00000000000e'),used
 from public.creature_library_quota where owner_id='00000000-0000-0000-0000-00000000000e';
""").stdout.strip()
        assert totals == '500|500', totals
        sql("delete from auth.users where id='00000000-0000-0000-0000-00000000000e';")
        assert sql('select count(*) from public.creature_library_quota;').stdout.strip() == '0'
        print(json.dumps({'rls': count, 'concurrent_inserts': 'one success, one quota rejection',
                          'rows_and_quota': totals, 'cascade_cleanup': 'passed',
                          'scope': 'isolated local PostgreSQL; Supabase service schemas stubbed'}, ensure_ascii=False))
    finally:
        if started:
            subprocess.run(['pg_ctl', '-D', str(root / 'data'), 'stop', '-m', 'fast', '-w'], check=True, capture_output=True)
        shutil.rmtree(root)


if __name__ == '__main__':
    main()
