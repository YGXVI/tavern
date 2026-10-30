-- TASK-004: opt-in путь записи листа. Прежние миграции и guard_token не меняются.
alter table public.characters
  add column sheet_version bigint not null default 0 check (sheet_version >= 0),
  add column sheet_managed boolean not null default false,
  add column archived_at timestamptz,
  add constraint characters_campaign_identity unique (campaign_id, id);

create table public.character_controllers (
  campaign_id text not null,
  character_id text not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  granted_by uuid references public.profiles(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (campaign_id, character_id, user_id),
  foreign key (campaign_id, character_id) references public.characters(campaign_id, id) on delete cascade
);
create table public.character_operations (
  campaign_id text not null,
  caller_id uuid not null references public.profiles(id) on delete cascade,
  operation_id uuid not null,
  character_id text not null,
  kind text not null,
  request jsonb not null,
  response jsonb,
  transaction_id bigint not null default txid_current(),
  created_at timestamptz not null default now(),
  primary key (campaign_id, caller_id, operation_id),
  foreign key (campaign_id, character_id) references public.characters(campaign_id, id) on delete cascade
);
create table public.character_history (
  campaign_id text not null,
  character_id text not null,
  version bigint not null,
  author uuid references public.profiles(id) on delete set null,
  operation_id uuid,
  kind text not null,
  changes jsonb not null,
  at timestamptz not null default now(),
  primary key (campaign_id, character_id, version),
  foreign key (campaign_id, character_id) references public.characters(campaign_id, id) on delete cascade
);
alter table public.character_controllers enable row level security;
alter table public.character_operations enable row level security;
alter table public.character_history enable row level security;
create policy controllers_read on public.character_controllers for select to authenticated using (public.is_member(campaign_id));
create policy character_history_read on public.character_history for select to authenticated using (public.is_member(campaign_id));
revoke all on public.character_controllers, public.character_operations, public.character_history from public, anon, authenticated;
grant select on public.character_controllers, public.character_history to authenticated;

-- Внутренние помощники не дают API обойти проверяемую команду.
create function public.character_sheet_int(v jsonb, path text, low bigint default -9007199254740991, high bigint default 9007199254740991)
returns bigint language plpgsql immutable set search_path = '' as $$
declare n numeric;
begin
  if v is null or jsonb_typeof(v) <> 'number' then raise exception 'Нужно целое число: %', path using errcode = '22023'; end if;
  n := v::text::numeric;
  if n <> trunc(n) or n < low or n > high then raise exception 'Число вне диапазона: %', path using errcode = '22023'; end if;
  return n::bigint;
end $$;

create function public.validate_character_sheet(d jsonb, fields text[])
returns void language plpgsql security definer set search_path = '' as $$
declare k text; a text; v jsonb; item jsonb; n bigint;
begin
  if jsonb_typeof(d) is distinct from 'object' or octet_length(d::text) > 262144 then
    raise exception 'Лист должен быть объектом не больше 256 КиБ' using errcode = '22023';
  end if;
  foreach k in array fields loop
    v := d -> k;
    if v is null or v = 'null'::jsonb then continue; end if;
    if k = any(array['hp','hpMax','tempHp','level']) then
      n := public.character_sheet_int(v, k, 0);
      if k = 'level' and n = 0 then raise exception 'Уровень должен быть положительным' using errcode = '22023'; end if;
    elsif k = any(array['speed','darkvision']) then
      if jsonb_typeof(v) <> 'number' then raise exception 'Нужно число: %',k using errcode = '22023'; end if;
      if v::text::numeric < 0 or v::text::numeric > 9007199254740991 then raise exception 'Число вне диапазона: %',k using errcode = '22023'; end if;
    elsif k = any(array['ac','initBonus','profBonus']) then
      perform public.character_sheet_int(v, k);
    elsif k = 'stats' then
      if jsonb_typeof(v) <> 'object' then raise exception 'stats должен быть объектом' using errcode = '22023'; end if;
      for a in select jsonb_object_keys(v) loop
        if not (a = any(array['str','dex','con','int','wis','cha'])) then continue; end if; -- неизвестные legacy-ключи не исполняем и не стираем
        if v -> a <> 'null'::jsonb then perform public.character_sheet_int(v -> a, 'stats.' || a); end if;
      end loop;
    elsif k = 'profile' then
      if v #>> '{}' not in ('pc','creature','sidekick') then raise exception 'Неизвестный профиль листа' using errcode = '22023'; end if;
    elsif k = 'deathSaves' then
      if jsonb_typeof(v) <> 'object' or (v - array['s','f']) <> '{}'::jsonb then raise exception 'Нужны s и f спасбросков от смерти' using errcode = '22023'; end if;
      perform public.character_sheet_int(v -> 's', 'deathSaves.s', 0, 3);
      perform public.character_sheet_int(v -> 'f', 'deathSaves.f', 0, 3);
    elsif k = 'classes' then
      if jsonb_typeof(v) <> 'array' then raise exception 'classes должен быть списком' using errcode = '22023'; end if;
      for item in select value from jsonb_array_elements(v) loop
        if jsonb_typeof(item) <> 'object' then raise exception 'Нужна запись класса' using errcode = '22023'; end if;
        perform public.character_sheet_int(item -> 'levels', 'classes.levels', 1);
      end loop;
    elsif k = 'conditions' then
      if jsonb_typeof(v) <> 'array' then raise exception 'Нужен список состояний' using errcode = '22023'; end if;
      for item in select value from jsonb_array_elements(v) loop
        if jsonb_typeof(item) <> 'string' and (jsonb_typeof(item) <> 'object' or jsonb_typeof(item -> 'id') is distinct from 'string') then
          raise exception 'Нужно имя или ID состояния' using errcode = '22023';
        end if;
      end loop;
    elsif k = any(array['saves','skills','attacks','actions','bonusActions','reactions','spellSources','knownSpells','inventoryItems','featureEntries','resources','slotPools','hitDicePools']) then
      if jsonb_typeof(v) <> 'array' then raise exception 'Нужен список: %', k using errcode = '22023'; end if;
    elsif k = any(array['name','portrait','background','alignment','className','classId','raceName','raceId','notes']) then
      if jsonb_typeof(v) <> 'string' then raise exception 'Нужен текст: %', k using errcode = '22023'; end if;
      if k = 'name' and length(trim(v #>> '{}')) = 0 then raise exception 'Введите имя' using errcode = '22023'; end if;
    elsif k = any(array['spells','inventory','features','hitDice']) then
      if jsonb_typeof(v) not in ('string','array') then raise exception 'Нужен старый текст или список: %', k using errcode = '22023'; end if;
    elsif k = any(array['slots','sidekick','overrides','proficiencies','coins','movement','defenses','light','aura','concentration','statblock']) then
      if jsonb_typeof(v) <> 'object' then raise exception 'Нужен объект: %', k using errcode = '22023'; end if;
    end if;
  end loop;
  if d -> 'hp' <> 'null'::jsonb and d -> 'hpMax' <> 'null'::jsonb and d ? 'hp' and d ? 'hpMax'
    and public.character_sheet_int(d -> 'hp', 'hp', 0) > public.character_sheet_int(d -> 'hpMax', 'hpMax', 0) then
    raise exception 'Текущие HP превышают максимум' using errcode = '22023';
  end if;
  foreach k in array array['resources','slotPools','hitDicePools'] loop
    if not (k = any(fields)) or not (d ? k) or d -> k = 'null'::jsonb then continue; end if;
    if exists (select 1 from jsonb_array_elements(d -> k) x group by x ->> 'id' having count(*) > 1) then
      raise exception 'ID ресурсов должны быть уникальны' using errcode = '22023';
    end if;
    for item in select value from jsonb_array_elements(d -> k) loop
      if jsonb_typeof(item) <> 'object' or jsonb_typeof(item -> 'id') is distinct from 'string' or coalesce(length(item ->> 'id'),0) = 0 then raise exception 'Нужен ID ресурса' using errcode = '22023'; end if;
      a := case when k = 'hitDicePools' then 'total' else 'max' end;
      n := public.character_sheet_int(item -> a, k || '.' || a, 0);
      perform public.character_sheet_int(item -> 'spent', k || '.spent', 0, n);
    end loop;
  end loop;
  if 'slots' = any(fields) and d ? 'slots' and d -> 'slots' <> 'null'::jsonb then
    for a, item in select key, value from jsonb_each(d -> 'slots') loop
      if a !~ '^[1-9]$' then raise exception 'Неизвестный круг ячеек' using errcode = '22023'; end if;
      n := public.character_sheet_int(item -> 'max', 'slots.max', 0);
      perform public.character_sheet_int(item -> 'used', 'slots.used', 0, n);
    end loop;
  end if;
end $$;

create function public.character_sheet_delta(before_data jsonb, after_data jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select coalesce(jsonb_object_agg(k, jsonb_build_object('before',before_data -> k,'after',after_data -> k)), '{}'::jsonb)
  from (select jsonb_object_keys(before_data) k union select jsonb_object_keys(after_data) k) keys
  where (before_data -> k) is distinct from (after_data -> k);
$$;

create function public.character_sheet_merge(base jsonb, patch jsonb, depth int default 0)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare k text; result jsonb := base;
begin
  if depth > 32 then raise exception 'Слишком глубокая структура листа' using errcode = '22023'; end if;
  if jsonb_typeof(base) = 'object' and jsonb_typeof(patch) = 'object' then
    for k in select jsonb_object_keys(patch) loop
      result := jsonb_set(result,array[k],public.character_sheet_merge(base -> k,patch -> k,depth+1),true);
    end loop;
    return result;
  end if;
  return patch;
end $$;

create function public.character_sheet_guard()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare changed text[];
begin
  if tg_op = 'DELETE' then
    if old.sheet_managed and current_user in ('authenticated','anon')
      and exists(select 1 from public.campaigns where id = old.campaign_id) then
      raise exception 'Используйте архив листа' using errcode = '42501';
    end if;
    return old;
  end if;
  if current_user in ('authenticated','anon') then
    if not public.is_member(new.campaign_id) then raise exception 'Лист недоступен' using errcode = '42501'; end if;
    if tg_op = 'INSERT' then
      if new.sheet_version <> 0 or new.sheet_managed or new.archived_at is not null then raise exception 'Метаданные листа задаёт сервер' using errcode = '42501'; end if;
    else
      if old.sheet_managed then raise exception 'Используйте character_command с ожидаемой версией' using errcode = '42501'; end if;
      if new.id <> old.id or new.campaign_id <> old.campaign_id or new.sheet_version <> old.sheet_version
        or new.sheet_managed <> old.sheet_managed or new.archived_at is distinct from old.archived_at then
        raise exception 'Метаданные листа меняет сервер' using errcode = '42501';
      end if;
    end if;
    if not public.is_master(new.campaign_id) and
      ((coalesce(new.data ->> 'profile','pc') <> coalesce(case when tg_op = 'UPDATE' then old.data ->> 'profile' end,'pc'))
        or (new.data ->> 'profile' = 'sidekick' and (tg_op = 'INSERT' or (new.data -> 'level') is distinct from (old.data -> 'level')))) then
      raise exception 'Профиль и уровень Sidekick подтверждает мастер' using errcode = '42501';
    end if;
  end if;
  select coalesce(array_agg(k),'{}') into changed from (
    select jsonb_object_keys(case when tg_op = 'INSERT' then '{}'::jsonb else old.data end) k
    union select jsonb_object_keys(new.data)
  ) keys where tg_op = 'INSERT' or (old.data -> k) is distinct from (new.data -> k);
  perform public.validate_character_sheet(new.data, changed);
  if tg_op = 'UPDATE' then new.sheet_version := old.sheet_version + 1; end if;
  return new;
end $$;
create trigger characters_sheet_guard before insert or update or delete on public.characters for each row execute function public.character_sheet_guard();

create function public.character_sheet_history()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists(select 1 from public.character_operations o where o.campaign_id = new.campaign_id and o.character_id = new.id
    and o.transaction_id = txid_current() and o.response is null) then return new; end if;
  insert into public.character_history(campaign_id,character_id,version,author,kind,changes)
  values(new.campaign_id,new.id,new.sheet_version,auth.uid(),case when tg_op = 'INSERT' then 'create' else 'legacy_update' end,
    public.character_sheet_delta(case when tg_op = 'INSERT' then '{}'::jsonb else old.data end,new.data));
  return new;
end $$;
create trigger characters_sheet_history after insert or update on public.characters for each row execute function public.character_sheet_history();

-- Архив и постановка токена сериализуются на листе; права guard_token остаются у TASK-097.
create function public.character_sheet_link_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare ch public.characters;
begin
  if new.character_id is null then return new; end if;
  select * into ch from public.characters where id = new.character_id and campaign_id = new.campaign_id for share;
  if not found then raise exception 'Нет листа в этой кампании' using errcode = '23503'; end if;
  if ch.archived_at is not null then raise exception 'Лист в архиве' using errcode = 'P0001'; end if;
  return new;
end $$;
create trigger tokens_character_sheet_link before insert or update of character_id,campaign_id on public.tokens
  for each row execute function public.character_sheet_link_guard();

create function public.character_controllers_membership()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' or new.status <> 'active' then
    delete from public.character_controllers where campaign_id = old.campaign_id and user_id = old.user_id;
  end if;
  return null;
end $$;
create trigger character_controllers_membership after delete or update of status on public.campaign_members
  for each row execute function public.character_controllers_membership();

create function public.can_control_character(c text, ch text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_member(c) and exists(select 1 from public.characters x where x.campaign_id = c and x.id = ch and x.archived_at is null
    and (public.is_master(c) or x.owner_id = auth.uid() or exists(select 1 from public.character_controllers cc
      where cc.campaign_id = c and cc.character_id = ch and cc.user_id = auth.uid())));
$$;

create function public.character_sheet_snapshot(ch public.characters)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id',ch.id,'campaignId',ch.campaign_id,'ownerId',ch.owner_id,'version',ch.sheet_version::text,
    'managed',ch.sheet_managed,'archivedAt',ch.archived_at,'data',ch.data,'controllers',
    coalesce((select jsonb_agg(cc.user_id order by cc.user_id) from public.character_controllers cc
      where cc.campaign_id = ch.campaign_id and cc.character_id = ch.id),'[]'::jsonb));
$$;
create function public.read_character_sheet(p_campaign text, p_character text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare ch public.characters;
begin
  if not public.is_member(p_campaign) then raise exception 'Лист недоступен' using errcode = '42501'; end if;
  select * into ch from public.characters where campaign_id = p_campaign and id = p_character;
  if not found then raise exception 'Лист не найден' using errcode = 'P0002'; end if;
  return public.character_sheet_snapshot(ch);
end $$;

create function public.character_apply_adjust(d jsonb, payload jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare n bigint; hp bigint; mx bigint; tmp bigint; absorb bigint; item jsonb; collection jsonb; root text; ident text;
  idx int; matches int; maximum bigint; spent bigint; delta bigint; total_key text; spent_key text;
begin
  if jsonb_typeof(payload) is distinct from 'object' or (payload - array['hp','tempHp','counters']) <> '{}'::jsonb then
    raise exception 'Неизвестные поля изменения ресурсов' using errcode = '22023';
  end if;
  if payload ? 'hp' then
    n := public.character_sheet_int(payload -> 'hp','hp delta');
    hp := public.character_sheet_int(d -> 'hp','hp',0); mx := public.character_sheet_int(d -> 'hpMax','hpMax',0);
    if n < 0 then
      tmp := public.character_sheet_int(d -> 'tempHp','tempHp',0); absorb := least(tmp,-n);
      d := jsonb_set(d,'{tempHp}',to_jsonb(tmp - absorb)); hp := greatest(0,hp + n + absorb);
    else hp := least(mx,hp + n); end if;
    d := jsonb_set(d,'{hp}',to_jsonb(hp));
  end if;
  if payload ? 'tempHp' then
    n := public.character_sheet_int(payload -> 'tempHp','tempHp delta'); tmp := public.character_sheet_int(d -> 'tempHp','tempHp',0);
    if tmp + n < 0 then raise exception 'Временные HP не могут стать отрицательными' using errcode = '22023'; end if;
    d := jsonb_set(d,'{tempHp}',to_jsonb(tmp+n));
  end if;
  if payload ? 'counters' then
    if jsonb_typeof(payload -> 'counters') <> 'array' then raise exception 'Нужен список изменений счётчиков' using errcode = '22023'; end if;
    for item in select value from jsonb_array_elements(payload -> 'counters') loop
      root := item ->> 'field'; ident := item ->> 'id'; delta := public.character_sheet_int(item -> 'delta','counter delta');
      if root is null or ident is null or root not in ('slots','resources','slotPools','hitDicePools') then raise exception 'Неизвестный счётчик' using errcode = '22023'; end if;
      if root = 'slots' then
        if ident !~ '^[1-9]$' then raise exception 'Неизвестный круг ячеек' using errcode = '22023'; end if;
        collection := d #> array[root,ident]; spent_key := 'used'; total_key := 'max';
        maximum := public.character_sheet_int(collection -> total_key,'counter max',0);
        spent := public.character_sheet_int(collection -> spent_key,'counter used',0,maximum);
        if spent + delta < 0 or spent + delta > maximum then raise exception 'Недопустимый остаток ресурса' using errcode = '22023'; end if;
        d := jsonb_set(d,array[root,ident,spent_key],to_jsonb(spent+delta));
      else
        if jsonb_typeof(d -> root) is distinct from 'array' then raise exception 'Ресурс не настроен' using errcode = '22023'; end if;
        select min(ord)::int - 1,count(*)::int into idx,matches from jsonb_array_elements(d -> root) with ordinality x(v,ord) where v ->> 'id' = ident;
        if matches <> 1 then raise exception 'Ресурс не найден однозначно' using errcode = '22023'; end if;
        collection := d -> root -> idx; total_key := case when root = 'hitDicePools' then 'total' else 'max' end;
        maximum := public.character_sheet_int(collection -> total_key,'counter max',0);
        spent := public.character_sheet_int(collection -> 'spent','counter spent',0,maximum);
        if spent + delta < 0 or spent + delta > maximum then raise exception 'Недопустимый остаток ресурса' using errcode = '22023'; end if;
        d := jsonb_set(d,array[root,idx::text,'spent'],to_jsonb(spent+delta));
      end if;
    end loop;
  end if;
  return d;
end $$;

-- Проверяем не клиентский GUC, а закрытую незавершённую операцию именно этой транзакции.
create function public.character_archive_active(c text)
returns boolean language sql volatile security definer set search_path = '' as $$
  select exists(select 1 from public.character_operations o where o.campaign_id = c and o.caller_id = auth.uid()
    and o.kind = 'archive' and o.transaction_id = txid_current() and o.response is null);
$$;

create function public.character_remove_combat_tokens(d jsonb, removed text[])
returns jsonb language plpgsql set search_path = '' as $$
declare entries jsonb := coalesce(d -> 'entries','[]'::jsonb); kept jsonb; current_id text; next_id text; position int; old_position int; wraps boolean := false;
begin
  select coalesce(jsonb_agg(v order by ord),'[]'::jsonb) into kept from jsonb_array_elements(entries) with ordinality x(v,ord) where not (v ->> 'tokenId' = any(removed));
  if kept = entries then return d; end if;
  current_id := coalesce(d ->> 'current',entries -> coalesce((d ->> 'turn')::int,0) ->> 'tokenId');
  select (ord-1)::int into old_position from jsonb_array_elements(entries) with ordinality x(v,ord) where v ->> 'tokenId' = current_id limit 1;
  if jsonb_array_length(kept) = 0 then
    return (d - array['current','ended']) || jsonb_build_object('entries',kept,'moved','{}'::jsonb,'active',false,'turn',0);
  end if;
  if current_id = any(removed) or current_id is null then
    select v ->> 'tokenId' into next_id from jsonb_array_elements(entries) with ordinality x(v,ord)
      where ord > coalesce(old_position,-1)+1 and not (v ->> 'tokenId' = any(removed)) order by ord limit 1;
    if next_id is null then next_id := kept -> 0 ->> 'tokenId'; wraps := true; end if;
    d := d - 'ended';
  else next_id := current_id; end if;
  select (ord-1)::int into position from jsonb_array_elements(kept) with ordinality x(v,ord) where v ->> 'tokenId' = next_id limit 1;
  if d ->> 'ended' = any(removed) then d := d - 'ended'; end if;
  return d || jsonb_build_object('entries',kept,'current',next_id,'turn',coalesce(position,0),
    'round',coalesce((d ->> 'round')::int,1) + case when wraps then 1 else 0 end,'moved',coalesce(d -> 'moved','{}'::jsonb) - removed);
end $$;

create function public.character_command(p_campaign text, p_character text, p_expected_version bigint, p_operation uuid, p_kind text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare ch public.characters; next_ch public.characters; prior public.character_operations; request jsonb; result_json jsonb; d jsonb; patch jsonb;
  me uuid := auth.uid(); master boolean; builder boolean; controller boolean; changed text[]; target uuid; enabled boolean; removed text[]; cb public.combats;
  allowed text[] := array['name','portrait','profile','classId','className','raceId','raceName','level','classes','background','alignment','stats','saves','skills',
    'ac','hp','hpMax','tempHp','speed','darkvision','hitDice','hitDicePools','deathSaves','conditions','attacks','actions','bonusActions','reactions','slots','slotPools',
    'spells','spellSources','knownSpells','inventory','inventoryItems','features','featureEntries','resources','notes','initBonus','profBonus','light','aura',
    'sidekick','overrides','proficiencies','coins','movement','defenses','concentration','statblock'];
begin
  perform 1 from public.campaign_members where campaign_id = p_campaign and user_id = me and status = 'active' for share;
  if not found then raise exception 'Лист недоступен' using errcode = '42501'; end if;
  if p_operation is null or p_expected_version is null or p_expected_version < 0 or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text) > 262144 then
    raise exception 'Нужны ID операции, ожидаемая версия и объект данных' using errcode = '22023'; end if;
  if p_kind is null or p_kind not in ('patch','set_current','adjust','rest','growth','controller','archive','restore') then raise exception 'Неизвестная команда' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_campaign || ':' || me::text || ':' || p_operation::text,0));
  select * into ch from public.characters where campaign_id = p_campaign and id = p_character for update;
  if not found then raise exception 'Лист не найден' using errcode = 'P0002'; end if;
  master := public.is_master(p_campaign); builder := master or coalesce(ch.owner_id = me,false);
  controller := builder or exists(select 1 from public.character_controllers where campaign_id = p_campaign and character_id = p_character and user_id = me);
  if not controller or (p_kind in ('patch','growth','controller','archive','restore') and not builder) or (p_kind = 'growth' and not master) then
    raise exception 'Недостаточно прав на изменение листа' using errcode = '42501'; end if;
  request := jsonb_build_object('characterId',p_character,'version',p_expected_version::text,'kind',p_kind,'payload',p_payload);
  select * into prior from public.character_operations where campaign_id = p_campaign and caller_id = me and operation_id = p_operation;
  if found then
    if prior.request <> request then raise exception 'ID операции уже использован для другого запроса' using errcode = '22023'; end if;
    return prior.response || '{"replayed":true}'::jsonb;
  end if;
  if ch.sheet_version <> p_expected_version then raise exception 'Лист уже изменён' using errcode = '40001', detail = jsonb_build_object('version',ch.sheet_version::text)::text; end if;
  if ch.archived_at is not null and p_kind <> 'restore' then raise exception 'Лист в архиве' using errcode = 'P0001'; end if;
  if p_kind = 'growth' and (ch.data ->> 'profile') is distinct from 'sidekick' then raise exception 'Развитие Sidekick требует его профиля' using errcode = '22023'; end if;
  if p_kind = 'restore' and ch.archived_at is null then raise exception 'Лист уже активен' using errcode = '22023'; end if;
  insert into public.character_operations(campaign_id,caller_id,operation_id,character_id,kind,request) values(p_campaign,me,p_operation,p_character,p_kind,request);
  d := ch.data;
  if p_kind in ('patch','growth','set_current') then
    patch := case when p_kind = 'growth' then p_payload -> 'patch' else p_payload end;
    if jsonb_typeof(patch) is distinct from 'object' then raise exception 'Нужен объект изменений' using errcode = '22023'; end if;
    select coalesce(array_agg(k),'{}') into changed from jsonb_object_keys(patch) k;
    if exists(select 1 from unnest(changed) k where not (k = any(allowed))) then raise exception 'Неизвестное или защищённое поле' using errcode = '22023'; end if;
    if p_kind = 'set_current' and (patch - array['hp','tempHp','conditions','deathSaves','concentration']) <> '{}'::jsonb then raise exception 'Управляющий меняет только текущие значения' using errcode = '42501'; end if;
    d := public.character_sheet_merge(d,patch);
    if not master and ((d -> 'profile') is distinct from (ch.data -> 'profile')
      or (ch.data ->> 'profile' = 'sidekick' and ((d -> 'level') is distinct from (ch.data -> 'level')
        or (d #> '{sidekick,level}') is distinct from (ch.data #> '{sidekick,level}')))) then
      raise exception 'Профиль и уровень Sidekick подтверждает мастер' using errcode = '42501'; end if;
  elsif p_kind in ('adjust','rest') then
    patch := case when p_kind = 'rest' then p_payload -> 'adjust' else p_payload end;
    if p_kind = 'rest' and (p_payload ->> 'kind' is null or p_payload ->> 'kind' not in ('short','long') or (p_payload -> 'conditionsConfirmed') is distinct from 'true'::jsonb) then raise exception 'Подтвердите вид и условия отдыха' using errcode = '22023'; end if;
    d := public.character_apply_adjust(d,patch);
    changed := array['hp','tempHp','slots','slotPools','resources','hitDicePools'];
  elsif p_kind = 'controller' then
    target := (p_payload ->> 'userId')::uuid;
    if target is null or jsonb_typeof(p_payload -> 'enabled') is distinct from 'boolean' then raise exception 'Нужны userId и enabled' using errcode = '22023'; end if;
    enabled := (p_payload ->> 'enabled')::boolean;
    if enabled then
      perform 1 from public.campaign_members where campaign_id = p_campaign and user_id = target and status = 'active' for share;
      if not found then raise exception 'Управляющий должен быть активным участником' using errcode = '42501'; end if;
      insert into public.character_controllers(campaign_id,character_id,user_id,granted_by) values(p_campaign,p_character,target,me) on conflict do nothing;
    else delete from public.character_controllers where campaign_id = p_campaign and character_id = p_character and user_id = target; end if;
    changed := '{}';
  else changed := '{}'; end if;
  if p_kind in ('patch','growth','set_current','adjust','rest') then
    -- Поведение 0 HP героя сохраняется; бросок сам по себе сюда не попадает.
    if coalesce(d ->> 'profile','pc') in ('pc','sidekick') and d ? 'hp' and d -> 'hp' <> 'null'::jsonb and (d -> 'hp') is distinct from (ch.data -> 'hp') then
      if jsonb_typeof(coalesce(d -> 'conditions','[]'::jsonb)) <> 'array' then raise exception 'Нужен список состояний' using errcode = '22023'; end if;
      if public.character_sheet_int(d -> 'hp','hp',0) = 0 then
        if not exists(select 1 from jsonb_array_elements(coalesce(d -> 'conditions','[]'::jsonb)) x(v)
          where v = '"unconscious"'::jsonb or v ->> 'id' = 'unconscious') then
          d := jsonb_set(d,'{conditions}',coalesce(d -> 'conditions','[]'::jsonb) || '["unconscious"]'::jsonb);
        end if;
      elsif ch.data -> 'hp' = '0'::jsonb then
        d := jsonb_set(d,'{conditions}',(select coalesce(jsonb_agg(v),'[]'::jsonb) from jsonb_array_elements(coalesce(d -> 'conditions','[]'::jsonb)) x(v)
          where v <> '"unconscious"'::jsonb and (v ->> 'id') is distinct from 'unconscious'));
        d := jsonb_set(d,'{deathSaves}','{"s":0,"f":0}'::jsonb);
      end if;
    end if;
    select coalesce(array_agg(k),'{}') into changed from jsonb_object_keys(public.character_sheet_delta(ch.data,d)) k;
    perform public.validate_character_sheet(d,changed);
  end if;
  if p_kind = 'archive' then
    -- Блокируем бой до удаления токенов; все изменения входят в одну транзакцию.
    select * into cb from public.combats where campaign_id = p_campaign for update;
    select coalesce(array_agg(id),'{}') into removed from public.tokens where campaign_id = p_campaign and character_id = p_character;
    if cb.campaign_id is not null then update public.combats set data = public.character_remove_combat_tokens(data,removed) where campaign_id = p_campaign; end if;
    delete from public.tokens where campaign_id = p_campaign and character_id = p_character;
  end if;
  update public.characters set data = d, sheet_managed = true,
    archived_at = case when p_kind = 'archive' then now() when p_kind = 'restore' then null else archived_at end
    where campaign_id = p_campaign and id = p_character returning * into next_ch;
  insert into public.character_history(campaign_id,character_id,version,author,operation_id,kind,changes)
    values(p_campaign,p_character,next_ch.sheet_version,me,p_operation,p_kind,
      public.character_sheet_delta(ch.data,next_ch.data) || jsonb_build_object('_archived',jsonb_build_object('before',ch.archived_at,'after',next_ch.archived_at))
      || case when p_kind = 'controller' then jsonb_build_object('_controller',p_payload) else '{}'::jsonb end);
  result_json := jsonb_build_object('ok',true,'operationId',p_operation,'replayed',false,'sheet',public.character_sheet_snapshot(next_ch));
  update public.character_operations set response = result_json where campaign_id = p_campaign and caller_id = me and operation_id = p_operation;
  return result_json;
end $$;

-- Сохраняем guard_combat TASK-002; добавлена только capability атомарного архива листа.
create or replace function public.guard_combat()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  heroes text[] := public.hero_token_ids(old.campaign_id);
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

revoke execute on function public.character_sheet_int(jsonb,text,bigint,bigint), public.validate_character_sheet(jsonb,text[]),
  public.character_sheet_delta(jsonb,jsonb), public.character_sheet_merge(jsonb,jsonb,int), public.character_sheet_guard(), public.character_sheet_history(), public.character_sheet_link_guard(), public.character_controllers_membership(),
  public.can_control_character(text,text), public.character_sheet_snapshot(public.characters), public.read_character_sheet(text,text),
  public.character_apply_adjust(jsonb,jsonb), public.character_archive_active(text), public.character_remove_combat_tokens(jsonb,text[]),
  public.character_command(text,text,bigint,uuid,text,jsonb), public.guard_combat() from public,anon,authenticated;
grant execute on function public.validate_character_sheet(jsonb,text[]), public.can_control_character(text,text),
  public.read_character_sheet(text,text), public.character_command(text,text,bigint,uuid,text,jsonb) to authenticated;
