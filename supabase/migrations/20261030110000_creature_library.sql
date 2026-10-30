-- TASK-125 / TASK-097: personal library only. No token/sync/scene changes.
create table public.creatures (
  id text primary key check (id ~ '^[A-Za-z0-9_:-]{1,128}$'),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  constraint creature_data_object check (coalesce(jsonb_typeof(data) = 'object'
    and jsonb_typeof(data->'name') = 'string' and length(btrim(data->>'name')) between 1 and 200
    and data->>'source' in ('manual', 'image')
    and (data->>'source' <> 'image' or (jsonb_typeof(data->'statblockImage') = 'string' and length(btrim(data->>'statblockImage')) > 0))
    and not (data ?| array['id','ownerId','updatedAt']), false)),
  constraint creature_data_64k check (octet_length(convert_to(data::text, 'UTF8')) <= 65536)
);
create index creatures_owner on public.creatures(owner_id);

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
  constraint campaign_creature_64k check(octet_length(convert_to(data::text, 'UTF8')) <= 65536)
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
