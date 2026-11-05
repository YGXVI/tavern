-- Аудит серверного режима 04.11 (#204): типы в охранниках боя и спасбросков.
-- Игрок мог записать в инициативу, пройденные футы и результат спасброска строку или объект вместо числа:
-- другие клиенты экранируют вывод, но сервер должен принимать только ожидаемые типы. Права не меняются —
-- добавлены только проверки формы того, что игроку и так разрешено писать. Мастер по-прежнему пишет свободно.

-- Число jsonb в пределах (null, строки, объекты и бесконечности — нет).
create or replace function public.jsonb_number_between(v jsonb, lo numeric, hi numeric)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(jsonb_typeof(v) = 'number' and (v #>> '{}')::numeric between lo and hi, false)
$$;

-- Результат спасброска игрока: { total: число, nat?: число|null, ok?: логическое, by?: 'player'|'master', detail?: текст до 500 }.
create or replace function public.valid_save_result(r jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(
    jsonb_typeof(r) = 'object'
    and public.jsonb_number_between(r -> 'total', -100, 1000)
    and (not r ? 'nat' or jsonb_typeof(r -> 'nat') = 'null' or public.jsonb_number_between(r -> 'nat', 1, 20))
    and (not r ? 'ok' or jsonb_typeof(r -> 'ok') = 'boolean')
    and (not r ? 'by' or (r ->> 'by') in ('player', 'master'))
    and (not r ? 'detail' or (jsonb_typeof(r -> 'detail') = 'string' and length(r ->> 'detail') <= 500))
    and (select count(*) from jsonb_object_keys(r) k where k not in ('total', 'nat', 'ok', 'by', 'detail')) = 0,
  false)
$$;

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
    if not coalesce(old.data -> 'results', '{}') ? k and not public.valid_save_result(new.data #> array['results', k]) then
      raise exception 'Результат спасброска: число total, числа или null в nat, логическое ok, короткий текст' using errcode = '22023';
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
    if not public.jsonb_number_between(nw -> 'init', -50, 100) then
      raise exception 'Инициатива — число' using errcode = '22023';
    end if;
  end loop;
  for k in select jsonb_object_keys(coalesce(old.data -> 'moved', '{}')) union select jsonb_object_keys(coalesce(new.data -> 'moved', '{}')) loop
    if (old.data #> array['moved', k]) is distinct from (new.data #> array['moved', k]) and not (k = any (visible)) then
      raise exception 'Движение скрытых существ ведёт мастер' using errcode = '42501';
    end if;
    if (old.data #> array['moved', k]) is distinct from (new.data #> array['moved', k])
       and not public.jsonb_number_between(new.data #> array['moved', k], 0, 100000) then
      raise exception 'Пройденное за ход — число футов' using errcode = '22023';
    end if;
  end loop;
  if (old.data -> 'ended') is distinct from (new.data -> 'ended') then
    if not ((old.data ->> 'current') = any (actors)) or (new.data ->> 'ended') is distinct from (old.data ->> 'current') then
      raise exception 'Закончить можно ход героя или своего призыва, ход монстра — мастер' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
