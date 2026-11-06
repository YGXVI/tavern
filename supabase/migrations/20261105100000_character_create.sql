-- TASK-004 / TASK-186 P4a: atomic hero creation with optional claim (#61 task186-p4-create-dto-answers-1).
-- Plan r2 (c8e013b6…), D6a P4a. The build itself is checked in the browser (creation.verified='client');
-- server-side choice validation is P4b. Prototype verified on rules5e cdaf587, integrated after the 05.11 merge.

-- Hit die of the SRD 5.1 classes the builder can produce; anything else is rejected, not guessed.
create function public.character_class_hit_die(class_ref text) returns integer
language sql immutable set search_path = '' as $$
  select case class_ref
    when 'srd51:class:barbarian' then 12
    when 'srd51:class:fighter' then 10 when 'srd51:class:paladin' then 10 when 'srd51:class:ranger' then 10
    when 'srd51:class:sorcerer' then 6 when 'srd51:class:wizard' then 6
    when 'srd51:class:bard' then 8 when 'srd51:class:cleric' then 8 when 'srd51:class:druid' then 8
    when 'srd51:class:monk' then 8 when 'srd51:class:rogue' then 8 when 'srd51:class:warlock' then 8
  end;
$$;

-- Shape of the immutable provenance block; its selections are not interpreted here (P4b).
create function public.character_creation_valid(c jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare e jsonb;
begin
  if jsonb_typeof(c) is distinct from 'object' or c -> 'schemaVersion' <> '1'::jsonb or c ->> 'edition' is distinct from '5e-2014'
    or jsonb_typeof(c -> 'levelHistory') is distinct from 'array' or jsonb_typeof(c -> 'selections') is distinct from 'object'
    or jsonb_typeof(c -> 'ancestry') is distinct from 'object' or jsonb_typeof(c -> 'background') is distinct from 'object'
    or jsonb_typeof(c -> 'abilityInput') is distinct from 'object' or jsonb_typeof(c -> 'rulesRevision') is distinct from 'string'
    or jsonb_array_length(c -> 'levelHistory') not between 1 and 20 then return false; end if;
  for e in select value from jsonb_array_elements(c -> 'levelHistory') loop
    if public.character_class_hit_die(e ->> 'classId') is null then return false; end if;
  end loop;
  return true;
end $$;

-- Fixed average HP (plan r1 D3 default): max first die + CON, then die/2+1 + CON per level, plus per-level bonuses.
-- Mirrors creationHitPoints() in sheet-rules.js; both are checked against the same fixtures.
create function public.character_creation_hp(d jsonb) returns integer
language plpgsql immutable set search_path = '' as $$
declare con integer; m integer; total integer := 0; e jsonb; n integer := 0; die integer; sorcerer integer := 0;
begin
  if jsonb_typeof(d -> 'stats' -> 'con') is distinct from 'number' then return null; end if;
  con := (d -> 'stats' ->> 'con')::integer; m := floor((con - 10) / 2.0);
  for e in select value from jsonb_array_elements(d -> 'creation' -> 'levelHistory') loop
    n := n + 1; die := public.character_class_hit_die(e ->> 'classId');
    if die is null then return null; end if;
    total := total + (case when n = 1 then die else die / 2 + 1 end) + m;
    if e ->> 'classId' = 'srd51:class:sorcerer' then sorcerer := sorcerer + 1; end if;
  end loop;
  if d -> 'creation' -> 'ancestry' ->> 'subraceId' = 'srd51:subrace:dwarf:hill-dwarf' then total := total + n; end if; -- Dwarven Toughness
  if exists(select 1 from jsonb_array_elements(coalesce(d -> 'classes','[]'::jsonb)) c
            where c ->> 'subclassRef' = 'srd51:subclass:sorcerer:draconic-bloodline') then total := total + sorcerer; end if; -- Draconic Resilience
  return total;
end $$;

create function public.create_character_sheet(p_campaign text, p_character text, p_operation uuid, p_payload jsonb, p_claim boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); mem public.campaign_members; prior public.character_operations; request jsonb; d jsonb;
  ch public.characters; claimed jsonb; result_json jsonb; hp integer; levels integer;
begin
  select * into mem from public.campaign_members where campaign_id = p_campaign and user_id = me and status = 'active' for share;
  if not found then raise exception 'Кампания недоступна' using errcode = '42501'; end if;
  if p_claim and mem.role <> 'player' then raise exception 'Выбирает героя игрок кампании' using errcode = '42501'; end if;
  if p_operation is null or p_character is null or p_character !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text) > 262144 then
    raise exception 'Нужны UUID героя и операции и объект листа' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_campaign || ':' || me::text || ':' || p_operation::text, 0));
  request := jsonb_build_object('characterId', p_character, 'kind', 'create', 'claim', coalesce(p_claim, false), 'payload', p_payload);
  select * into prior from public.character_operations where campaign_id = p_campaign and caller_id = me and operation_id = p_operation;
  if found then
    if prior.request <> request then raise exception 'ID операции уже использован для другого запроса' using errcode = '22023'; end if;
    return prior.response || '{"replayed":true}'::jsonb;
  end if;
  if exists(select 1 from public.characters where id = p_character) then
    raise exception 'ID героя уже занят: начните новую попытку с новым ID' using errcode = '23505'; end if;
  if p_payload ?| array['id', 'ownerId', 'version', 'managed', 'controllers', 'archivedAt'] then
    raise exception 'Служебные поля листа задаёт сервер' using errcode = '22023'; end if;
  d := p_payload;
  if d ->> 'profile' is distinct from 'pc' then raise exception 'Командой создаётся только герой игрока' using errcode = '22023'; end if;
  if not public.character_creation_valid(d -> 'creation') then raise exception 'Нужен блок creation версии 1' using errcode = '22023'; end if;
  d := jsonb_set(d, '{creation,verified}', '"client"');
  levels := jsonb_array_length(d -> 'creation' -> 'levelHistory');
  if jsonb_typeof(d -> 'classes') is distinct from 'array'
    or (select coalesce(sum((c ->> 'levels')::integer), 0) from jsonb_array_elements(d -> 'classes') c) <> levels
    or d -> 'level' <> to_jsonb(levels) then
    raise exception 'Уровень, классы и история уровней не совпадают' using errcode = '22023'; end if;
  hp := public.character_creation_hp(d);
  if hp is null or hp < 1 or d -> 'hpMax' <> to_jsonb(hp) or d -> 'hp' <> to_jsonb(hp) then
    raise exception 'Хиты не совпадают с формулой создания (%)', hp using errcode = '22023'; end if;
  -- Validation of every key runs in characters_sheet_guard; the history row 'create' is written by its trigger.
  insert into public.characters(id, campaign_id, owner_id, data, sheet_managed) values (p_character, p_campaign, me, d, true) returning * into ch;
  insert into public.character_operations(campaign_id, caller_id, operation_id, character_id, kind, request)
    values (p_campaign, me, p_operation, p_character, 'create', request);
  if p_claim then
    claimed := public.claim_character(p_campaign, p_character);
    if (claimed ->> 'ok')::boolean is not true then raise exception 'Место героя занято' using errcode = '40001'; end if;
    select * into ch from public.characters where id = p_character;
  end if;
  result_json := jsonb_build_object('ok', true, 'operationId', p_operation, 'replayed', false, 'sheet', public.character_sheet_snapshot(ch));
  update public.character_operations set response = result_json where campaign_id = p_campaign and caller_id = me and operation_id = p_operation;
  return result_json;
end $$;

revoke execute on function public.character_class_hit_die(text), public.character_creation_valid(jsonb), public.character_creation_hp(jsonb),
  public.create_character_sheet(text, text, uuid, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.create_character_sheet(text, text, uuid, jsonb, boolean) to authenticated;
