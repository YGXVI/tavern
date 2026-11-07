-- Скрытые участники боя (DEC-019 D4, план тайного): полная строка боя теперь только у мастера, игроки читают очищенную копию.
-- Копию держит база: в ней нет записей скрытых токенов мастера, их пройденного и реакций, а «чей ход» скрыт, если ходит такой токен.
-- Токены игроков и героев остаются: владелец должен бросать инициативу, даже если его спрятали.
create table public.combat_public (
  campaign_id text primary key references public.campaigns (id) on delete cascade,
  data jsonb not null default '{}'::jsonb
);
alter table public.combat_public enable row level security;
create policy combat_public_read on public.combat_public for select to authenticated using (public.is_member(campaign_id));
revoke all on public.combat_public from public, anon, authenticated;
grant select on public.combat_public to authenticated;

create function public.combat_public_view(p_campaign text, d jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare secret text[]; k text;
begin
  select coalesce(array_agg(id), '{}') into secret from public.tokens
    where campaign_id = p_campaign and hidden and owner_id is null and character_id is null;
  if d ? 'entries' then
    d := jsonb_set(d, '{entries}', coalesce((select jsonb_agg(e) from jsonb_array_elements(d -> 'entries') e where not (e ->> 'tokenId' = any(secret))), '[]'::jsonb));
  end if;
  foreach k in array secret loop
    if d ? 'moved' then d := jsonb_set(d, '{moved}', (d -> 'moved') - k); end if;
    if d ? 'reacted' then d := jsonb_set(d, '{reacted}', (d -> 'reacted') - k); end if;
  end loop;
  -- Ходит скрытый: у игрока нет такого участника, поэтому очередь показывает «ход мастера». Номер хода выдал бы место в очереди.
  if d ->> 'current' = any(secret) then d := d || '{"current":"?"}'::jsonb; end if;
  if d ->> 'ended' = any(secret) then d := d - 'ended'; end if;
  return d - 'turn' || '{"turn":0}'::jsonb;
end $$;
revoke execute on function public.combat_public_view(text, jsonb) from public, anon, authenticated;

create function public.combat_public_sync(p_campaign text) returns void
language plpgsql security definer set search_path = '' as $$
declare d jsonb;
begin
  select data into d from public.combats where campaign_id = p_campaign;
  if d is null then delete from public.combat_public where campaign_id = p_campaign; return; end if;
  insert into public.combat_public (campaign_id, data) values (p_campaign, public.combat_public_view(p_campaign, d))
    on conflict (campaign_id) do update set data = excluded.data where public.combat_public.data is distinct from excluded.data;
end $$;
revoke execute on function public.combat_public_sync(text) from public, anon, authenticated;

create function public.combats_to_public() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.combat_public_sync(coalesce(new.campaign_id, old.campaign_id));
  return null;
end $$;
revoke execute on function public.combats_to_public() from public, anon, authenticated;
create trigger combats_public after insert or update or delete on public.combats for each row execute function public.combats_to_public();

-- Мастер спрятал или показал токен посреди боя: копия меняется сразу.
create function public.tokens_to_combat_public() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.hidden is distinct from old.hidden then perform public.combat_public_sync(new.campaign_id); end if;
  return null;
end $$;
revoke execute on function public.tokens_to_combat_public() from public, anon, authenticated;
create trigger tokens_combat_public after update of hidden on public.tokens for each row execute function public.tokens_to_combat_public();

-- Игроку — только копия. Мастер читает полную строку, как раньше.
drop policy combat_read on public.combats;
create policy combat_read on public.combats for select to authenticated using (public.is_master(campaign_id));

-- Ответ функции игроку не должен раскрывать скрытых.
create or replace function public.combat_player(p_campaign text, p_init jsonb default '{}', p_moved jsonb default '{}', p_ended text default null)
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
  return public.combat_public_view(p_campaign, d);
end $$;

insert into public.combat_public (campaign_id, data) select campaign_id, public.combat_public_view(campaign_id, data) from public.combats;
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'combat_public') then
    alter publication supabase_realtime add table public.combat_public;
  end if;
end $$;
