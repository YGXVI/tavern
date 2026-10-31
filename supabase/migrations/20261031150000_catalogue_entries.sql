-- TASK-129 B: private manual feature/item templates. No campaign sync/Character.
-- Version/order checked in #153 (6540677615) and all published refs. No production apply here.
create function public.catalogue_manual_data_valid(k text,v jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare field text; value jsonb;
begin
  if k not in ('feature','magic_item') or jsonb_typeof(v) <> 'object' then return false; end if;
  if v->>'edition' is distinct from '5e-2014' or v->'source'->>'kind' is distinct from 'manual'
    or v ?| array['id','ownerId','revision','updatedAt'] or jsonb_typeof(v->'name') is distinct from 'object' then return false; end if;
  foreach field in array array['ru','en'] loop
    if not(v->'name' ? field) or jsonb_typeof(v->'name'->field) not in ('string','null') then return false; end if;
    if length(v->'name'->>field)>200 then return false; end if;
  end loop;
  if coalesce(length(btrim(v->'name'->>'ru')),0)=0 and coalesce(length(btrim(v->'name'->>'en')),0)=0 then return false; end if;
  if k='feature' then
    if v->>'kind' is null or v->>'kind' not in ('class_feature','subclass_feature','racial_trait','feat','option')
      or jsonb_typeof(v->'text') is distinct from 'object' or jsonb_typeof(v->'scope') is distinct from 'object' then return false; end if;
    foreach field in array array['ru','en'] loop
      if not(v->'text' ? field) or jsonb_typeof(v->'text'->field) not in ('string','null') then return false; end if;
    end loop;
    if coalesce(length(btrim(v->'text'->>'ru')),0)=0 and coalesce(length(btrim(v->'text'->>'en')),0)=0 then return false; end if;
    for value in select x.value from jsonb_each(v->'scope') x loop
      if jsonb_typeof(value) <> 'string' or length(btrim(value#>>'{}'))=0 then return false; end if;
    end loop;
    if not(v ?& array['level','prerequisiteText','actionType']) then return false; end if;
    if jsonb_typeof(v->'level') <> 'null' then
      if jsonb_typeof(v->'level') <> 'number' then return false; end if;
      if (v->>'level')::numeric not between 1 and 20 or trunc((v->>'level')::numeric) <> (v->>'level')::numeric then return false; end if;
    end if;
    if jsonb_typeof(v->'prerequisiteText') not in ('string','null') then return false; end if;
    if jsonb_typeof(v->'actionType') <> 'null' and v->>'actionType' not in ('action','bonus_action','reaction','passive','special') then return false; end if;
  else
    if jsonb_typeof(v->'description') is distinct from 'object' or jsonb_typeof(v->'technical') is distinct from 'object'
      or jsonb_typeof(v->'attunement') is distinct from 'object' or jsonb_typeof(v->'variants') is distinct from 'array' then return false; end if;
    if not(v->'description' ?& array['ru','en']) or jsonb_typeof(v->'description'->'ru') not in ('string','null')
      or jsonb_typeof(v->'description'->'en') not in ('array','null') then return false; end if;
    if jsonb_typeof(v->'description'->'en')='array' then
      for value in select jsonb_array_elements(v->'description'->'en') loop
        if jsonb_typeof(value)<>'string' then return false; end if;
      end loop;
    end if;
    if coalesce(length(btrim(v->'description'->>'ru')),0)=0 and not exists(
      select 1 from jsonb_array_elements(case when jsonb_typeof(v->'description'->'en')='array' then v->'description'->'en' else '[]'::jsonb end) e
      where length(btrim(e#>>'{}'))>0) then return false; end if;
    if not(v->'attunement' ? 'required') or jsonb_typeof(v->'attunement'->'required') not in ('boolean','null') then return false; end if;
  end if;
  return true;
end $$;

create table public.user_catalogue_entries (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  id text not null check(id ~ '^[A-Za-z0-9_:-]{1,128}$'),
  kind text not null check(kind in ('feature','magic_item')),
  data jsonb not null,
  revision bigint not null check(revision between 1 and 9007199254740991),
  updated_at timestamptz not null default now(),
  primary key(owner_id,id),
  constraint catalogue_entry_data_valid check(coalesce(public.catalogue_manual_data_valid(kind,data),false)),
  constraint catalogue_entry_data_64k check(octet_length(convert_to(data::text,'UTF8'))<=65536)
);
alter table public.user_catalogue_entries enable row level security;
create policy catalogue_entries_read on public.user_catalogue_entries for select to authenticated
  using(owner_id=(select auth.uid()));
revoke all on public.user_catalogue_entries from public,anon,authenticated;
grant select on public.user_catalogue_entries to authenticated;

create table public.catalogue_entry_quota (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  used integer not null check(used between 0 and 500)
);
alter table public.catalogue_entry_quota enable row level security;
revoke all on public.catalogue_entry_quota from public,anon,authenticated;
create function public.catalogue_quota_change() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='INSERT' then
    insert into public.catalogue_entry_quota(owner_id,used) values(new.owner_id,1)
      on conflict(owner_id) do update set used=public.catalogue_entry_quota.used+1;
  else
    update public.catalogue_entry_quota set used=used-1 where owner_id=old.owner_id;
  end if;
  return null;
end $$;
create trigger catalogue_entry_quota after insert or delete on public.user_catalogue_entries
  for each row execute function public.catalogue_quota_change();

create function public.save_catalogue_entry(p_id text,p_kind text,p_data jsonb,p_revision bigint,p_owner uuid)
returns setof public.user_catalogue_entries language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); saved public.user_catalogue_entries;
begin
  if uid is null or p_owner is distinct from uid then raise exception 'Пользователь изменился; войдите снова' using errcode='42501'; end if;
  if p_revision is null or p_revision<0 or p_revision>=9007199254740991 then
    raise exception 'Некорректная ожидаемая ревизия' using errcode='40001';
  end if;
  if p_revision=0 then
    insert into public.user_catalogue_entries(owner_id,id,kind,data,revision)
      values(uid,p_id,p_kind,p_data,1) on conflict(owner_id,id) do nothing returning * into saved;
  else
    update public.user_catalogue_entries set data=p_data,revision=revision+1,updated_at=now()
      where owner_id=uid and id=p_id and kind=p_kind and revision=p_revision returning * into saved;
  end if;
  if saved.id is null then raise exception 'Запись изменена или удалена; обновите данные' using errcode='40001'; end if;
  return next saved;
end $$;
create function public.delete_catalogue_entry(p_id text,p_revision bigint,p_owner uuid) returns text
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); removed text;
begin
  if uid is null or p_owner is distinct from uid then raise exception 'Пользователь изменился; войдите снова' using errcode='42501'; end if;
  delete from public.user_catalogue_entries where owner_id=uid and id=p_id and revision=p_revision returning id into removed;
  if removed is null then raise exception 'Запись изменена или удалена; обновите данные' using errcode='40001'; end if;
  return removed;
end $$;
revoke execute on function public.catalogue_manual_data_valid(text,jsonb),public.catalogue_quota_change(),
  public.save_catalogue_entry(text,text,jsonb,bigint,uuid),public.delete_catalogue_entry(text,bigint,uuid) from public,anon,authenticated;
grant execute on function public.save_catalogue_entry(text,text,jsonb,bigint,uuid),public.delete_catalogue_entry(text,bigint,uuid) to authenticated;
