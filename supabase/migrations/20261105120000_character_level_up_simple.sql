-- #202: простое повышение для героя без конструктора (старый лист: classId/level или classes[] без creation).
-- Уровень +1 в одном классе SRD (или новый класс с 1 уровнем), хиты — среднее кости + модификатор Телосложения
-- (сервер считает сам), выборы уровня — вручную на листе. Ветка героя конструктора — без изменений.

create or replace function public.level_up_character(p_campaign text, p_character text, p_expected_version bigint, p_operation uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare ch public.characters; next_ch public.characters; prior public.character_operations; request jsonb; result_json jsonb;
  me uuid := auth.uid(); d jsonb; patch jsonb; old_c jsonb; new_c jsonb; n integer; levels integer;
  hp_before integer; hp_after integer; gain integer; k text; old_classes jsonb; new_classes jsonb; grown jsonb; die integer; con integer; i integer;
  growth text[] := array['level','classes','classId','className','stats','proficiencies','speed','darkvision',
    'hitDicePools','slotPools','resources','spellSources','knownSpells','featureEntries'];
  fixed_creation text[] := array['schemaVersion','edition','ancestry','background','abilityInput','rollReceipts','manualOverrides','rulesRevision'];
begin
  perform 1 from public.campaign_members where campaign_id = p_campaign and user_id = me and status = 'active' for share;
  if not found then raise exception 'Лист недоступен' using errcode = '42501'; end if;
  if p_operation is null or p_expected_version is null or p_expected_version < 0 or jsonb_typeof(p_payload) is distinct from 'object'
    or octet_length(p_payload::text) > 262144 or (p_payload - array['creation','patch']) <> '{}'::jsonb
    or jsonb_typeof(p_payload -> 'patch') is distinct from 'object' then
    raise exception 'Нужны ID операции, ожидаемая версия и patch (и creation у героя конструктора)' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_campaign || ':' || me::text || ':' || p_operation::text, 0));
  select * into ch from public.characters where campaign_id = p_campaign and id = p_character for update;
  if not found then raise exception 'Лист не найден' using errcode = 'P0002'; end if;
  if not (public.is_master(p_campaign) or coalesce(ch.owner_id = me, false)) then
    raise exception 'Уровень повышают владелец героя или мастер' using errcode = '42501'; end if;
  request := jsonb_build_object('characterId', p_character, 'version', p_expected_version::text, 'kind', 'level_up', 'payload', p_payload);
  select * into prior from public.character_operations where campaign_id = p_campaign and caller_id = me and operation_id = p_operation;
  if found then
    if prior.request <> request then raise exception 'ID операции уже использован для другого запроса' using errcode = '22023'; end if;
    return prior.response || '{"replayed":true}'::jsonb;
  end if;
  if ch.sheet_version <> p_expected_version then raise exception 'Лист уже изменён' using errcode = '40001', detail = jsonb_build_object('version', ch.sheet_version::text)::text; end if;
  if ch.archived_at is not null then raise exception 'Лист в архиве' using errcode = 'P0001'; end if;
  if coalesce(ch.data ->> 'profile', 'pc') <> 'pc' then raise exception 'Повышение — только для героя' using errcode = '22023'; end if;

  -- Герой без конструктора (старый лист): простое повышение — уровень, класс и кость хитов; выборы уровня
  -- (характеристики, черты, заклинания) игрок вносит на листе вручную.
  if jsonb_typeof(ch.data -> 'creation') is distinct from 'object' then
    if p_payload ? 'creation' then raise exception 'У героя нет блока creation — только простое повышение' using errcode = '22023'; end if;
    patch := p_payload -> 'patch';
    if exists(select 1 from jsonb_object_keys(patch) x where x not in ('level','classes','hitDicePools')) then
      raise exception 'Простое повышение меняет только уровень, классы и кости хитов' using errcode = '22023'; end if;
    if jsonb_typeof(ch.data -> 'level') is distinct from 'number' or jsonb_typeof(ch.data #> '{stats,con}') is distinct from 'number' then
      raise exception 'Нужны уровень и Телосложение' using errcode = '22023'; end if;
    n := (ch.data ->> 'level')::integer;
    old_classes := case when jsonb_typeof(ch.data -> 'classes') = 'array' and jsonb_array_length(ch.data -> 'classes') > 0 then ch.data -> 'classes'
      when ch.data ? 'classId' then jsonb_build_array(jsonb_build_object('ref', 'srd51:class:' || (ch.data ->> 'classId'), 'levels', n)) end;
    new_classes := patch -> 'classes';
    if old_classes is null or jsonb_typeof(new_classes) is distinct from 'array' or patch -> 'level' <> to_jsonb(n + 1)
      or (select coalesce(sum((c ->> 'levels')::integer), 0) from jsonb_array_elements(old_classes) c) <> n
      or (select coalesce(sum((c ->> 'levels')::integer), 0) from jsonb_array_elements(new_classes) c) <> n + 1 then
      raise exception 'Уровень и классы: ровно +1 уровень' using errcode = '22023'; end if;
    -- Растёт ровно один класс: прежний на +1 или новый (мультикласс) с 1 уровнем в конце списка.
    if jsonb_array_length(new_classes) = jsonb_array_length(old_classes) then
      for i in 0 .. jsonb_array_length(old_classes) - 1 loop
        if (new_classes -> i ->> 'ref') is distinct from (old_classes -> i ->> 'ref') then raise exception 'Классы не совпадают с прежними' using errcode = '22023'; end if;
        if (new_classes -> i ->> 'levels')::integer = (old_classes -> i ->> 'levels')::integer + 1 then grown := new_classes -> i;
        elsif (new_classes -> i -> 'levels') is distinct from (old_classes -> i -> 'levels') then raise exception 'Растёт ровно один класс' using errcode = '22023'; end if;
      end loop;
    elsif jsonb_array_length(new_classes) = jsonb_array_length(old_classes) + 1 and (new_classes -> -1 ->> 'levels') = '1' then
      for i in 0 .. jsonb_array_length(old_classes) - 1 loop
        if (new_classes -> i ->> 'ref') is distinct from (old_classes -> i ->> 'ref') or (new_classes -> i -> 'levels') is distinct from (old_classes -> i -> 'levels') then
          raise exception 'Прежние классы не меняются' using errcode = '22023'; end if;
      end loop;
      grown := new_classes -> -1;
    end if;
    die := public.character_class_hit_die(grown ->> 'ref');
    if grown is null or die is null then raise exception 'Нужен класс SRD с известной костью хитов' using errcode = '22023'; end if;
    insert into public.character_operations(campaign_id, caller_id, operation_id, character_id, kind, request) values (p_campaign, me, p_operation, p_character, 'level_up', request);
    con := (ch.data #>> '{stats,con}')::integer;
    gain := die / 2 + 1 + floor((con - 10) / 2.0)::integer;
    d := public.character_sheet_merge(ch.data, patch);
  else
  if not public.character_creation_valid(ch.data -> 'creation') then
    raise exception 'Повышение по плану — только для героя, созданного конструктором' using errcode = '22023'; end if;

  old_c := ch.data -> 'creation'; new_c := p_payload -> 'creation';
  if not public.character_creation_valid(new_c) then raise exception 'Нужен блок creation версии 1' using errcode = '22023'; end if;
  n := jsonb_array_length(old_c -> 'levelHistory');
  if jsonb_array_length(new_c -> 'levelHistory') <> n + 1 then raise exception 'За раз — ровно один уровень' using errcode = '22023'; end if;
  for i in 0 .. n - 1 loop
    if (new_c -> 'levelHistory' -> i) is distinct from (old_c -> 'levelHistory' -> i) then raise exception 'Прежние уровни не меняются' using errcode = '22023'; end if;
  end loop;
  foreach k in array fixed_creation loop
    if (new_c -> k) is distinct from (old_c -> k) then raise exception 'Раса, предыстория и ввод характеристик при повышении не меняются (%)', k using errcode = '22023'; end if;
  end loop;
  patch := p_payload -> 'patch';
  if exists(select 1 from jsonb_object_keys(patch) x where not (x = any(growth))) then
    raise exception 'Повышение меняет только поля сборки' using errcode = '22023'; end if;

  insert into public.character_operations(campaign_id, caller_id, operation_id, character_id, kind, request) values (p_campaign, me, p_operation, p_character, 'level_up', request);
  d := public.character_sheet_merge(ch.data, patch);
  d := jsonb_set(d, '{creation}', jsonb_set(new_c, '{verified}', '"client"'));
  levels := n + 1;
  if jsonb_typeof(d -> 'classes') is distinct from 'array'
    or (select coalesce(sum((c ->> 'levels')::integer), 0) from jsonb_array_elements(d -> 'classes') c) <> levels
    or d -> 'level' <> to_jsonb(levels) then
    raise exception 'Уровень, классы и история уровней не совпадают' using errcode = '22023'; end if;
  hp_before := public.character_creation_hp(ch.data); hp_after := public.character_creation_hp(d);
  if hp_before is null or hp_after is null then raise exception 'Хиты не считаются по формуле: нужно Телосложение и классы SRD' using errcode = '22023'; end if;
  gain := hp_after - hp_before;
  end if;
  if jsonb_typeof(ch.data -> 'hpMax') is distinct from 'number' then raise exception 'Нужен максимум хитов' using errcode = '22023'; end if;
  d := jsonb_set(d, '{hpMax}', to_jsonb(greatest(1, (ch.data ->> 'hpMax')::integer + gain)));
  if jsonb_typeof(ch.data -> 'hp') = 'number' then
    d := jsonb_set(d, '{hp}', to_jsonb(least((d ->> 'hpMax')::integer, greatest(0, (ch.data ->> 'hp')::integer + gain))));
  end if;

  -- После команды лист ведётся только командами (как после character_command): прямая запись закрыта.
  update public.characters set data = d, sheet_managed = true where campaign_id = p_campaign and id = p_character returning * into next_ch;
  insert into public.character_history(campaign_id, character_id, version, author, operation_id, kind, changes)
    values (p_campaign, p_character, next_ch.sheet_version, me, p_operation, 'level_up', public.character_sheet_delta(ch.data, next_ch.data));
  result_json := jsonb_build_object('ok', true, 'operationId', p_operation, 'replayed', false, 'hpGain', gain,
    'sheet', public.character_sheet_snapshot(next_ch));
  update public.character_operations set response = result_json where campaign_id = p_campaign and caller_id = me and operation_id = p_operation;
  return result_json;
end $$;
