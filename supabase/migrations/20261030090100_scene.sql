-- TASK-002 · 0002: сцены, тайное мастера, исследованные клетки, токены, рисунки.

create table public.scenes (
  id text primary key check (length(id) between 3 and 64),
  campaign_id text not null references public.campaigns (id) on delete cascade,
  ord int not null default 0,
  data jsonb not null default '{}'::jsonb   -- карта, сетка, свет, стены, туман, местность, переходы, открытые метки
);
create index scenes_campaign on public.scenes (campaign_id);

create table public.scene_secrets (
  scene_id text primary key references public.scenes (id) on delete cascade,
  campaign_id text not null references public.campaigns (id) on delete cascade,
  data jsonb not null default '{}'::jsonb   -- ловушки, метки «только мастеру», неоткрытые тексты
);

create table public.scene_explored (
  scene_id text primary key references public.scenes (id) on delete cascade,
  campaign_id text not null references public.campaigns (id) on delete cascade,
  cells text[] not null default '{}'
);

create table public.tokens (
  id text primary key check (length(id) between 3 and 64),
  campaign_id text not null references public.campaigns (id) on delete cascade,
  scene_id text not null references public.scenes (id) on delete cascade,
  character_id text,
  hidden boolean not null default false,
  ord bigint not null default 0,
  data jsonb not null default '{}'::jsonb
);
create index tokens_scene on public.tokens (scene_id);
create index tokens_campaign on public.tokens (campaign_id);

create table public.drawings (
  id text primary key check (length(id) between 3 and 64),
  campaign_id text not null references public.campaigns (id) on delete cascade,
  scene_id text not null references public.scenes (id) on delete cascade,
  author uuid references public.profiles (id) on delete set null default auth.uid(),
  ord bigint not null default 0,
  data jsonb not null default '{}'::jsonb
);
create index drawings_scene on public.drawings (scene_id);

-- ——— Игрок в сцене может только открыть/закрыть незапертую дверь (и отпереть «Открыванием») ———
create or replace function public.guard_scene_update()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  n_old int; n_new int; i int; o jsonb; n jsonb; ol boolean; nl boolean;
begin
  if public.is_master(old.campaign_id) then return new; end if;
  if new.campaign_id <> old.campaign_id or new.ord <> old.ord or (old.data - 'walls') <> (new.data - 'walls') then
    raise exception 'Сцену меняет мастер' using errcode = '42501';
  end if;
  n_old := coalesce(jsonb_array_length(old.data -> 'walls'), 0);
  n_new := coalesce(jsonb_array_length(new.data -> 'walls'), 0);
  if n_old <> n_new then raise exception 'Стены меняет мастер' using errcode = '42501'; end if;
  for i in 0 .. n_old - 1 loop
    o := old.data -> 'walls' -> i; n := new.data -> 'walls' -> i;
    continue when o = n;
    if (o - 'open' - 'locked') <> (n - 'open' - 'locked') or (o ->> 'kind') not in ('door', 'secret') then
      raise exception 'Стены меняет мастер' using errcode = '42501';
    end if;
    ol := coalesce((o ->> 'locked')::boolean, false); nl := coalesce((n ->> 'locked')::boolean, false);
    if nl and not ol then raise exception 'Запирает дверь мастер' using errcode = '42501'; end if;
    if ol and nl and (o -> 'open') is distinct from (n -> 'open') then raise exception 'Дверь заперта' using errcode = '42501'; end if;
    if ol and not nl and not coalesce((n ->> 'open')::boolean, false) then raise exception 'Дверь заперта' using errcode = '42501'; end if;
  end loop;
  return new;
end $$;
create trigger scenes_guard before update on public.scenes for each row execute function public.guard_scene_update();

-- ——— Токены: мастер — всё; игрок — по правилам открытого перемещения (TASK-018) ———
create or replace function public.guard_token()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  cid text := coalesce(new.campaign_id, old.campaign_id);
  mine text := public.my_character(cid);
  open_move boolean;
  allowed text[];
  k text;
begin
  if public.is_master(cid) then return new; end if;
  if tg_op = 'INSERT' then
    if new.character_id is null or new.character_id is distinct from mine or new.hidden or (new.data ->> 'kind') is distinct from 'hero' then
      raise exception 'Игрок ставит на сцену только своего героя' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.campaign_id <> old.campaign_id or new.character_id is distinct from old.character_id or new.hidden <> old.hidden or new.ord <> old.ord then
    raise exception 'Это меняет мастер' using errcode = '42501';
  end if;
  if old.character_id is not null and old.character_id = mine then
    allowed := array['x', 'y', 'movedAt', 'rot', 'scale', 'light', 'aura', 'disengaged', 'darkvision', 'elevation'];
  else
    if new.scene_id <> old.scene_id then raise exception 'Это меняет мастер' using errcode = '42501'; end if;
    select coalesce((c.data #>> '{settings,openMovement}')::boolean, true) into open_move from public.campaigns c where c.id = cid;
    if not open_move or old.hidden then raise exception 'Чужие токены двигает мастер' using errcode = '42501'; end if;
    if coalesce((old.data ->> 'locked')::boolean, false) then raise exception 'Токен закреплён мастером' using errcode = '42501'; end if;
    allowed := array['x', 'y', 'movedAt', 'rot'];
  end if;
  for k in select jsonb_object_keys(old.data) union select jsonb_object_keys(new.data) loop
    if (old.data -> k) is distinct from (new.data -> k) and not (k = any (allowed)) then
      raise exception 'Нельзя менять «%» у этого токена', k using errcode = '42501';
    end if;
  end loop;
  return new;
end $$;
create trigger tokens_guard before insert or update on public.tokens for each row execute function public.guard_token();

-- ——— Рисунки: автор не подменяется ———
create or replace function public.guard_drawing()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public.is_master(new.campaign_id) then return new; end if;
  if tg_op = 'INSERT' and new.author is distinct from (select auth.uid()) then raise exception 'Рисунок — только от своего имени' using errcode = '42501'; end if;
  if tg_op = 'UPDATE' and (new.author is distinct from old.author or new.campaign_id <> old.campaign_id) then raise exception 'Автора рисунка не меняют' using errcode = '42501'; end if;
  return new;
end $$;
create trigger drawings_guard before insert or update on public.drawings for each row execute function public.guard_drawing();

-- ——— RLS ———
alter table public.scenes enable row level security;
alter table public.scene_secrets enable row level security;
alter table public.scene_explored enable row level security;
alter table public.tokens enable row level security;
alter table public.drawings enable row level security;

create policy scenes_read on public.scenes for select to authenticated using (public.is_member(campaign_id));
create policy scenes_insert on public.scenes for insert to authenticated with check (public.is_master(campaign_id));
create policy scenes_update on public.scenes for update to authenticated using (public.is_member(campaign_id)) with check (public.is_member(campaign_id));
create policy scenes_delete on public.scenes for delete to authenticated using (public.is_master(campaign_id));

create policy secrets_master on public.scene_secrets for all to authenticated
  using (public.is_master(campaign_id)) with check (public.is_master(campaign_id));

create policy explored_read on public.scene_explored for select to authenticated using (public.is_member(campaign_id));
create policy explored_master on public.scene_explored for all to authenticated
  using (public.is_master(campaign_id)) with check (public.is_master(campaign_id));

create policy tokens_read on public.tokens for select to authenticated
  using (public.is_master(campaign_id) or (public.is_member(campaign_id) and not hidden));
create policy tokens_insert on public.tokens for insert to authenticated with check (public.is_member(campaign_id));
create policy tokens_update on public.tokens for update to authenticated
  using (public.is_master(campaign_id) or (public.is_member(campaign_id) and not hidden))
  with check (public.is_member(campaign_id));
create policy tokens_delete on public.tokens for delete to authenticated using (public.is_master(campaign_id));

create policy drawings_read on public.drawings for select to authenticated using (public.is_member(campaign_id));
create policy drawings_insert on public.drawings for insert to authenticated with check (public.is_member(campaign_id));
create policy drawings_update on public.drawings for update to authenticated
  using (public.is_master(campaign_id) or author = (select auth.uid())) with check (public.is_member(campaign_id));
create policy drawings_delete on public.drawings for delete to authenticated
  using (public.is_master(campaign_id) or author = (select auth.uid()));

revoke all on public.scenes, public.scene_secrets, public.scene_explored, public.tokens, public.drawings from anon;
grant select, insert, update, delete on public.scenes, public.scene_secrets, public.scene_explored, public.tokens, public.drawings to authenticated;
