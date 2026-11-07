-- Точечные функции боя и спасбросков игрока (аудит 04.11, #204; решение YGXVI 05.11 — вариант A плана
-- docs/audits/2026-11-05-plan-secrets.md, этап «бой»). Игрок больше не пишет строку боя или запроса спасброска
-- целиком: присылает только своё (инициатива, пройденное, конец хода, результат спасброска), сервер вносит это
-- в текущую строку под блокировкой. Повтор того же вызова ничего не меняет. Охранники guard_combat и
-- guard_save_request остаются второй линией: функции обновляют строку от имени вызывающего (auth.uid()).

-- ——— Бой ———
-- p_init: {tokenId: число} — вписывается, только пока инициатива участника не брошена (иначе пропуск: кто-то
-- бросил раньше); участники, которых уже нет в бою, пропускаются. p_moved: {tokenId: футы} — пройденное за ход.
-- p_ended: tokenId — «закончить ход», только если он сейчас ходит; ход уже передан — пропуск.
create function public.combat_player(p_campaign text, p_init jsonb default '{}', p_moved jsonb default '{}', p_ended text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare d jsonb; was jsonb; i int; k text; e jsonb;
begin
  if not public.is_member(p_campaign) then raise exception 'Кампания недоступна' using errcode = '42501'; end if;
  p_init := coalesce(p_init, '{}'); p_moved := coalesce(p_moved, '{}');
  if jsonb_typeof(p_init) <> 'object' or jsonb_typeof(p_moved) <> 'object' then
    raise exception 'Инициатива и пройденное — объекты {tokenId: число}' using errcode = '22023'; end if;
  select data into was from public.combats where campaign_id = p_campaign for update;
  if not found then raise exception 'Бой уже закончен' using errcode = 'P0002'; end if;
  d := was;
  for i in 0 .. coalesce(jsonb_array_length(d -> 'entries'), 0) - 1 loop
    e := d -> 'entries' -> i; k := e ->> 'tokenId';
    if p_init ? k and coalesce(e -> 'init', 'null'::jsonb) = 'null'::jsonb then
      d := jsonb_set(d, array['entries', i::text, 'init'], p_init -> k);
    end if;
  end loop;
  if p_moved <> '{}'::jsonb then d := jsonb_set(d, '{moved}', coalesce(d -> 'moved', '{}'::jsonb) || p_moved); end if;
  if p_ended is not null and d ->> 'current' = p_ended then d := d || jsonb_build_object('ended', p_ended); end if;
  if d <> was then update public.combats set data = d where campaign_id = p_campaign; end if;
  return d;
end $$;
revoke execute on function public.combat_player(text, jsonb, jsonb, text) from public, anon;
grant execute on function public.combat_player(text, jsonb, jsonb, text) to authenticated;

-- ——— Спасбросок ———
-- p_results: {tokenId: результат}. Уже записанный результат не переписывается (пропуск), остальное проверяет охранник.
create function public.save_result(p_request text, p_results jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.save_requests; d jsonb; k text;
begin
  if jsonb_typeof(p_results) is distinct from 'object' then
    raise exception 'Результаты — объект {tokenId: результат}' using errcode = '22023'; end if;
  select * into r from public.save_requests where id = p_request for update;
  if not found or not public.is_member(r.campaign_id) then raise exception 'Запрос спасброска закрыт' using errcode = 'P0002'; end if;
  d := r.data;
  for k in select jsonb_object_keys(p_results) loop
    if not coalesce(d -> 'results', '{}'::jsonb) ? k then
      d := jsonb_set(d, '{results}', coalesce(d -> 'results', '{}'::jsonb) || jsonb_build_object(k, p_results -> k));
    end if;
  end loop;
  if d <> r.data then update public.save_requests set data = d where id = p_request; end if;
  return d;
end $$;
revoke execute on function public.save_result(text, jsonb) from public, anon;
grant execute on function public.save_result(text, jsonb) to authenticated;

-- ——— Прямая правка строки — только мастер ———
drop policy combat_update on public.combats;
create policy combat_update on public.combats for update to authenticated
  using (public.is_master(campaign_id)) with check (public.is_master(campaign_id));
drop policy saves_update on public.save_requests;
create policy saves_update on public.save_requests for update to authenticated
  using (public.is_master(campaign_id)) with check (public.is_master(campaign_id));
