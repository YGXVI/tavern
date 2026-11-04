-- Охранник боя: одна версия для веток test и rules5e (слияние 05.11).
-- 20261030140000 (лист, TASK-004) добавил обход для атомарного архива листа, 20261104170000 (аудит 04.11, #204) —
-- проверки типов, но на основе версии без обхода. Здесь — обе части; миграция последняя по времени, поэтому
-- итог одинаков при любом порядке применения прежних двух. guard_save_request в 20261104170000 не меняется.

create or replace function public.guard_combat()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  actors text[] := public.hero_token_ids(old.campaign_id) || public.owned_token_ids(old.campaign_id);
  visible text[] := public.visible_token_ids(old.campaign_id);
  n int; i int; o jsonb; nw jsonb; k text;
  fixed text[] := array['entries', 'moved', 'ended'];
begin
  if new.campaign_id = old.campaign_id and public.character_archive_active(old.campaign_id) then return new; end if;
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

revoke execute on function public.guard_combat() from public, anon, authenticated;
