-- Имя героя на карте (#203, 06.11, sol0139: «дай токенам игроков менять имена, как существам: в листе ничего не
-- поменяется, а на карте будет короткое имя»). Поле токена mapName — внешний вид, как scale и light: владелец героя
-- (и мастер) меняет его у своего токена. Охранник guard_token — тот же, что в 20261030120000_own_tokens.sql, с mapName
-- в списке look. Права и триггер сохраняются (create or replace).
create or replace function public.guard_token()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  cid text := coalesce(new.campaign_id, old.campaign_id);
  me uuid := (select auth.uid());
  pos text[] := array['x', 'y', 'movedAt', 'rot'];
  -- mapName — имя героя на карте (#203): владелец героя задаёт сам, лист не меняется.
  look text[] := array['scale', 'light', 'aura', 'disengaged', 'darkvision', 'elevation', 'mapName'];
  ident text[] := array['name', 'nameHidden', 'img', 'size', 'disposition', 'mount', 'layer'];
  stats text[] := array['hpMax', 'ac', 'speed', 'initBonus', 'hp', 'tempHp', 'conditions'];
  own boolean;
  allowed text[];
  changed text[];
  rest text[];
  ref public.tokens;
  carried boolean := false;
  locked boolean := tg_op = 'UPDATE' and coalesce((old.data ->> 'locked')::boolean, false);
begin
  -- Без входа (служебный ключ, каскады при удалении аккаунта) охранник не мешает: у ролей API без входа нет прав на таблицу.
  if me is null then return new; end if;

  -- Сцена — из той же кампании (дублирует внешний ключ понятным отказом).
  if (tg_op = 'INSERT' or new.scene_id <> old.scene_id or new.campaign_id <> old.campaign_id)
     and not exists (select 1 from public.scenes s where s.id = new.scene_id and s.campaign_id = new.campaign_id) then
    raise exception 'Сцена из другой кампании' using errcode = '23514';
  end if;
  -- И1: у экземпляра с листом один токен на кампанию — «Герой на сцену» переносит его, а не ставит второй.
  -- Блокировка по паре кампания+лист: два одновременных запроса (две вкладки) не поставят двух.
  if new.character_id is not null and (tg_op = 'INSERT' or new.character_id is distinct from old.character_id
     or new.campaign_id <> old.campaign_id) then
    perform pg_advisory_xact_lock(hashtextextended('rsp-token-character:' || new.campaign_id || ':' || new.character_id, 0));
    if exists (select 1 from public.tokens t where t.campaign_id = new.campaign_id and t.character_id = new.character_id and t.id <> new.id) then
      raise exception 'Этот герой уже на карте — его переносят, второй токен не ставят' using errcode = '23505';
    end if;
  end if;
  -- Посадки верхом на одной сцене — по очереди: проверка цепочки ниже читает уже записанные посадки.
  if tg_op = 'UPDATE' and (new.data ->> 'riding') is not null and (new.data ->> 'riding') is distinct from (old.data ->> 'riding') then
    perform pg_advisory_xact_lock(hashtextextended('rsp-token-riding:' || new.scene_id, 0));
  end if;

  if public.is_master(cid) then return new; end if;
  -- Игрок не раздувает токен больше 64 КБ (старые большие токены мастера двигать по-прежнему можно).
  if octet_length(new.data::text) > 65536 and (tg_op = 'INSERT' or octet_length(new.data::text) > octet_length(old.data::text)) then
    raise exception 'Слишком много данных в токене' using errcode = '54000';
  end if;

  if tg_op = 'INSERT' then
    if new.hidden then raise exception 'Скрывает только мастер' using errcode = '42501'; end if;
    if coalesce((new.data ->> 'locked')::boolean, false) then raise exception 'Закрепляет мастер' using errcode = '42501'; end if;
    if (new.data ->> 'riding') is not null then raise exception 'Сесть верхом можно после постановки' using errcode = '42501'; end if;
    if (new.data ->> 'kind') = 'hero' then
      if not public.is_my_character(cid, new.character_id) then raise exception 'Это герой другого игрока' using errcode = '42501'; end if;
      if new.owner_id is not null and new.owner_id <> me then raise exception 'Владельца меняет мастер' using errcode = '42501'; end if;
      return new;
    end if;
    if coalesce(new.data ->> 'kind', '') not in ('custom', 'foe') then raise exception 'Это ставит мастер' using errcode = '42501'; end if;
    if new.character_id is not null then raise exception 'Лист к токену привязывает мастер' using errcode = '42501'; end if;
    if new.owner_id is distinct from me then raise exception 'Свой токен и призыв — только от своего имени' using errcode = '42501'; end if;
    if (new.data ->> 'summonedBy') is not null then
      select * into ref from public.tokens t where t.id = new.data ->> 'summonedBy' and t.campaign_id = cid;
      if not found or not public.owns_token(ref) then raise exception 'Призывает владелец призывателя' using errcode = '42501'; end if;
    elsif (new.data ->> 'kind') = 'foe' then
      raise exception 'Существо игрок ставит только как призыв своего героя или токена' using errcode = '42501';
    end if;
    return new;
  end if;

  -- UPDATE
  if new.campaign_id <> old.campaign_id or new.character_id is distinct from old.character_id
     or new.owner_id is distinct from old.owner_id or new.ord <> old.ord then
    raise exception 'Это меняет мастер' using errcode = '42501';
  end if;
  if new.hidden <> old.hidden then raise exception 'Скрывает только мастер' using errcode = '42501'; end if;
  if (new.data -> 'kind') is distinct from (old.data -> 'kind') or (new.data -> 'monsterId') is distinct from (old.data -> 'monsterId') then
    raise exception 'Вид токена после создания не меняется' using errcode = '42501';
  end if;
  own := public.owns_token(old);
  if new.scene_id <> old.scene_id and not own then raise exception 'Это меняет мастер' using errcode = '42501'; end if;

  if own and old.character_id is not null then
    allowed := pos || look;
  elsif own then
    allowed := pos || look || ident || stats;
  elsif public.can_move_token(old) then
    allowed := pos;
  else
    allowed := '{}';
  end if;

  select coalesce(array_agg(k), '{}') into changed from (
    select jsonb_object_keys(old.data) k union select jsonb_object_keys(new.data)
  ) s where (old.data -> s.k) is distinct from (new.data -> s.k);

  -- Закреплённый токен стоит на месте и для владельца (docs/data.md: не сдвигает никто, пока мастер не снимет замок).
  if locked and changed && pos then raise exception 'Токен закреплён мастером' using errcode = '42501'; end if;

  -- Езда: сесть может владелец всадника; спешиться — он, владелец ездового, кто тянет всадника; висячую ссылку снимает любой.
  if 'riding' = any (changed) then
    if (new.data ->> 'riding') is null then
      select * into ref from public.tokens t where t.id = old.data ->> 'riding';
      if found and not (own or 'x' = any (allowed) or public.owns_token(ref)) then
        raise exception 'Спешить может владелец всадника или ездового' using errcode = '42501';
      end if;
    else
      if not own then raise exception 'Сесть верхом может владелец всадника или мастер' using errcode = '42501'; end if;
      select * into ref from public.tokens t where t.id = new.data ->> 'riding' and t.campaign_id = cid;
      if not found or ref.scene_id <> new.scene_id or ref.hidden or ref.id = new.id then
        raise exception 'Ездового нет на этой сцене' using errcode = '42501';
      end if;
      if not coalesce((ref.data ->> 'mount')::boolean, false) then raise exception 'Это не ездовое' using errcode = '42501'; end if;
      if (ref.data ->> 'riding') is not null or exists (select 1 from public.tokens t where t.data ->> 'riding' = new.id) then
        raise exception 'Верхом нельзя ехать цепочкой' using errcode = '42501';
      end if;
    end if;
  end if;

  -- Призыватель не подменяется; ссылку снимает владелец призыва или любой, если призывателя уже нет.
  if 'summonedBy' = any (changed) then
    if (new.data ->> 'summonedBy') is not null then raise exception 'Призывателя не меняют' using errcode = '42501'; end if;
    if not own and exists (select 1 from public.tokens t where t.id = old.data ->> 'summonedBy') then
      raise exception 'Это меняет мастер' using errcode = '42501';
    end if;
  end if;

  select coalesce(array_agg(k), '{}') into rest from unnest(changed) k
  where k not in ('riding', 'summonedBy') and not (k = any (allowed));
  if cardinality(rest) = 0 then return new; end if;

  -- Всадник едет вместе с ездовым: меняются только место и время хода, всадник встаёт на новое место ездового.
  if rest <@ array['x', 'y', 'movedAt'] and (old.data ->> 'riding') is not null
     and (new.data ->> 'riding') is not distinct from (old.data ->> 'riding')
     and not locked and not old.hidden then
    select * into ref from public.tokens t where t.id = old.data ->> 'riding' and t.scene_id = new.scene_id;
    carried := found and public.can_move_token(ref)
      and abs(coalesce((ref.data ->> 'x')::numeric, 0) - coalesce((new.data ->> 'x')::numeric, 0)) < 0.5
      and abs(coalesce((ref.data ->> 'y')::numeric, 0) - coalesce((new.data ->> 'y')::numeric, 0)) < 0.5;
    if carried then return new; end if;
  end if;

  if rest && stats then raise exception 'Статы меняет владелец или мастер' using errcode = '42501'; end if;
  if rest && pos then raise exception 'Чужие токены двигает мастер' using errcode = '42501'; end if;
  raise exception 'Нельзя менять «%» у этого токена', rest[1] using errcode = '42501';
end $$;
