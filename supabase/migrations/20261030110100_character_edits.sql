create or replace function public.validate_character_sheet(d jsonb, fields text[])
returns void language plpgsql security definer set search_path = '' as $$
declare k text; a text; v jsonb; item jsonb; n bigint; part jsonb; value_key text;
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
      n := case when item -> a is null or item -> a = 'null'::jsonb then null else public.character_sheet_int(item -> a, k || '.' || a, 0) end;
      if item -> 'spent' is not null and item -> 'spent' <> 'null'::jsonb then perform public.character_sheet_int(item -> 'spent', k || '.spent', 0, coalesce(n,9007199254740991)); end if;
    end loop;
  end loop;
  if 'slots' = any(fields) and d ? 'slots' and d -> 'slots' <> 'null'::jsonb then
    for a, item in select key, value from jsonb_each(d -> 'slots') loop
      if a !~ '^[1-9]$' then raise exception 'Неизвестный круг ячеек' using errcode = '22023'; end if;
      n := public.character_sheet_int(item -> 'max', 'slots.max', 0);
      perform public.character_sheet_int(item -> 'used', 'slots.used', 0, n);
    end loop;
  end if;
  foreach k in array array['classes','attacks','actions','bonusActions','reactions','spellSources','knownSpells','inventoryItems','featureEntries','resources','slotPools','hitDicePools'] loop
    if (not(k = any(fields)) and not(k='knownSpells' and 'spellSources'=any(fields))) or d -> k is null or d -> k = 'null'::jsonb then continue; end if;
    if exists(select 1 from jsonb_array_elements(d -> k) x where x ? 'id' and x -> 'id' <> 'null'::jsonb group by x ->> 'id' having count(*)>1) then raise exception 'Повтор ID записей: %',k using errcode='22023'; end if;
    for item in select value from jsonb_array_elements(d -> k) loop
      if jsonb_typeof(item) <> 'object' then raise exception 'Нужна запись объекта: %',k using errcode='22023'; end if;
      foreach value_key in array array['id','name','description','source','sourceId','subclass','damage','note','type','kind','formula','ability','recovery'] loop
        part := item -> value_key;
        if part is not null and part <> 'null'::jsonb and jsonb_typeof(part) <> 'string' then raise exception 'Нужен текст: %.%',k,value_key using errcode='22023'; end if;
      end loop;
      foreach value_key in array array['prepared','ritual','attuned','equipped','proficient'] loop
        part := item -> value_key;
        if part is not null and part <> 'null'::jsonb and jsonb_typeof(part) <> 'boolean' then raise exception 'Нужно логическое значение: %.%',k,value_key using errcode='22023'; end if;
      end loop;
      foreach value_key in array array['bonus','attackOverride','dcOverride','quantity','circle','die'] loop
        part := item -> value_key;
        if part is not null and part <> 'null'::jsonb then
          n:=public.character_sheet_int(part,k||'.'||value_key);
          if value_key in ('quantity','dcOverride') and n<0 then raise exception 'Отрицательное значение: %',value_key using errcode='22023'; end if;
          if value_key='circle' and (n<0 or n>9 or (k='slotPools' and n=0)) then raise exception 'Неверный круг' using errcode='22023'; end if;
          if value_key='die' and n not in(4,6,8,10,12,20) then raise exception 'Неверная кость' using errcode='22023'; end if;
        end if;
      end loop;
      if item -> 'recovery' is not null and item -> 'recovery' <> 'null'::jsonb and item ->> 'recovery' not in('manual','short','long','both') then raise exception 'Неверное восстановление' using errcode='22023'; end if;
      if k='knownSpells' and coalesce(item->>'sourceId','')<>'' and not exists(select 1 from jsonb_array_elements(coalesce(d->'spellSources','[]'::jsonb)) src where src->>'id'=item->>'sourceId') then raise exception 'Источник заклинания отсутствует' using errcode='22023'; end if;
    end loop;
  end loop;
  foreach k in array array['coins','movement'] loop
    if not(k=any(fields)) or d->k is null or d->k='null'::jsonb then continue; end if;
    for value_key,part in select key,value from jsonb_each(d->k) loop
      if not(value_key=any(case when k='coins' then array['cp','sp','ep','gp','pp'] else array['walk','fly','swim','climb','burrow'] end)) or part='null'::jsonb then continue; end if;
      if jsonb_typeof(part)<>'number' or part::text::numeric<0 or part::text::numeric>9007199254740991 then raise exception 'Нужно неотрицательное число: %.%',k,value_key using errcode='22023'; end if;
      if k='coins' then perform public.character_sheet_int(part,'coins.'||value_key,0); end if;
    end loop;
  end loop;
  if 'proficiencies'=any(fields) then
    foreach k in array array['saves','skills'] loop
      v:=d#>array['proficiencies',k];
      if v is null or v='null'::jsonb then continue; end if;
      if jsonb_typeof(v)<>'object' then raise exception 'Нужна карта владений' using errcode='22023'; end if;
      for part in select value from jsonb_each(v) loop
        if part not in('0'::jsonb,'0.5'::jsonb,'1'::jsonb,'2'::jsonb) then raise exception 'Множитель мастерства: 0, 0.5, 1, 2' using errcode='22023'; end if;
      end loop;
    end loop;
  end if;
  if ('classes'=any(fields) or 'level'=any(fields)) and jsonb_array_length(case when jsonb_typeof(d->'classes')='array' then d->'classes' else '[]'::jsonb end)>0 then
    select sum((x->>'levels')::numeric) into n from jsonb_array_elements(d->'classes') x;
    if n>20 or (d->'level' is not null and d->'level'<>'null'::jsonb and n<>(d->>'level')::numeric) then raise exception 'Общий уровень не совпадает с классами или больше 20' using errcode='22023'; end if;
  end if;
end $$;

-- TASK-004: атомарная смешанная правка и совместимость прежних редакторов.
-- Полные определения заменяют только две функции; прежние миграции неизменны.

create or replace function public.character_apply_adjust(d jsonb, payload jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare n bigint; hp bigint; mx bigint; tmp bigint; absorb bigint; item jsonb; collection jsonb; root text; ident text;
  idx int; matches int; maximum bigint; spent bigint; delta bigint; total_key text; spent_key text;
begin
  if jsonb_typeof(payload) is distinct from 'object' or (payload - array['hp','currentHp','tempHp','counters']) <> '{}'::jsonb then
    raise exception 'Неизвестные поля изменения ресурсов' using errcode = '22023';
  end if;
  if payload ? 'hp' and payload ? 'currentHp' then raise exception 'Выберите урон/лечение или изменение остатка HP' using errcode = '22023'; end if;
  if payload ? 'hp' then
    n := public.character_sheet_int(payload -> 'hp','hp delta');
    hp := public.character_sheet_int(d -> 'hp','hp',0); mx := public.character_sheet_int(d -> 'hpMax','hpMax',0);
    if n < 0 then
      tmp := public.character_sheet_int(d -> 'tempHp','tempHp',0); absorb := least(tmp,-n);
      d := jsonb_set(d,'{tempHp}',to_jsonb(tmp - absorb)); hp := greatest(0,hp + n + absorb);
    else hp := least(mx,hp + n); end if;
    d := jsonb_set(d,'{hp}',to_jsonb(hp));
  end if;
  if payload ? 'currentHp' then
    n := public.character_sheet_int(payload -> 'currentHp','currentHp delta');
    hp := public.character_sheet_int(d -> 'hp','hp',0); mx := public.character_sheet_int(d -> 'hpMax','hpMax',0);
    if hp+n < 0 or hp+n > mx then raise exception 'Недопустимый остаток HP' using errcode = '22023'; end if;
    d := jsonb_set(d,'{hp}',to_jsonb(hp+n));
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

create collation public.character_sheet_names (provider=icu,locale='ru',deterministic=false);

-- Очередь интерфейса отсортирована по инициативе, а не по порядку добавления entries.
-- Перед снятием текущего участника приводим запись к тому же порядку, пока токены ещё существуют.
create function public.character_combat_order(c text, d jsonb)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_set(d,'{entries}',coalesce(jsonb_agg(v order by
    coalesce((v ->> 'init')::numeric,-99) desc,
    coalesce((case when t.character_id is not null then ch.data ->> 'initBonus' else t.data ->> 'initBonus' end)::numeric,0) desc,
    coalesce(case when t.character_id is not null then ch.data ->> 'name' else t.data ->> 'name' end,'') collate public.character_sheet_names,
    x.ord),'[]'::jsonb))
  from jsonb_array_elements(coalesce(d -> 'entries','[]'::jsonb)) with ordinality x(v,ord)
  left join public.tokens t on t.id=v ->> 'tokenId' and t.campaign_id=c
  left join public.characters ch on ch.id=t.character_id and ch.campaign_id=c;
$$;
revoke all on function public.character_combat_order(text,jsonb) from public,anon,authenticated;

create or replace function public.character_command(p_campaign text, p_character text, p_expected_version bigint, p_operation uuid, p_kind text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare ch public.characters; next_ch public.characters; prior public.character_operations; request jsonb; result_json jsonb; d jsonb; patch jsonb;
  me uuid := auth.uid(); master boolean; builder boolean; controller boolean; changed text[]; target uuid; enabled boolean; removed text[]; cb public.combats;
  next_owner uuid; member_change jsonb; member_before text; member_after text; actual_member public.campaign_members; current_patch jsonb;
  allowed text[] := array['name','portrait','profile','classId','className','raceId','raceName','level','classes','background','alignment','stats','saves','skills',
    'ac','hp','hpMax','tempHp','speed','darkvision','hitDice','hitDicePools','deathSaves','conditions','attacks','actions','bonusActions','reactions','slots','slotPools',
    'spells','spellSources','knownSpells','inventory','inventoryItems','features','featureEntries','resources','notes','initBonus','profBonus','light','aura',
    'sidekick','overrides','proficiencies','coins','movement','defenses','concentration','statblock'];
begin
  perform 1 from public.campaign_members where campaign_id = p_campaign and user_id = me and status = 'active' for share;
  if not found then raise exception 'Лист недоступен' using errcode = '42501'; end if;
  if p_operation is null or p_expected_version is null or p_expected_version < 0 or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text) > 262144 then
    raise exception 'Нужны ID операции, ожидаемая версия и объект данных' using errcode = '22023'; end if;
  if p_kind is null or p_kind not in ('patch','set_current','adjust','rest','growth','controller','archive','restore','edit') then raise exception 'Неизвестная команда' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_campaign || ':' || me::text || ':' || p_operation::text,0));
  select * into ch from public.characters where campaign_id = p_campaign and id = p_character for update;
  if not found then raise exception 'Лист не найден' using errcode = 'P0002'; end if;
  master := public.is_master(p_campaign); builder := master or coalesce(ch.owner_id = me,false);
  controller := builder or exists(select 1 from public.character_controllers where campaign_id = p_campaign and character_id = p_character and user_id = me);
  if not controller or (p_kind in ('patch','growth','controller','archive','restore') and not builder) or (p_kind = 'growth' and not master) then
    raise exception 'Недостаточно прав на изменение листа' using errcode = '42501'; end if;
  if p_kind = 'edit' and (
    (coalesce(p_payload -> 'patch','{}'::jsonb) <> '{}'::jsonb and not builder)
    or ((p_payload ? 'ownerId' or p_payload ? 'membership') and not master)) then
    raise exception 'Нет права менять сборку или владение' using errcode = '42501';
  end if;
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
  d := ch.data; next_owner := ch.owner_id;
  if p_kind in ('patch','growth','set_current','edit') then
    patch := case when p_kind = 'growth' then p_payload -> 'patch' when p_kind = 'edit' then coalesce(p_payload -> 'patch','{}'::jsonb) else p_payload end;
    if p_kind = 'edit' then
      if (p_payload - array['patch','current','adjust','ownerId','membership']) <> '{}'::jsonb then raise exception 'Неизвестные поля edit' using errcode = '22023'; end if;
      current_patch := coalesce(p_payload -> 'current','{}'::jsonb);
      if jsonb_typeof(current_patch) <> 'object' or (current_patch - array['hp','tempHp','conditions','deathSaves','concentration']) <> '{}'::jsonb then
        raise exception 'Неизвестные текущие значения' using errcode = '22023'; end if;
      if jsonb_typeof(patch) <> 'object' then raise exception 'Нужен объект изменений' using errcode = '22023'; end if;
      patch := public.character_sheet_merge(patch,current_patch);
    end if;
    if jsonb_typeof(patch) is distinct from 'object' then raise exception 'Нужен объект изменений' using errcode = '22023'; end if;
    select coalesce(array_agg(k),'{}') into changed from jsonb_object_keys(patch) k;
    if exists(select 1 from unnest(changed) k where not (k = any(allowed))) then raise exception 'Неизвестное или защищённое поле' using errcode = '22023'; end if;
    if p_kind = 'set_current' and (patch - array['hp','tempHp','conditions','deathSaves','concentration']) <> '{}'::jsonb then raise exception 'Управляющий меняет только текущие значения' using errcode = '42501'; end if;
    d := public.character_sheet_merge(d,patch);
    if not master and ((d -> 'profile') is distinct from (ch.data -> 'profile')
      or (ch.data ->> 'profile' = 'sidekick' and ((d -> 'level') is distinct from (ch.data -> 'level')
        or (d #> '{sidekick,level}') is distinct from (ch.data #> '{sidekick,level}')))) then
      raise exception 'Профиль и уровень Sidekick подтверждает мастер' using errcode = '42501'; end if;
    if p_kind = 'edit' then
      if p_payload ? 'adjust' then d := public.character_apply_adjust(d,p_payload -> 'adjust'); end if;
      if p_payload ? 'ownerId' then
        if p_payload -> 'ownerId' <> 'null'::jsonb and jsonb_typeof(p_payload -> 'ownerId') <> 'string' then raise exception 'Нужен UUID владельца или null' using errcode = '22023'; end if;
        next_owner := (p_payload ->> 'ownerId')::uuid;
        if next_owner is not null then
          perform 1 from public.campaign_members where campaign_id = p_campaign and user_id = next_owner and status = 'active' for share;
          if not found then raise exception 'Владелец должен быть активным участником' using errcode = '42501'; end if;
        end if;
      end if;
      if p_payload ? 'membership' then
        if not (p_payload ? 'ownerId') or jsonb_typeof(p_payload -> 'membership') <> 'array' then raise exception 'Выбор героя передаётся вместе с владением' using errcode = '22023'; end if;
        if exists(select 1 from jsonb_array_elements(p_payload -> 'membership') v group by v ->> 'userId' having count(*) > 1) then raise exception 'Участники передачи должны быть уникальны' using errcode = '22023'; end if;
        for member_change in select value from jsonb_array_elements(p_payload -> 'membership') loop
          target := (member_change ->> 'userId')::uuid;
          if target is null or not (target is not distinct from ch.owner_id or target is not distinct from next_owner)
            or not (member_change ? 'before' and member_change ? 'after') then raise exception 'Некорректный участник передачи' using errcode = '22023'; end if;
          member_before := member_change ->> 'before'; member_after := member_change ->> 'after';
          if ((member_before = p_character and member_after is null and target = ch.owner_id) or (member_before is null and member_after = p_character and target = next_owner)) is not true then raise exception 'Передаётся только выбор этого листа' using errcode = '22023'; end if;
          select * into actual_member from public.campaign_members where campaign_id = p_campaign and user_id = target for update;
          if not found or actual_member.character_id is distinct from member_before then raise exception 'Выбор героя уже изменён' using errcode = '40001'; end if;
          update public.campaign_members set character_id = member_after where campaign_id = p_campaign and user_id = target;
        end loop;
      end if;
    end if;
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
  if p_kind in ('patch','growth','set_current','adjust','rest','edit') then
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
    if cb.campaign_id is not null then update public.combats set data = public.character_remove_combat_tokens(public.character_combat_order(p_campaign,data),removed) where campaign_id = p_campaign; end if;
    delete from public.tokens where campaign_id = p_campaign and character_id = p_character;
  end if;
  update public.characters set data = d, owner_id = next_owner, sheet_managed = true,
    archived_at = case when p_kind = 'archive' then now() when p_kind = 'restore' then null else archived_at end
    where campaign_id = p_campaign and id = p_character returning * into next_ch;
  insert into public.character_history(campaign_id,character_id,version,author,operation_id,kind,changes)
    values(p_campaign,p_character,next_ch.sheet_version,me,p_operation,p_kind,
      public.character_sheet_delta(ch.data,next_ch.data) || jsonb_build_object('_archived',jsonb_build_object('before',ch.archived_at,'after',next_ch.archived_at))
      || jsonb_build_object('_owner',jsonb_build_object('before',ch.owner_id,'after',next_ch.owner_id))
      || case when p_kind = 'controller' then jsonb_build_object('_controller',p_payload) else '{}'::jsonb end);
  result_json := jsonb_build_object('ok',true,'operationId',p_operation,'replayed',false,'sheet',public.character_sheet_snapshot(next_ch));
  update public.character_operations set response = result_json where campaign_id = p_campaign and caller_id = me and operation_id = p_operation;
  return result_json;
end $$;

revoke execute on function public.character_apply_adjust(jsonb,jsonb) from public,anon,authenticated;
revoke execute on function public.character_command(text,text,bigint,uuid,text,jsonb) from public,anon;
grant execute on function public.character_command(text,text,bigint,uuid,text,jsonb) to authenticated;
