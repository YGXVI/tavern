-- TASK-097 (остаток, #204): существо на карту одной транзакцией, хиты прибавкой с ключом повтора,
-- снимки существ кампании в реальном времени. Права прежние: функции — security invoker, работают RLS и охранники.

-- ——— 1. Снимки существ кампании в Realtime (раньше видны были только после перезагрузки) ———
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'campaign_creatures') then
    alter publication supabase_realtime add table public.campaign_creatures;
  end if;
end $$;

-- ——— 2. Своё существо на карту (TASK-097 1.2b): снимок в кампанию и токен — вместе или никак ———
-- Снимок вставляется, только если его ещё нет (второй токен того же существа не меняет снимок).
create function public.place_creature(p_creature jsonb, p_token jsonb)
returns text language plpgsql security invoker set search_path = '' as $$
declare cr public.campaign_creatures; t public.tokens;
begin
  if jsonb_typeof(p_creature) is distinct from 'object' or jsonb_typeof(p_token) is distinct from 'object' then
    raise exception 'Нужны снимок существа и токен' using errcode = '22023'; end if;
  cr := jsonb_populate_record(null::public.campaign_creatures, p_creature);
  t := jsonb_populate_record(null::public.tokens, p_token);
  if cr.campaign_id is distinct from t.campaign_id or (t.data ->> 'monsterId') is distinct from ('lib:' || cr.id) then
    raise exception 'Токен должен ссылаться на снимок своей кампании' using errcode = '22023'; end if;
  insert into public.campaign_creatures(campaign_id, id, owner_id, source_id, data)
    values (cr.campaign_id, cr.id, cr.owner_id, cr.source_id, cr.data) on conflict (campaign_id, id) do nothing;
  insert into public.tokens(id, campaign_id, scene_id, character_id, hidden, ord, data, owner_id)
    values (t.id, t.campaign_id, t.scene_id, t.character_id, coalesce(t.hidden, false), coalesce(t.ord, 0), coalesce(t.data, '{}'::jsonb), t.owner_id);
  return t.id;
end $$;
revoke execute on function public.place_creature(jsonb, jsonb) from public, anon;
grant execute on function public.place_creature(jsonb, jsonb) to authenticated;

-- ——— 3. Хиты прибавкой с ключом повтора (TASK-097 2.6, аудит #57) ———
-- Повтор после потерянного ответа с тем же operationId возвращает прежний ответ и не применяет дельту второй раз.
create table public.token_operations (
  caller_id uuid not null default auth.uid(),
  operation_id uuid not null,
  campaign_id text not null references public.campaigns(id) on delete cascade,
  token_id text not null,
  request jsonb not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (caller_id, operation_id)
);
alter table public.token_operations enable row level security;
create policy token_operations_own on public.token_operations for select to authenticated using (caller_id = (select auth.uid()));
create policy token_operations_insert on public.token_operations for insert to authenticated
  with check (caller_id = (select auth.uid()) and public.is_member(campaign_id));
revoke all on public.token_operations from public, anon;
grant select, insert on public.token_operations to authenticated;

create function public.adjust_token_once(p_id text, p_deltas jsonb, p_operation uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare prior public.token_operations; req jsonb; res jsonb; cid text;
begin
  if p_operation is null then raise exception 'Нужен ID операции' using errcode = '22023'; end if;
  req := jsonb_build_object('tokenId', p_id, 'deltas', p_deltas);
  perform pg_advisory_xact_lock(hashtextextended((select auth.uid())::text || ':' || p_operation::text, 0));
  select * into prior from public.token_operations where caller_id = (select auth.uid()) and operation_id = p_operation;
  if found then
    if prior.request <> req then raise exception 'ID операции уже использован для другого запроса' using errcode = '22023'; end if;
    return prior.response || '{"replayed":true}'::jsonb;
  end if;
  select campaign_id into cid from public.tokens where id = p_id;
  if not found then raise exception 'Токен удалён мастером' using errcode = 'P0002'; end if;
  res := jsonb_build_object('data', public.adjust_token(p_id, p_deltas));
  insert into public.token_operations(caller_id, operation_id, campaign_id, token_id, request, response)
    values ((select auth.uid()), p_operation, cid, p_id, req, res);
  return res || '{"replayed":false}'::jsonb;
end $$;
revoke execute on function public.adjust_token_once(text, jsonb, uuid) from public, anon;
grant execute on function public.adjust_token_once(text, jsonb, uuid) to authenticated;
