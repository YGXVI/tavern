-- TASK-002 · 0003: журнал (открытая часть и тайная), запросы спасбросков и переходов, бой.

create table public.log_entries (
  id text primary key check (length(id) between 3 and 64),
  campaign_id text not null references public.campaigns (id) on delete cascade,
  author uuid references public.profiles (id) on delete set null default auth.uid(),
  at bigint not null,
  vis text not null default 'all' check (vis in ('all', 'gm', 'blind', 'self')),
  data jsonb not null default '{}'::jsonb      -- у скрытых бросков — без подписи и результата
);
create index log_entries_campaign_at on public.log_entries (campaign_id, at desc);

create table public.log_secrets (
  id text primary key references public.log_entries (id) on delete cascade,
  campaign_id text not null references public.campaigns (id) on delete cascade,
  author uuid references public.profiles (id) on delete set null default auth.uid(),
  vis text not null check (vis in ('gm', 'blind', 'self')),
  data jsonb not null default '{}'::jsonb      -- подпись, сумма, грани
);

create table public.save_requests (
  id text primary key check (length(id) between 3 and 64),
  campaign_id text not null references public.campaigns (id) on delete cascade,
  data jsonb not null default '{}'::jsonb
);
create index save_requests_campaign on public.save_requests (campaign_id);

create table public.portal_requests (
  id text primary key check (length(id) between 3 and 64),
  campaign_id text not null references public.campaigns (id) on delete cascade,
  author uuid references public.profiles (id) on delete cascade default auth.uid(),
  data jsonb not null default '{}'::jsonb
);

create table public.combats (
  campaign_id text primary key references public.campaigns (id) on delete cascade,
  data jsonb not null default '{}'::jsonb      -- active, sceneId, round, turn, entries[], moved{}, current, ended
);

-- Токены игрока в кампании: токены его героя.
create or replace function public.my_token_ids(c text)
returns text[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(t.id), '{}') from public.tokens t
  where t.campaign_id = c and t.character_id is not null and t.character_id = public.my_character(c);
$$;

-- Игрок вписывает только результат спасброска своего героя и только один раз.
create or replace function public.guard_save_request()
returns trigger language plpgsql security definer set search_path = '' as $$
declare k text; mine text[] := public.my_token_ids(old.campaign_id);
begin
  if public.is_master(old.campaign_id) then return new; end if;
  if (old.data - 'results') <> (new.data - 'results') or new.campaign_id <> old.campaign_id then
    raise exception 'Запрос спасброска меняет мастер' using errcode = '42501';
  end if;
  for k in select jsonb_object_keys(coalesce(old.data -> 'results', '{}')) loop
    if (old.data #> array['results', k]) is distinct from (new.data #> array['results', k]) then
      raise exception 'Результат уже записан' using errcode = '42501';
    end if;
  end loop;
  for k in select jsonb_object_keys(coalesce(new.data -> 'results', '{}')) loop
    if not coalesce(old.data -> 'results', '{}') ? k and not (k = any (mine)) then
      raise exception 'Результат — только за своего героя' using errcode = '42501';
    end if;
  end loop;
  return new;
end $$;
create trigger save_requests_guard before update on public.save_requests for each row execute function public.guard_save_request();

-- Бой: игрок бросает инициативу своего героя, тратит его движение и заканчивает свой ход
-- (ставит ended = current; передачу хода выполняет клиент мастера).
create or replace function public.guard_combat()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  mine text[] := public.my_token_ids(old.campaign_id);
  n int; i int; o jsonb; nw jsonb; k text;
  fixed text[] := array['entries', 'moved', 'ended'];
begin
  if public.is_master(old.campaign_id) then return new; end if;
  if (old.data - fixed) <> (new.data - fixed) then raise exception 'Бой ведёт мастер' using errcode = '42501'; end if;
  n := coalesce(jsonb_array_length(old.data -> 'entries'), 0);
  if n <> coalesce(jsonb_array_length(new.data -> 'entries'), 0) then raise exception 'Очередь боя меняет мастер' using errcode = '42501'; end if;
  for i in 0 .. n - 1 loop
    o := old.data -> 'entries' -> i; nw := new.data -> 'entries' -> i;
    continue when o = nw;
    if (o - 'init') <> (nw - 'init') or (o -> 'init') <> 'null'::jsonb or not ((o ->> 'tokenId') = any (mine)) then
      raise exception 'Инициативу бросает только сам игрок и только один раз' using errcode = '42501';
    end if;
  end loop;
  for k in select jsonb_object_keys(coalesce(old.data -> 'moved', '{}')) union select jsonb_object_keys(coalesce(new.data -> 'moved', '{}')) loop
    if (old.data #> array['moved', k]) is distinct from (new.data #> array['moved', k]) and not (k = any (mine)) then
      raise exception 'Движение — только своего героя' using errcode = '42501';
    end if;
  end loop;
  if (old.data -> 'ended') is distinct from (new.data -> 'ended') then
    if not ((old.data ->> 'current') = any (mine)) or (new.data ->> 'ended') is distinct from (old.data ->> 'current') then
      raise exception 'Закончить можно только свой ход' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger combats_guard before update on public.combats for each row execute function public.guard_combat();

alter table public.log_entries enable row level security;
alter table public.log_secrets enable row level security;
alter table public.save_requests enable row level security;
alter table public.portal_requests enable row level security;
alter table public.combats enable row level security;

create policy log_read on public.log_entries for select to authenticated using (public.is_member(campaign_id));
create policy log_insert on public.log_entries for insert to authenticated
  with check (public.is_member(campaign_id) and author = (select auth.uid()));
create policy log_master_delete on public.log_entries for delete to authenticated using (public.is_master(campaign_id));

create policy log_secret_read on public.log_secrets for select to authenticated
  using (public.is_master(campaign_id) or (author = (select auth.uid()) and vis <> 'blind'));
create policy log_secret_insert on public.log_secrets for insert to authenticated
  with check (public.is_member(campaign_id) and author = (select auth.uid()));

create policy saves_read on public.save_requests for select to authenticated using (public.is_member(campaign_id));
create policy saves_insert on public.save_requests for insert to authenticated with check (public.is_master(campaign_id));
create policy saves_update on public.save_requests for update to authenticated using (public.is_member(campaign_id)) with check (public.is_member(campaign_id));
create policy saves_delete on public.save_requests for delete to authenticated using (public.is_master(campaign_id));

create policy portals_read on public.portal_requests for select to authenticated
  using (public.is_master(campaign_id) or author = (select auth.uid()));
create policy portals_insert on public.portal_requests for insert to authenticated
  with check (public.is_member(campaign_id) and author = (select auth.uid()));
create policy portals_delete on public.portal_requests for delete to authenticated
  using (public.is_master(campaign_id) or author = (select auth.uid()));

create policy combat_read on public.combats for select to authenticated using (public.is_member(campaign_id));
create policy combat_insert on public.combats for insert to authenticated with check (public.is_master(campaign_id));
create policy combat_update on public.combats for update to authenticated using (public.is_member(campaign_id)) with check (public.is_member(campaign_id));
create policy combat_delete on public.combats for delete to authenticated using (public.is_master(campaign_id));

revoke all on public.log_entries, public.log_secrets, public.save_requests, public.portal_requests, public.combats from anon;
grant select, insert, delete on public.log_entries to authenticated;
grant select, insert on public.log_secrets to authenticated;
grant select, insert, update, delete on public.save_requests, public.portal_requests, public.combats to authenticated;
revoke execute on function public.my_token_ids(text) from anon, public;
grant execute on function public.my_token_ids(text) to authenticated;
