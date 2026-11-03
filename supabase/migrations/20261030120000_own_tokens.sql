-- TASK-123 (план TASK-097, ревизия 16f5111, подтверждена Ярой 30.10 15:20 +05:00).
-- Свои токены и призывы игрока, права на токен по матрице (design.md, раздел 3), несколько героев у игрока,
-- частичная правка, хиты прибавкой, совместное движение ездового и всадников.
-- Миграция только добавляет: новая колонка пустая, существующие строки не меняются.

-- ——— Владелец своего токена и призыва ———
alter table public.tokens add column owner_id uuid references public.profiles (id) on delete set null;
create index tokens_owner on public.tokens (campaign_id, owner_id);

-- Токен стоит на сцене своей кампании (review #126, п. 3): пара (scene_id, campaign_id) — внешним ключом.
-- not valid: старые строки не проверяются и не удаляются, новые и изменённые — проверяются для всех ролей.
create unique index scenes_id_campaign on public.scenes (id, campaign_id);
alter table public.tokens add constraint tokens_scene_campaign foreign key (scene_id, campaign_id)
  references public.scenes (id, campaign_id) on delete cascade not valid;

-- Герой вошедшего: по владельцу листа (у игрока может быть несколько героев) или по выбору в членстве.
-- Только пока вошедший — активный участник кампании (И4).
create or replace function public.is_my_character(c text, ch text)
returns boolean language sql stable security definer set search_path = '' as $$
  select ch is not null and public.is_member(c) and (
    exists (select 1 from public.characters x where x.id = ch and x.campaign_id = c and x.owner_id = (select auth.uid()))
    or public.my_character(c) is not distinct from ch
  );
$$;

-- Токен вошедшего: свой герой — по листу, свой токен и призыв — по owner_id.
create or replace function public.owns_token(t public.tokens)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when t.character_id is not null then public.is_my_character(t.campaign_id, t.character_id)
    else t.owner_id is not distinct from (select auth.uid()) and t.owner_id is not null and public.is_member(t.campaign_id)
  end;
$$;

-- Может ли вошедший двигать токен: мастер, владелец, а при открытом перемещении — любой видимый незакреплённый.
create or replace function public.can_move_token(t public.tokens)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_master(t.campaign_id) or public.owns_token(t) or (
    public.is_member(t.campaign_id) and not t.hidden and not coalesce((t.data ->> 'locked')::boolean, false)
    and coalesce((select (c.data #>> '{settings,openMovement}')::boolean from public.campaigns c where c.id = t.campaign_id), true)
  );
$$;

-- Свои токены и призывы вошедшего в кампании (бой и спасброски). Только для охранников: снаружи не вызывается,
-- иначе по ней видны id своих скрытых токенов (review #126, И7).
create or replace function public.owned_token_ids(c text)
returns text[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(t.id), '{}') from public.tokens t
  where t.campaign_id = c and t.character_id is null and t.owner_id = (select auth.uid()) and public.is_member(c);
$$;

-- ——— Охранник токена по матрице прав ———
-- Мастер — всё. Игрок:
--   ставит своего героя, свой токен (kind 'custom') или призыв (kind 'foe' со ссылкой summonedBy на свой токен),
--   не скрытым и не закреплённым, от своего имени;
--   свой герой — место, поворот, размер, свет, аура, высота, зрение, езда;
--   свой токен и призыв — ещё имя, картинка, размер, союзность, ездовое, слой, статы и хиты;
--   чужой видимый незакреплённый — место и поворот при открытом перемещении;
--   всадника двигает тот, кто двигает его ездовое, если всадник встаёт на место ездового (согласие дано посадкой);
--   закреплённый токен не двигает и не поворачивает никто, кроме мастера, — и владелец тоже.
-- Для всех вошедших, включая мастера: сцена из той же кампании; у героя один токен на кампанию (И1);
-- посадки верхом на сцене идут по очереди — цепочка не возникнет от двух одновременных посадок.
create or replace function public.guard_token()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  cid text := coalesce(new.campaign_id, old.campaign_id);
  me uuid := (select auth.uid());
  pos text[] := array['x', 'y', 'movedAt', 'rot'];
  look text[] := array['scale', 'light', 'aura', 'disengaged', 'darkvision', 'elevation'];
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

-- Удаление: мастер — любой; игрок — свой токен и призыв, героя убирает мастер.
create or replace function public.guard_token_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or public.is_master(old.campaign_id) then return old; end if;
  -- Удаляется сцена или кампания целиком — токены уходят вместе с ней.
  if not exists (select 1 from public.scenes s where s.id = old.scene_id) or not exists (select 1 from public.campaigns c where c.id = old.campaign_id) then
    return old;
  end if;
  if old.character_id is not null or not public.owns_token(old) then
    raise exception 'Удаляет мастер' using errcode = '42501';
  end if;
  return old;
end $$;
create trigger tokens_guard_delete before delete on public.tokens for each row execute function public.guard_token_delete();

-- После удаления: всадники спешиваются и остаются, призывы остаются без ссылки на призывателя (И5, решение В6).
create or replace function public.token_unlink()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.tokens set data = data - 'riding' where campaign_id = old.campaign_id and data ->> 'riding' = old.id;
  update public.tokens set data = data - 'summonedBy' where campaign_id = old.campaign_id and data ->> 'summonedBy' = old.id;
  return null;
end $$;
create trigger tokens_unlink after delete on public.tokens for each row execute function public.token_unlink();

-- Удалять игрок может видимые токены кампании; что именно — решает охранник с понятным отказом.
drop policy tokens_delete on public.tokens;
create policy tokens_delete on public.tokens for delete to authenticated
  using (public.is_master(campaign_id) or (public.is_member(campaign_id) and not hidden));

-- ——— Частичная правка, хиты прибавкой, совместное движение ———
-- Все три работают от имени вошедшего (security invoker): RLS и охранник проверяют каждую строку.

-- Меняет только переданные поля data, остальное — как на сервере сейчас (решение В5).
create or replace function public.patch_token(p_id text, p_set jsonb default '{}'::jsonb, p_unset text[] default '{}')
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare d jsonb;
begin
  if jsonb_typeof(p_set) is distinct from 'object' then raise exception 'Нужен объект полей' using errcode = '22023'; end if;
  update public.tokens t set data = (t.data - p_unset) || (p_set - array['id', 'characterId', 'hidden', 'ownerId'])
  where t.id = p_id returning t.data into d;
  if not found then raise exception 'Токен удалён мастером' using errcode = 'P0002'; end if;
  return d;
end $$;

-- Хиты и временные хиты одноразового экземпляра — прибавкой к текущему значению на сервере:
-- два одновременных расхода учитываются оба (строка блокируется, второе обновление считает от первого).
-- Хиты не ниже 0 и не выше hpMax, если он задан числом (в том числе 0); временные — не ниже 0.
-- Нечисловые hp/hpMax на токене считаются: хиты — 0, максимума нет. Хиты героя — в листе (TASK-004).
create or replace function public.adjust_token(p_id text, p_deltas jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare d jsonb;
begin
  if jsonb_typeof(p_deltas) is distinct from 'object'
     or exists (select 1 from jsonb_each(p_deltas) e where e.key not in ('hp', 'tempHp') or jsonb_typeof(e.value) <> 'number') then
    raise exception 'Прибавкой меняются только хиты и временные хиты, числами' using errcode = '22023';
  end if;
  if exists (select 1 from public.tokens t where t.id = p_id and t.character_id is not null) then
    raise exception 'Хиты героя меняются в листе' using errcode = '42501';
  end if;
  update public.tokens t set data = t.data
    || case when p_deltas ? 'hp' then jsonb_build_object('hp', least(
         greatest(0, round(case when jsonb_typeof(t.data -> 'hp') = 'number' then (t.data ->> 'hp')::numeric else 0 end
                           + (p_deltas ->> 'hp')::numeric)),
         case when jsonb_typeof(t.data -> 'hpMax') = 'number' then greatest(0, (t.data ->> 'hpMax')::numeric) else 1000000000 end)::int)
       else '{}'::jsonb end
    || case when p_deltas ? 'tempHp' then jsonb_build_object('tempHp',
         greatest(0, round(case when jsonb_typeof(t.data -> 'tempHp') = 'number' then (t.data ->> 'tempHp')::numeric else 0 end
                           + (p_deltas ->> 'tempHp')::numeric))::int)
       else '{}'::jsonb end
  where t.id = p_id returning t.data into d;
  if not found then raise exception 'Токен удалён мастером' using errcode = 'P0002'; end if;
  return d;
end $$;

-- Двигает несколько токенов одной транзакцией: при отказе по любому не двигается никто.
-- Ездовые обновляются первыми — всадник встаёт на их новое место (правило охранника).
create or replace function public.move_tokens(p_scene text, p_moves jsonb)
returns int language plpgsql security invoker set search_path = '' as $$
declare m jsonb; bad text; n int := 0;
begin
  if jsonb_typeof(p_moves) is distinct from 'array' or jsonb_array_length(p_moves) not between 1 and 50 then
    raise exception 'Нужен список от 1 до 50 перемещений' using errcode = '22023';
  end if;
  for m in
    select e.value from jsonb_array_elements(p_moves) with ordinality e(value, i)
    left join public.tokens t on t.id = e.value ->> 'id'
    order by coalesce((t.data ->> 'mount')::boolean, false) desc, e.i
  loop
    select k into bad from jsonb_object_keys(m - 'id') k where k not in ('x', 'y', 'movedAt', 'rot') limit 1;
    if bad is not null then raise exception 'Перемещение меняет только место и поворот, не «%»', bad using errcode = '22023'; end if;
    update public.tokens t set data = t.data || (m - 'id') where t.id = m ->> 'id' and t.scene_id = p_scene;
    if not found then raise exception 'Токен удалён мастером' using errcode = 'P0002'; end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ——— Бой и спасброски: свои призывы — как свои герои ———
-- Спасбросок: результат за любого героя (решение 30.10 09:19) и за свои токены, один раз.
create or replace function public.guard_save_request()
returns trigger language plpgsql security definer set search_path = '' as $$
declare k text; actors text[] := public.hero_token_ids(old.campaign_id) || public.owned_token_ids(old.campaign_id);
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
    if not coalesce(old.data -> 'results', '{}') ? k and not (k = any (actors)) then
      raise exception 'Спасбросок игрок вписывает за героя или свой призыв, за существ — мастер' using errcode = '42501';
    end if;
  end loop;
  return new;
end $$;

-- Бой: инициатива любого героя и своего призыва (один раз), движение видимых токенов,
-- конец хода героя или своего призыва. Очередь (в том числе добавление призыва), раунд и ходы монстров — мастер.
create or replace function public.guard_combat()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  actors text[] := public.hero_token_ids(old.campaign_id) || public.owned_token_ids(old.campaign_id);
  visible text[] := public.visible_token_ids(old.campaign_id);
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
    if (o - 'init') <> (nw - 'init') or (o -> 'init') <> 'null'::jsonb or not ((o ->> 'tokenId') = any (actors)) then
      raise exception 'Инициативу героя и своего призыва бросают один раз; монстров — мастер' using errcode = '42501';
    end if;
  end loop;
  for k in select jsonb_object_keys(coalesce(old.data -> 'moved', '{}')) union select jsonb_object_keys(coalesce(new.data -> 'moved', '{}')) loop
    if (old.data #> array['moved', k]) is distinct from (new.data #> array['moved', k]) and not (k = any (visible)) then
      raise exception 'Движение скрытых существ ведёт мастер' using errcode = '42501';
    end if;
  end loop;
  if (old.data -> 'ended') is distinct from (new.data -> 'ended') then
    if not ((old.data ->> 'current') = any (actors)) or (new.data ->> 'ended') is distinct from (old.data ->> 'current') then
      raise exception 'Закончить можно ход героя или своего призыва, ход монстра — мастер' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

-- ——— Несколько героев у игрока ———
-- Игрок берёт ещё одного свободного героя; первый выбранный остаётся героем в членстве.
-- Занят герой, которого выбрал другой активный игрок или которым владеет другой участник кампании (в том числе
-- ожидающий). Герой ушедшего игрока свободен. Места считают игроков, не героев.
-- Строка героя блокируется до проверки (review #126, п. 2): второй одновременный запрос ждёт и видит нового владельца — «taken».
create or replace function public.claim_character(p_campaign text, p_character text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); mem public.campaign_members; ch public.characters;
begin
  select * into mem from public.campaign_members m where m.campaign_id = p_campaign and m.user_id = me and m.status = 'active';
  if not found or mem.role <> 'player' then raise exception 'Выбирает героя игрок кампании' using errcode = '42501'; end if;
  select * into ch from public.characters x where x.id = p_character and x.campaign_id = p_campaign for update;
  if not found then raise exception 'Нет такого героя' using errcode = 'P0002'; end if;
  if exists (select 1 from public.campaign_members m where m.campaign_id = p_campaign and m.user_id <> me
             and ((m.status = 'active' and m.character_id = p_character) or m.user_id = ch.owner_id)) then
    return jsonb_build_object('ok', false, 'error', 'taken');
  end if;
  perform set_config('rasputye.claim', p_character, true);
  if mem.character_id is null then
    update public.campaign_members set character_id = p_character where campaign_id = p_campaign and user_id = me;
  end if;
  update public.characters set owner_id = me, data = jsonb_set(data, '{ownerId}', to_jsonb(me::text)) where id = p_character;
  perform set_config('rasputye.claim', '', true);
  return jsonb_build_object('ok', true);
end $$;

-- ——— Картинки своих токенов: приватный бакет, путь <campaign>/<user>/<файл> ———
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tokens', 'tokens', false, 5242880, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create policy token_files_read on storage.objects for select to authenticated
  using (bucket_id = 'tokens' and public.is_member((storage.foldername(name))[1]));
create policy token_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'tokens' and public.is_member((storage.foldername(name))[1])
              and (storage.foldername(name))[2] = (select auth.uid())::text);
create policy token_files_update on storage.objects for update to authenticated
  using (bucket_id = 'tokens' and public.is_member((storage.foldername(name))[1])
         and (storage.foldername(name))[2] = (select auth.uid())::text);
create policy token_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'tokens' and (public.is_master((storage.foldername(name))[1])
         or (public.is_member((storage.foldername(name))[1]) and (storage.foldername(name))[2] = (select auth.uid())::text)));

-- ——— Доступ к функциям ———
revoke execute on function public.guard_token(), public.guard_token_delete(), public.token_unlink(),
  public.guard_save_request(), public.guard_combat(),
  public.owns_token(public.tokens), public.can_move_token(public.tokens)
from public, anon, authenticated;
revoke execute on function public.is_my_character(text, text),
  public.patch_token(text, jsonb, text[]), public.adjust_token(text, jsonb), public.move_tokens(text, jsonb)
from public, anon;
grant execute on function public.is_my_character(text, text),
  public.patch_token(text, jsonb, text[]), public.adjust_token(text, jsonb), public.move_tokens(text, jsonb)
to authenticated;
-- Списки id токенов — только для охранников (security definer): снаружи по ним видны id скрытых токенов (И7).
-- hero_token_ids с TASK-002 отдавал и id скрытых героев — закрываем вместе.
revoke execute on function public.owned_token_ids(text), public.hero_token_ids(text) from public, anon, authenticated;
