-- TASK-002 · решение sol0139 (30.10 09:19 +05:00): игрок может бросать и ходить за другого героя —
-- кто-то сидит в Discord с телефона и не может открыть стол. Монстров по-прежнему ведёт мастер.

-- Токены героев кампании (любых игроков).
create or replace function public.hero_token_ids(c text)
returns text[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(t.id), '{}') from public.tokens t where t.campaign_id = c and t.character_id is not null;
$$;
-- Видимые игрокам токены кампании (для учёта движения).
create or replace function public.visible_token_ids(c text)
returns text[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(t.id), '{}') from public.tokens t where t.campaign_id = c and not t.hidden;
$$;
revoke execute on function public.hero_token_ids(text), public.visible_token_ids(text) from anon, public;
grant execute on function public.hero_token_ids(text), public.visible_token_ids(text) to authenticated;

-- Спасбросок: результат за любого героя, один раз.
create or replace function public.guard_save_request()
returns trigger language plpgsql security definer set search_path = '' as $$
declare k text; heroes text[] := public.hero_token_ids(old.campaign_id);
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
    if not coalesce(old.data -> 'results', '{}') ? k and not (k = any (heroes)) then
      raise exception 'Спасбросок игрок вписывает за героя, за существ — мастер' using errcode = '42501';
    end if;
  end loop;
  return new;
end $$;

-- Бой: инициатива любого героя (если ещё не брошена), движение любого видимого токена,
-- конец хода любого героя. Очередь, раунд и ходы монстров — мастер.
create or replace function public.guard_combat()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  heroes text[] := public.hero_token_ids(old.campaign_id);
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
    if (o - 'init') <> (nw - 'init') or (o -> 'init') <> 'null'::jsonb or not ((o ->> 'tokenId') = any (heroes)) then
      raise exception 'Инициативу героя бросают один раз; монстров — мастер' using errcode = '42501';
    end if;
  end loop;
  for k in select jsonb_object_keys(coalesce(old.data -> 'moved', '{}')) union select jsonb_object_keys(coalesce(new.data -> 'moved', '{}')) loop
    if (old.data #> array['moved', k]) is distinct from (new.data #> array['moved', k]) and not (k = any (visible)) then
      raise exception 'Движение скрытых существ ведёт мастер' using errcode = '42501';
    end if;
  end loop;
  if (old.data -> 'ended') is distinct from (new.data -> 'ended') then
    if not ((old.data ->> 'current') = any (heroes)) or (new.data ->> 'ended') is distinct from (old.data ->> 'current') then
      raise exception 'Закончить можно ход героя, ход монстра — мастер' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.guard_save_request(), public.guard_combat() from public, anon, authenticated;
