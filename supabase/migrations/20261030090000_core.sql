-- TASK-002 · 0001: профили, кампании, участники, приглашения, герои, помощники прав.
-- Ключи кампаний и героев — строки, которые задаёт клиент (как в песочнице: c-…, ch-…).

-- ——— Профили (из входа через Discord) ———
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null,
  handle text,
  avatar_url text,
  hue int not null default 32,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.profile_from_auth()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  nick text := left(coalesce(nullif(meta #>> '{custom_claims,global_name}', ''), nullif(meta ->> 'full_name', ''), nullif(meta ->> 'name', ''), nullif(meta ->> 'user_name', ''), 'Игрок'), 40);
  handle text := left(coalesce(nullif(meta ->> 'name', ''), nullif(meta ->> 'user_name', ''), nick), 40);
begin
  insert into public.profiles (id, name, handle, avatar_url, hue)
  values (new.id, nick, regexp_replace(lower(handle), '#0$', ''), nullif(coalesce(meta ->> 'avatar_url', meta ->> 'picture'), ''), (abs(hashtext(nick)) % 360))
  on conflict (id) do update set name = excluded.name, handle = excluded.handle, avatar_url = excluded.avatar_url, updated_at = now();
  return new;
end $$;

create trigger on_auth_user_profile
  after insert or update of raw_user_meta_data on auth.users
  for each row execute function public.profile_from_auth();

-- ——— Кампании ———
create table public.campaigns (
  id text primary key check (length(id) between 3 and 64),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  data jsonb not null default '{}'::jsonb,       -- описание, обложка, уровень, места, статус, активная сцена, настройки, пауза
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.campaign_members (
  campaign_id text not null references public.campaigns (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('master', 'player')),
  status text not null check (status in ('active', 'pending')),
  character_id text,
  scene_id text,
  joined_at timestamptz not null default now(),
  primary key (campaign_id, user_id)
);
create index campaign_members_user on public.campaign_members (user_id);

create table public.campaign_invites (
  campaign_id text primary key references public.campaigns (id) on delete cascade,
  code text not null unique check (code ~ '^RSP-[A-Z0-9]{4,8}$'),
  expires_at timestamptz,
  manual boolean not null default true,
  revoked boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.characters (
  id text primary key check (length(id) between 3 and 64),
  campaign_id text not null references public.campaigns (id) on delete cascade,
  owner_id uuid references public.profiles (id) on delete set null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create index characters_campaign on public.characters (campaign_id);

-- ——— Помощники прав (security definer: читают членство в обход RLS) ———
create or replace function public.is_member(c text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.campaign_members m where m.campaign_id = c and m.user_id = (select auth.uid()) and m.status = 'active');
$$;

create or replace function public.is_master(c text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.campaign_members m where m.campaign_id = c and m.user_id = (select auth.uid()) and m.status = 'active' and m.role = 'master');
$$;

create or replace function public.is_applicant(c text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.campaign_members m where m.campaign_id = c and m.user_id = (select auth.uid()));
$$;

create or replace function public.my_character(c text)
returns text language sql stable security definer set search_path = '' as $$
  select m.character_id from public.campaign_members m where m.campaign_id = c and m.user_id = (select auth.uid()) and m.status = 'active';
$$;

create or replace function public.shares_campaign(other uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.campaign_members a join public.campaign_members b on a.campaign_id = b.campaign_id
    where a.user_id = (select auth.uid()) and b.user_id = other
      and (a.status = 'active' or b.role = 'master')
  );
$$;

-- Создатель кампании сразу становится её мастером.
create or replace function public.campaign_owner_member()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.campaign_members (campaign_id, user_id, role, status) values (new.id, new.owner_id, 'master', 'active')
  on conflict do nothing;
  return new;
end $$;
create trigger on_campaign_created after insert on public.campaigns for each row execute function public.campaign_owner_member();

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
create trigger campaigns_touch before update on public.campaigns for each row execute function public.touch_updated_at();
create trigger characters_touch before update on public.characters for each row execute function public.touch_updated_at();

-- Игрок не может сделать себя мастером, сменить себе статус или выбрать чужого героя через UPDATE.
create or replace function public.guard_member_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public.is_master(old.campaign_id) then
    -- Места: активных игроков не больше, чем мест кампании.
    if new.status = 'active' and new.role = 'player' and old.status <> 'active' then
      if (select count(*) from public.campaign_members m where m.campaign_id = new.campaign_id and m.role = 'player' and m.status = 'active')
         >= coalesce(((select c.data ->> 'seats' from public.campaigns c where c.id = new.campaign_id))::int, 5) then
        raise exception 'Все места за столом заняты' using errcode = 'P0001';
      end if;
    end if;
    return new;
  end if;
  if old.user_id <> (select auth.uid()) then raise exception 'Чужое членство меняет только мастер' using errcode = '42501'; end if;
  if new.role <> old.role or new.status <> old.status or new.user_id <> old.user_id or new.campaign_id <> old.campaign_id
     or new.character_id is distinct from old.character_id then
    raise exception 'Роль, статус и героя игрока меняет мастер или выбор героя' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger campaign_members_guard before update on public.campaign_members for each row execute function public.guard_member_update();

-- Владелец героя не меняется игроком; новый герой игрока — только свой.
create or replace function public.guard_character()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public.is_master(new.campaign_id) then return new; end if;
  if tg_op = 'INSERT' then
    if new.owner_id is distinct from (select auth.uid()) then raise exception 'Новый герой игрока — только свой' using errcode = '42501'; end if;
    return new;
  end if;
  if new.owner_id is distinct from old.owner_id or new.campaign_id <> old.campaign_id then
    raise exception 'Владельца героя меняет мастер' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger characters_guard before insert or update on public.characters for each row execute function public.guard_character();

-- ——— RLS ———
alter table public.profiles enable row level security;
alter table public.campaigns enable row level security;
alter table public.campaign_members enable row level security;
alter table public.campaign_invites enable row level security;
alter table public.characters enable row level security;

create policy profiles_read on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.shares_campaign(id));
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy campaigns_read on public.campaigns for select to authenticated using (public.is_applicant(id));
create policy campaigns_insert on public.campaigns for insert to authenticated with check (owner_id = (select auth.uid()));
create policy campaigns_update on public.campaigns for update to authenticated using (public.is_master(id)) with check (public.is_master(id));
create policy campaigns_delete on public.campaigns for delete to authenticated using (owner_id = (select auth.uid()));

create policy members_read on public.campaign_members for select to authenticated
  using (user_id = (select auth.uid()) or public.is_member(campaign_id));
create policy members_update on public.campaign_members for update to authenticated
  using (public.is_master(campaign_id) or user_id = (select auth.uid()));
create policy members_delete on public.campaign_members for delete to authenticated
  using ((public.is_master(campaign_id) and role <> 'master') or (user_id = (select auth.uid()) and role <> 'master'));

create policy invites_master on public.campaign_invites for all to authenticated
  using (public.is_master(campaign_id)) with check (public.is_master(campaign_id));

create policy characters_read on public.characters for select to authenticated using (public.is_member(campaign_id));
create policy characters_insert on public.characters for insert to authenticated with check (public.is_member(campaign_id));
create policy characters_update on public.characters for update to authenticated
  using (public.is_master(campaign_id) or owner_id = (select auth.uid()))
  with check (public.is_master(campaign_id) or owner_id = (select auth.uid()));
create policy characters_delete on public.characters for delete to authenticated using (public.is_master(campaign_id));

-- Доступ к таблицам: только вошедшим; анонимам — ничего.
revoke all on public.profiles, public.campaigns, public.campaign_members, public.campaign_invites, public.characters from anon;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.campaigns, public.campaign_members, public.campaign_invites, public.characters to authenticated;
revoke insert on public.campaign_members from authenticated; -- вступление — только функцией join_campaign
revoke execute on function public.is_member(text), public.is_master(text), public.is_applicant(text), public.my_character(text), public.shares_campaign(uuid) from anon, public;
grant execute on function public.is_member(text), public.is_master(text), public.is_applicant(text), public.my_character(text), public.shares_campaign(uuid) to authenticated;
