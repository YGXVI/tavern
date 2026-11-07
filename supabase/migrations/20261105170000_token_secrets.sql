-- Тайное мастера в токенах (аудит 04.11, #204; решение YGXVI 05.11 — вариант A плана
-- docs/audits/2026-11-05-plan-secrets.md, этап «токены»). Раньше интерфейс прятал от игроков точные хиты врагов,
-- настоящее имя за «Неизвестным существом», «скрытого врага» и заметку мастера, но строка tokens отдавала их всем
-- участникам. Теперь эти поля хранятся в token_secrets (читает только мастер), а публичная строка несёт:
--   _s     — список полей, которые лежат в секрете (клиент мастера подставляет их обратно);
--   wound  — степень ранения вместо точных хитов: full | hurt | bloodied | critical | down.
--
-- Раскладку делает триггер на каждой записи токена, поэтому все прежние пути записи (вставка, целая строка,
-- patch_token, move_tokens, place_creature, отвязка всадников) работают без изменений:
--   * мастер пишет полные данные — что в них есть, то и правда; поля из _s, которых в записи нет, берутся из секрета;
--   * у остальных _s берётся из прежней строки — подменить список и стереть секрет игрок не может.
-- Что тайное:
--   * hp, hpMax, tempHp — у токенов без героя, владельца и призывателя (враги и NPC мастера), если в кампании
--     «Хиты врагов для игроков» не «Точные числа» (settings.playersSeeHp <> 'exact');
--   * name и monsterId — при nameHidden (кроме героев);
--   * disposition = 'secret' («скрытый враг»; игроки видят союзника);
--   * note — заметка мастера, всегда.

create table public.token_secrets (
  token_id text primary key,
  campaign_id text not null references public.campaigns(id) on delete cascade,
  data jsonb not null default '{}'::jsonb
);
create index token_secrets_campaign on public.token_secrets(campaign_id);
alter table public.token_secrets enable row level security;
create policy token_secrets_master_read on public.token_secrets for select to authenticated using (public.is_master(campaign_id));
revoke all on public.token_secrets from public, anon, authenticated;
grant select on public.token_secrets to authenticated;
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'token_secrets') then
    alter publication supabase_realtime add table public.token_secrets;
  end if;
end $$;

-- Степень ранения — как woundLabel в dist/js/data/rules.js.
create function public.token_wound(hp jsonb, mx jsonb) returns text
language plpgsql immutable set search_path = '' as $$
declare h numeric; m numeric;
begin
  if jsonb_typeof(mx) is distinct from 'number' or (mx #>> '{}')::numeric <= 0 then return null; end if;
  m := (mx #>> '{}')::numeric;
  h := case when jsonb_typeof(hp) = 'number' then (hp #>> '{}')::numeric else 0 end;
  if h <= 0 then return 'down'; end if;
  if h / m >= 1 then return 'full'; end if;
  if h / m > 0.5 then return 'hurt'; end if;
  if h / m > 0.25 then return 'bloodied'; end if;
  return 'critical';
end $$;

-- Полные данные токена: публичная строка + секрет. Секрет подставляется только мастеру кампании.
create function public.token_full(t public.tokens) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb; k text; d jsonb := t.data;
begin
  if not public.is_master(t.campaign_id) then return d; end if;
  select data into s from public.token_secrets where token_id = t.id;
  d := d - '_s' - 'wound';
  if s is not null then
    for k in select jsonb_array_elements_text(case when jsonb_typeof(t.data -> '_s') = 'array' then t.data -> '_s' else '[]' end) loop
      if not d ? k and s ? k then d := d || jsonb_build_object(k, s -> k); end if;
    end loop;
  end if;
  return d;
end $$;
revoke execute on function public.token_full(public.tokens) from public, anon;
grant execute on function public.token_full(public.tokens) to authenticated;

create function public.token_split() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  sec_old jsonb := '{}'; held jsonb; fd jsonb; k text; keys text[] := '{}'; present text[];
  conceal boolean; exact boolean; pub jsonb; sec jsonb; w text;
begin
  if tg_op = 'UPDATE' then
    select data into sec_old from public.token_secrets where token_id = old.id;
    sec_old := coalesce(sec_old, '{}');
  end if;
  held := case when tg_op = 'UPDATE' and not public.is_master(new.campaign_id) then old.data -> '_s' else new.data -> '_s' end;
  if jsonb_typeof(held) is distinct from 'array' then held := '[]'; end if;
  fd := new.data - '_s' - 'wound';
  for k in select jsonb_array_elements_text(held) loop
    if not fd ? k and sec_old ? k then fd := fd || jsonb_build_object(k, sec_old -> k); end if;
  end loop;

  conceal := coalesce(fd ->> 'kind', '') not in ('hero', 'item') and new.owner_id is null and new.character_id is null
    and fd ->> 'summonedBy' is null;
  select coalesce(c.data #>> '{settings,playersSeeHp}', 'status') = 'exact' into exact from public.campaigns c where c.id = new.campaign_id;
  if conceal and not coalesce(exact, false) then keys := keys || array['hp', 'hpMax', 'tempHp']; end if;
  if fd ->> 'kind' is distinct from 'hero' and fd -> 'nameHidden' = 'true'::jsonb then keys := keys || array['name', 'monsterId']; end if;
  if fd ->> 'disposition' = 'secret' then keys := keys || array['disposition']; end if;
  keys := keys || array['note'];
  select coalesce(array_agg(x), '{}') into present from unnest(keys) x where fd ? x;

  sec := coalesce((select jsonb_object_agg(x, fd -> x) from unnest(present) x), '{}');
  pub := fd - present;
  if 'hpMax' = any (present) then
    w := public.token_wound(fd -> 'hp', fd -> 'hpMax');
    if w is not null then pub := pub || jsonb_build_object('wound', w); end if;
  end if;
  if cardinality(present) > 0 then pub := pub || jsonb_build_object('_s', to_jsonb(present)); end if;
  new.data := pub;

  if sec = '{}'::jsonb then
    delete from public.token_secrets where token_id = new.id;
  else
    insert into public.token_secrets(token_id, campaign_id, data) values (new.id, new.campaign_id, sec)
    on conflict (token_id) do update set data = excluded.data, campaign_id = excluded.campaign_id
      where public.token_secrets.data is distinct from excluded.data or public.token_secrets.campaign_id is distinct from excluded.campaign_id;
  end if;
  return new;
end $$;
revoke execute on function public.token_split() from public, anon, authenticated;
-- После tokens_approval и tokens_guard (BEFORE-триггеры идут по имени): охранники сверяют публичную строку.
create trigger tokens_secrets before insert or update on public.tokens for each row execute function public.token_split();

create function public.token_secret_drop() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.token_secrets where token_id = old.id;
  return null;
end $$;
revoke execute on function public.token_secret_drop() from public, anon, authenticated;
create trigger tokens_secret_drop after delete on public.tokens for each row execute function public.token_secret_drop();

-- Мастер переключил «Хиты врагов для игроков» — хиты переезжают между строкой и секретом у всех токенов кампании.
create function public.campaign_hp_view_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (old.data #> '{settings,playersSeeHp}') is distinct from (new.data #> '{settings,playersSeeHp}') then
    update public.tokens set data = data where campaign_id = new.id;
  end if;
  return null;
end $$;
revoke execute on function public.campaign_hp_view_changed() from public, anon, authenticated;
create trigger campaigns_hp_view after update on public.campaigns for each row execute function public.campaign_hp_view_changed();

-- Снятое поле уходит и из списка тайного: иначе триггер вернул бы его из секрета.
create or replace function public.patch_token(p_id text, p_set jsonb default '{}'::jsonb, p_unset text[] default '{}')
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare d jsonb;
begin
  if jsonb_typeof(p_set) is distinct from 'object' then raise exception 'Нужен объект полей' using errcode = '22023'; end if;
  update public.tokens t set data = ((case when jsonb_typeof(t.data -> '_s') = 'array' then jsonb_set(t.data, '{_s}', (t.data -> '_s') - p_unset) else t.data end)
      - p_unset) || (p_set - array['id', 'characterId', 'hidden', 'ownerId'])
  where t.id = p_id returning t.data into d;
  if not found then raise exception 'Токен удалён мастером' using errcode = 'P0002'; end if;
  return d;
end $$;

-- Хиты прибавкой считаются от настоящих хитов (у мастера — из секрета).
create or replace function public.adjust_token(p_id text, p_deltas jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare d jsonb; t public.tokens;
begin
  if jsonb_typeof(p_deltas) is distinct from 'object'
     or exists (select 1 from jsonb_each(p_deltas) e where e.key not in ('hp', 'tempHp') or jsonb_typeof(e.value) <> 'number') then
    raise exception 'Прибавкой меняются только хиты и временные хиты, числами' using errcode = '22023';
  end if;
  select * into t from public.tokens where id = p_id for update;
  if not found then raise exception 'Токен удалён мастером' using errcode = 'P0002'; end if;
  if t.character_id is not null then raise exception 'Хиты героя меняются в листе' using errcode = '42501'; end if;
  d := public.token_full(t);
  d := d
    || case when p_deltas ? 'hp' then jsonb_build_object('hp', least(
         greatest(0, round(case when jsonb_typeof(d -> 'hp') = 'number' then (d ->> 'hp')::numeric else 0 end
                           + (p_deltas ->> 'hp')::numeric)),
         case when jsonb_typeof(d -> 'hpMax') = 'number' then greatest(0, (d ->> 'hpMax')::numeric) else 1000000000 end)::int)
       else '{}'::jsonb end
    || case when p_deltas ? 'tempHp' then jsonb_build_object('tempHp',
         greatest(0, round(case when jsonb_typeof(d -> 'tempHp') = 'number' then (d ->> 'tempHp')::numeric else 0 end
                           + (p_deltas ->> 'tempHp')::numeric))::int)
       else '{}'::jsonb end;
  update public.tokens set data = d where id = p_id returning data into d;
  if not found then raise exception 'Токен удалён мастером' using errcode = 'P0002'; end if;
  return d;
end $$;

-- Перенос: уже стоящие токены раскладываются по новым правилам.
update public.tokens set data = data;
