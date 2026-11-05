-- TASK-125 / TASK-097: personal library only. No token/sync/scene changes.
create table public.creatures (
  id text not null check (id ~ '^[A-Za-z0-9_:-]{1,128}$'),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key(owner_id,id),
  constraint creature_data_object check (coalesce(jsonb_typeof(data) = 'object'
    and jsonb_typeof(data->'name') = 'string' and length(btrim(data->>'name')) between 1 and 200
    and data->>'source' in ('manual', 'image')
    and (data->>'source' <> 'image' or (jsonb_typeof(data->'statblockImage') = 'string' and length(btrim(data->>'statblockImage')) > 0))
    and not (data ?| array['id','ownerId','updatedAt']), false)),
  constraint creature_data_64k check (octet_length(convert_to(data::text, 'UTF8')) <= 65536)
);
-- PK already indexes owner_id; a private ID is never globally unique.

-- Private counter: AFTER INSERT avoids counting an upsert UPDATE as a new entry.
-- Atomic row increment and CHECK serialize concurrent quota consumption at every isolation level.
create table public.creature_library_quota (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  used integer not null check (used between 0 and 500)
);
alter table public.creature_library_quota enable row level security;
revoke all on public.creature_library_quota from public, anon, authenticated;

create function public.creature_quota_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.creature_library_quota(owner_id,used) values(new.owner_id,1)
      on conflict(owner_id) do update set used = public.creature_library_quota.used + 1;
  else
    update public.creature_library_quota set used = used - 1 where owner_id = old.owner_id;
  end if;
  return null;
end $$;
create trigger creatures_quota after insert or delete on public.creatures
  for each row execute function public.creature_quota_change();

create function public.creature_identity_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.id is distinct from old.id or new.owner_id is distinct from old.owner_id then
    raise exception 'Идентификатор и владелец шаблона неизменны' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger creatures_guard before update on public.creatures
  for each row execute function public.creature_identity_guard();

alter table public.creatures enable row level security;
create policy creatures_owner on public.creatures for all to authenticated
  using(owner_id = (select auth.uid())) with check(owner_id = (select auth.uid()));
revoke all on public.creatures from public, anon;
grant select,insert,update,delete on public.creatures to authenticated;

create table public.campaign_creatures (
  campaign_id text not null references public.campaigns(id) on delete cascade,
  id text not null check(id ~ '^[A-Za-z0-9_:-]{1,128}$'),
  owner_id uuid references public.profiles(id) on delete set null,
  source_id text, -- provenance only: no FK to a private template
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key(campaign_id,id),
  constraint campaign_creature_data check(coalesce(jsonb_typeof(data) = 'object'
    and jsonb_typeof(data->'name') = 'string' and length(btrim(data->>'name')) between 1 and 200
    and data->>'source' in ('manual','image')
    and (data->>'source' <> 'image' or (jsonb_typeof(data->'statblockImage') = 'string' and length(btrim(data->>'statblockImage')) > 0))
    and not(data ?| array['id','ownerId','updatedAt']),false)),
  constraint campaign_creature_64k check(octet_length(convert_to(data::text, 'UTF8')) <= 65536),
  constraint campaign_creature_images check(coalesce(data->>'img','') not like 'library:%'
    and coalesce(data->>'statblockImage','') not like 'library:%')
);
create index campaign_creatures_owner on public.campaign_creatures(campaign_id,owner_id);
create trigger campaign_creatures_touch before update on public.campaign_creatures
  for each row execute function public.touch_updated_at();
alter table public.campaign_creatures enable row level security;
create policy campaign_creatures_read on public.campaign_creatures for select to authenticated
  using(public.is_master(campaign_id) or (public.is_member(campaign_id) and owner_id = (select auth.uid())));
create policy campaign_creatures_insert on public.campaign_creatures for insert to authenticated
  with check(public.is_master(campaign_id) or (public.is_member(campaign_id) and owner_id = (select auth.uid())));
create policy campaign_creatures_update on public.campaign_creatures for update to authenticated
  using(public.is_master(campaign_id)) with check(public.is_master(campaign_id));
create policy campaign_creatures_delete on public.campaign_creatures for delete to authenticated
  using(public.is_master(campaign_id));
revoke all on public.campaign_creatures from public, anon;
grant select,insert,update,delete on public.campaign_creatures to authenticated;
revoke execute on function public.creature_quota_change(), public.creature_identity_guard() from public, anon, authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values('library','library',false,5242880,array['image/png','image/jpeg','image/webp']);
create policy library_read on storage.objects for select to authenticated
  using(bucket_id = 'library' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy library_insert on storage.objects for insert to authenticated
  with check(bucket_id = 'library' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy library_update on storage.objects for update to authenticated
  using(bucket_id = 'library' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check(bucket_id = 'library' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy library_delete on storage.objects for delete to authenticated
  using(bucket_id = 'library' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- TASK-125 review: account for committed objects, including unused uploads.
-- Never mutate Storage metadata from app SQL: actual deletion uses Storage API.
create table public.library_storage_usage (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  files integer not null default 0 check(files between 0 and 200),
  bytes bigint not null default 0 check(bytes between 0 and 104857600)
);
alter table public.library_storage_usage enable row level security;
revoke all on public.library_storage_usage from public, anon, authenticated;

create function public.library_lock_owner(uid uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.library_storage_usage(owner_id) values(uid) on conflict do nothing;
  perform 1 from public.library_storage_usage where owner_id=uid for update;
end $$;

create function public.library_object_bytes(meta jsonb) returns bigint
language plpgsql immutable set search_path = '' as $$
declare value text := coalesce(meta->>'size','0');
begin
  -- Ignore contentLength: a multipart probe includes transport boundaries,
  -- which can exceed 5 MiB for a valid 5 MiB file. Probes roll back; committed
  -- metadata.size carries actual file bytes and is checked/accounted here.
  if value !~ '^[0-9]{1,7}$' or value::bigint > 5242880 then
    raise exception 'Изображение больше 5 МиБ или имеет неверный размер' using errcode='23514';
  end if;
  return value::bigint;
end $$;

create function public.library_storage_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare uid uuid; object_name text;
begin
  if tg_op='INSERT' then
    if new.bucket_id <> 'library' then return new; end if;
    object_name := new.name;
  elsif tg_op='DELETE' then
    if old.bucket_id <> 'library' then return old; end if;
    object_name := old.name;
  else
    if old.bucket_id <> 'library' and new.bucket_id <> 'library' then return new; end if;
    if old.bucket_id is distinct from new.bucket_id or old.name is distinct from new.name then
      raise exception 'Перемещение личного файла запрещено; загрузите отдельную копию' using errcode='42501';
    end if;
    object_name := new.name;
  end if;
  if object_name !~ '^[0-9a-fA-F-]{36}/[A-Za-z0-9_-]+\.(png|jpg|jpeg|webp)$' then
    raise exception 'Неверный путь личного изображения' using errcode='23514';
  end if;
  uid := split_part(object_name,'/',1)::uuid;
  -- BEFORE triggers precede RLS WITH CHECK: reject foreign caller ownership
  -- before probing/locking a private owner's data (also during Storage probes).
  if current_setting('role',true) in ('authenticated','anon') and uid is distinct from auth.uid() then
    raise exception 'Личное изображение недоступно' using errcode='42501';
  end if;
  if tg_op='DELETE' and not exists(select 1 from public.profiles where id=uid) then return old; end if;
  perform public.library_lock_owner(uid);
  if tg_op <> 'DELETE' then perform public.library_object_bytes(new.metadata); end if;
  if tg_op='DELETE' and exists(select 1 from public.creatures c where c.owner_id=uid
    and (c.data->>'img'='library:'||object_name or c.data->>'statblockImage'='library:'||object_name)) then
    raise exception 'Изображение используется в личной библиотеке' using errcode='42501';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
-- Only guards/our counter are added; no direct INSERT/UPDATE/DELETE of Storage
-- rows by our functions. Both API permission probes and final writes run guards.
create trigger library_storage_guard before insert or update or delete on storage.objects
  for each row execute function public.library_storage_guard();

create function public.library_storage_count() returns trigger
language plpgsql security definer set search_path = '' as $$
declare uid uuid; before_bytes bigint := 0; after_bytes bigint := 0; delta integer := 0;
begin
  if tg_op='DELETE' then
    if old.bucket_id <> 'library' then return null; end if;
    uid := split_part(old.name,'/',1)::uuid;
  else
    if new.bucket_id <> 'library' then return null; end if;
    uid := split_part(new.name,'/',1)::uuid;
  end if;
  if tg_op='INSERT' then delta := 1; end if;
  if tg_op='DELETE' then delta := -1; end if;
  if tg_op <> 'INSERT' then before_bytes := public.library_object_bytes(old.metadata); end if;
  if tg_op <> 'DELETE' then after_bytes := public.library_object_bytes(new.metadata); end if;
  -- AFTER means ON CONFLICT UPDATE adjusts bytes, without consuming another slot.
  update public.library_storage_usage set files=files+delta, bytes=bytes+after_bytes-before_bytes where owner_id=uid;
  return null;
end $$;
create trigger library_storage_count after insert or update or delete on storage.objects
  for each row execute function public.library_storage_count();

create function public.creature_image_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare uid uuid; ref text; path text;
begin
  if tg_op='DELETE' then uid := old.owner_id; else uid := new.owner_id; end if;
  if current_setting('role',true) in ('authenticated','anon') and uid is distinct from auth.uid() then
    raise exception 'Личная запись недоступна' using errcode='42501';
  end if;
  -- Parent cascade may have removed its usage row already. Never recreate it.
  if tg_op='DELETE' and not exists(select 1 from public.profiles where id=uid) then return old; end if;
  perform public.library_lock_owner(uid);
  if tg_op='DELETE' then return old; end if;
  for ref in select v from (values(new.data->>'img'),(new.data->>'statblockImage')) images(v) where v like 'library:%' loop
    path := substring(ref from 9);
    if split_part(path,'/',1) <> uid::text or not exists(
      select 1 from storage.objects o where o.bucket_id='library' and o.name=path) then
      raise exception 'Личное изображение не найдено или недоступно' using errcode='42501';
    end if;
  end loop;
  return new;
end $$;
create trigger creatures_images before insert or update or delete on public.creatures
  for each row execute function public.creature_image_guard();

create function public.library_unused_images() returns table(path text,bytes bigint)
language sql security definer set search_path = '' as $$
  select o.name, public.library_object_bytes(o.metadata) from storage.objects o
  where o.bucket_id='library' and split_part(o.name,'/',1)=(select auth.uid())::text
    and not exists(select 1 from public.creatures c where c.owner_id=(select auth.uid())
      and (c.data->>'img'='library:'||o.name or c.data->>'statblockImage'='library:'||o.name))
  order by o.name limit 200
$$;
create function public.library_image_usage() returns table(files integer,bytes bigint)
language sql security definer set search_path = '' as $$
  select coalesce(u.files,0),coalesce(u.bytes,0) from (select auth.uid() uid) a
    left join public.library_storage_usage u on u.owner_id=a.uid where a.uid is not null
$$;
revoke execute on function public.library_lock_owner(uuid),public.library_object_bytes(jsonb),
  public.library_storage_guard(),public.library_storage_count(),public.creature_image_guard(),public.library_unused_images(),public.library_image_usage()
  from public,anon,authenticated;
grant execute on function public.library_unused_images(),public.library_image_usage() to authenticated;
