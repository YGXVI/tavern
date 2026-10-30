-- TASK-002 · 0004–0005: функции вступления и выбора героя, исследованные клетки, реальное время, файлы карт.

-- ——— Приглашение: что видно по коду до вступления ———
create or replace function public.invite_preview(p_code text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare inv public.campaign_invites; c public.campaigns; master_name text; taken int; heroes jsonb; my text;
begin
  select * into inv from public.campaign_invites i where i.code = upper(trim(p_code));
  if not found or inv.revoked or (inv.expires_at is not null and inv.expires_at < now()) then
    return jsonb_build_object('ok', false);
  end if;
  select * into c from public.campaigns x where x.id = inv.campaign_id;
  select p.name into master_name from public.campaign_members m join public.profiles p on p.id = m.user_id
    where m.campaign_id = c.id and m.role = 'master' limit 1;
  select count(*) into taken from public.campaign_members m where m.campaign_id = c.id and m.role = 'player' and m.status = 'active';
  select coalesce(jsonb_agg(jsonb_build_object('name', h.data ->> 'name', 'portrait', h.data ->> 'portrait')), '[]'::jsonb) into heroes
    from (select ch.data from public.characters ch where ch.campaign_id = c.id order by ch.id limit 4) h;
  if (select auth.uid()) is not null then
    select m.status into my from public.campaign_members m where m.campaign_id = c.id and m.user_id = (select auth.uid());
  end if;
  return jsonb_build_object('ok', true, 'campaignId', c.id, 'name', c.name, 'description', c.data ->> 'description',
    'cover', c.data ->> 'cover', 'seats', coalesce((c.data ->> 'seats')::int, 5), 'taken', taken, 'master', master_name,
    'heroes', heroes, 'manual', inv.manual, 'myStatus', my);
end $$;

-- ——— Вступление по коду ———
create or replace function public.join_campaign(p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare inv public.campaign_invites; me uuid := (select auth.uid()); existing text; seats int; taken int; st text;
begin
  if me is null then raise exception 'Нужно войти' using errcode = '42501'; end if;
  select * into inv from public.campaign_invites i where i.code = upper(trim(p_code));
  if not found or inv.revoked or (inv.expires_at is not null and inv.expires_at < now()) then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  select m.status into existing from public.campaign_members m where m.campaign_id = inv.campaign_id and m.user_id = me;
  if existing is not null then return jsonb_build_object('ok', true, 'campaignId', inv.campaign_id, 'status', existing); end if;
  st := case when inv.manual then 'pending' else 'active' end;
  if st = 'active' then
    select coalesce((c.data ->> 'seats')::int, 5) into seats from public.campaigns c where c.id = inv.campaign_id;
    select count(*) into taken from public.campaign_members m where m.campaign_id = inv.campaign_id and m.role = 'player' and m.status = 'active';
    if taken >= seats then return jsonb_build_object('ok', false, 'error', 'full', 'campaignId', inv.campaign_id); end if;
  end if;
  insert into public.campaign_members (campaign_id, user_id, role, status) values (inv.campaign_id, me, 'player', st);
  return jsonb_build_object('ok', true, 'campaignId', inv.campaign_id, 'status', st);
end $$;

-- ——— Выбор свободного героя ———
create or replace function public.claim_character(p_campaign text, p_character text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); mem public.campaign_members;
begin
  select * into mem from public.campaign_members m where m.campaign_id = p_campaign and m.user_id = me and m.status = 'active';
  if not found or mem.role <> 'player' then raise exception 'Выбирает героя игрок кампании' using errcode = '42501'; end if;
  if mem.character_id is not null and mem.character_id <> p_character then
    raise exception 'У вас уже есть герой в этой кампании' using errcode = '42501';
  end if;
  if not exists (select 1 from public.characters ch where ch.id = p_character and ch.campaign_id = p_campaign) then
    raise exception 'Нет такого героя' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.campaign_members m where m.campaign_id = p_campaign and m.character_id = p_character and m.status = 'active' and m.user_id <> me) then
    return jsonb_build_object('ok', false, 'error', 'taken');
  end if;
  -- Обходим проверку членства для собственной записи: здесь проверено всё нужное.
  update public.campaign_members set character_id = p_character where campaign_id = p_campaign and user_id = me;
  update public.characters set owner_id = me, data = jsonb_set(data, '{ownerId}', to_jsonb(me::text)) where id = p_character;
  return jsonb_build_object('ok', true);
end $$;

-- ——— Исследованные клетки: только добавление ———
create or replace function public.add_explored(p_scene text, p_cells text[])
returns void language plpgsql security definer set search_path = '' as $$
declare cid text;
begin
  select s.campaign_id into cid from public.scenes s where s.id = p_scene;
  if cid is null or not public.is_member(cid) then raise exception 'Сцена недоступна' using errcode = '42501'; end if;
  if coalesce(array_length(p_cells, 1), 0) = 0 then return; end if;
  if array_length(p_cells, 1) > 5000 then raise exception 'Слишком много клеток за раз' using errcode = '22023'; end if;
  insert into public.scene_explored as e (scene_id, campaign_id, cells)
    values (p_scene, cid, (select array_agg(distinct x) from unnest(p_cells) x where x ~ '^-?\d+,-?\d+$'))
  on conflict (scene_id) do update
    set cells = (select array_agg(distinct x) from unnest(e.cells || excluded.cells) x);
end $$;

-- Обходы проверок в функциях выше выполняет владелец функции; триггеры-охранники пропускают их по флагу.
-- guard_member_update сверяет character_id — для claim_character разрешаем через параметр сессии.
create or replace function public.guard_member_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public.is_master(old.campaign_id) then
    if new.status = 'active' and new.role = 'player' and old.status <> 'active' then
      if (select count(*) from public.campaign_members m where m.campaign_id = new.campaign_id and m.role = 'player' and m.status = 'active')
         >= coalesce(((select c.data ->> 'seats' from public.campaigns c where c.id = new.campaign_id))::int, 5) then
        raise exception 'Все места за столом заняты' using errcode = 'P0001';
      end if;
    end if;
    return new;
  end if;
  if old.user_id <> (select auth.uid()) then raise exception 'Чужое членство меняет только мастер' using errcode = '42501'; end if;
  if new.role <> old.role or new.status <> old.status or new.user_id <> old.user_id or new.campaign_id <> old.campaign_id then
    raise exception 'Роль и статус меняет мастер' using errcode = '42501';
  end if;
  if new.character_id is distinct from old.character_id and current_setting('rasputye.claim', true) is distinct from new.character_id then
    raise exception 'Героя выбирают на экране выбора героя' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function public.guard_character()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public.is_master(new.campaign_id) then return new; end if;
  if tg_op = 'INSERT' then
    if new.owner_id is distinct from (select auth.uid()) then raise exception 'Новый герой игрока — только свой' using errcode = '42501'; end if;
    return new;
  end if;
  if (new.owner_id is distinct from old.owner_id and current_setting('rasputye.claim', true) is distinct from new.id) or new.campaign_id <> old.campaign_id then
    raise exception 'Владельца героя меняет мастер' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function public.claim_character(p_campaign text, p_character text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); mem public.campaign_members;
begin
  select * into mem from public.campaign_members m where m.campaign_id = p_campaign and m.user_id = me and m.status = 'active';
  if not found or mem.role <> 'player' then raise exception 'Выбирает героя игрок кампании' using errcode = '42501'; end if;
  if mem.character_id is not null and mem.character_id <> p_character then
    raise exception 'У вас уже есть герой в этой кампании' using errcode = '42501';
  end if;
  if not exists (select 1 from public.characters ch where ch.id = p_character and ch.campaign_id = p_campaign) then
    raise exception 'Нет такого героя' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.campaign_members m where m.campaign_id = p_campaign and m.character_id = p_character and m.status = 'active' and m.user_id <> me) then
    return jsonb_build_object('ok', false, 'error', 'taken');
  end if;
  perform set_config('rasputye.claim', p_character, true);
  update public.campaign_members set character_id = p_character where campaign_id = p_campaign and user_id = me;
  update public.characters set owner_id = me, data = jsonb_set(data, '{ownerId}', to_jsonb(me::text)) where id = p_character;
  perform set_config('rasputye.claim', '', true);
  return jsonb_build_object('ok', true);
end $$;

revoke execute on function public.invite_preview(text), public.join_campaign(text), public.claim_character(text, text), public.add_explored(text, text[]) from public;
grant execute on function public.invite_preview(text) to anon, authenticated;
grant execute on function public.join_campaign(text), public.claim_character(text, text), public.add_explored(text, text[]) to authenticated;

-- ——— Реальное время: изменения таблиц и приватный канал кампании ———
alter publication supabase_realtime add table
  public.profiles, public.campaigns, public.campaign_members, public.campaign_invites, public.characters,
  public.scenes, public.scene_secrets, public.scene_explored, public.tokens, public.drawings,
  public.log_entries, public.log_secrets, public.save_requests, public.portal_requests, public.combats;

create policy campaign_channel_read on realtime.messages for select to authenticated
  using (
    realtime.messages.extension in ('broadcast', 'presence')
    and (select realtime.topic()) like 'campaign:%'
    and public.is_member(substr((select realtime.topic()), 10))
  );
create policy campaign_channel_write on realtime.messages for insert to authenticated
  with check (
    realtime.messages.extension in ('broadcast', 'presence')
    and (select realtime.topic()) like 'campaign:%'
    and public.is_member(substr((select realtime.topic()), 10))
  );

-- ——— Файлы карт: приватный бакет, папка = id кампании ———
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('maps', 'maps', false, 26214400, array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'])
on conflict (id) do nothing;

create policy maps_read on storage.objects for select to authenticated
  using (bucket_id = 'maps' and public.is_applicant((storage.foldername(name))[1]));
create policy maps_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'maps' and public.is_master((storage.foldername(name))[1]));
create policy maps_update on storage.objects for update to authenticated
  using (bucket_id = 'maps' and public.is_master((storage.foldername(name))[1]));
create policy maps_delete on storage.objects for delete to authenticated
  using (bucket_id = 'maps' and public.is_master((storage.foldername(name))[1]));
