"""TASK-129: real multi-connection quota/CAS checks in library_harness's local DB."""
from concurrent.futures import ThreadPoolExecutor
import json


def run_catalogue_checks(sql):
    uid = '00000000-0000-0000-0000-00000000000f'
    feature = {'edition': '5e-2014', 'source': {'kind': 'manual'}, 'name': {'ru': 'Личное', 'en': None},
               'kind': 'feat', 'text': {'ru': 'Мой текст', 'en': None}, 'scope': {}, 'level': None,
               'prerequisiteText': None, 'actionType': None}
    item = {'edition': '5e-2014', 'source': {'kind': 'manual'}, 'name': {'ru': 'Предмет', 'en': None},
            'description': {'ru': 'Из личной книги', 'en': []}, 'technical': {}, 'variants': [], 'attunement': {'required': None}}

    def literal(value):
        return '$fixture$' + json.dumps(value, ensure_ascii=False) + '$fixture$::jsonb'

    sql(f"""
insert into auth.users(id,raw_user_meta_data) values('{uid}','{{"full_name":"Catalogue race"}}');
insert into public.user_catalogue_entries(owner_id,id,kind,data,revision)
 select '{uid}','seed-'||g,case when g%2=1 then 'feature' else 'magic_item' end,
 case when g%2=1 then {literal(feature)} else {literal(item)} end,1 from generate_series(1,499) g;
""")

    def authenticated(statement):
        return f"""
begin;
set local role authenticated;
set local request.jwt.claims='{{"sub":"{uid}","role":"authenticated"}}';
{statement}
select pg_sleep(0.3);
commit;
"""

    def create(index):
        kind = 'feature' if index == 1 else 'magic_item'
        data = feature if kind == 'feature' else item
        return sql(authenticated(f"select public.save_catalogue_entry('race-{index}','{kind}',{literal(data)},0,'{uid}');"), check=False)

    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(create, [1, 2]))
    assert sorted(r.returncode for r in results) == [0, 3], [r.stderr for r in results]
    assert 'catalogue_entry_quota_used_check' in next(r.stderr for r in results if r.returncode), [r.stderr for r in results]
    totals = sql(f"select (select count(*) from public.user_catalogue_entries where owner_id='{uid}'),used from public.catalogue_entry_quota where owner_id='{uid}';").stdout.strip()
    assert totals == '500|500', totals

    def update(index):
        data = {**feature, 'notes': f'writer-{index}'}
        return sql(authenticated(f"select public.save_catalogue_entry('seed-1','feature',{literal(data)},1,'{uid}');"), check=False)

    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(update, [1, 2]))
    assert sorted(r.returncode for r in results) == [0, 3], [r.stderr for r in results]
    assert 'Запись изменена или удалена' in next(r.stderr for r in results if r.returncode), [r.stderr for r in results]
    state = sql(f"select revision,data->>'notes' from public.user_catalogue_entries where owner_id='{uid}' and id='seed-1';").stdout.strip()
    assert state in ['2|writer-1', '2|writer-2'], state
    sql(authenticated(f"""
do $check$ begin
 begin
  perform public.delete_catalogue_entry('seed-1',1,'{uid}');
  raise exception 'Expected a stale-revision conflict';
 exception when sqlstate '40001' then null;
 end;
end $check$;
select public.delete_catalogue_entry('seed-1',2,'{uid}');
"""))
    assert sql(f"select used from public.catalogue_entry_quota where owner_id='{uid}';").stdout.strip() == '499'
    sql(f"delete from auth.users where id='{uid}';")
    assert sql('select count(*) from public.catalogue_entry_quota;').stdout.strip() == '0'
    assert sql('select count(*) from public.user_catalogue_entries;').stdout.strip() == '0'
    return {'quota': totals, 'two_kinds': 'shared quota', 'concurrent_cas': state,
            'stale_delete': '40001; current revision succeeds', 'cascade': 'passed'}
