-- Личность героя на сервере (#202): data.personality — черты, идеалы, привязанности, слабости, внешность, история.
-- Экраны героя (#203) уже показывают и правят это поле, но character_command отвергал его как неизвестное, поэтому
-- на сервере черты уходили в заметки. Права прежние: поле сборки, меняют владелец и мастер (edit с patch); видят все
-- участники кампании, как весь лист (решение Яры, TASK-004). Лист в базе не меняется: разрушительных шагов нет.

create function public.character_personality_valid(v jsonb) returns void
language plpgsql immutable set search_path = '' as $$
declare k text; x jsonb;
begin
  if jsonb_typeof(v) <> 'object' then raise exception 'Нужен объект: personality' using errcode = '22023'; end if;
  for k, x in select key, value from jsonb_each(v) loop
    if not (k = any (array['traits', 'ideals', 'bonds', 'flaws', 'appearance', 'backstory'])) then
      raise exception 'Неизвестное поле личности: %', k using errcode = '22023'; end if;
    if jsonb_typeof(x) = 'null' then continue; end if;
    if jsonb_typeof(x) <> 'string' then raise exception 'Нужен текст: personality.%', k using errcode = '22023'; end if;
    if length(x #>> '{}') > 20000 then raise exception 'Слишком длинный текст: personality.%', k using errcode = '22023'; end if;
  end loop;
end $$;
revoke execute on function public.character_personality_valid(jsonb) from public, anon, authenticated;

-- Обе функции большие, меняется по одной строке: правим их определение на месте, а не копируем целиком
-- (копия затёрла бы правки, внесённые позже). Если нужного места нет — миграция падает, а не проходит молча.
do $$
declare src text; out_src text;
begin
  src := pg_get_functiondef('public.validate_character_sheet(jsonb,text[])'::regprocedure);
  out_src := replace(src, $x$elsif k = any(array['slots','sidekick',$x$, $x$elsif k = 'personality' then
      perform public.character_personality_valid(v);
    elsif k = any(array['slots','sidekick',$x$);
  if out_src = src then raise exception 'validate_character_sheet: не найдено место для personality'; end if;
  execute out_src;

  src := pg_get_functiondef('public.character_command(text,text,bigint,uuid,text,jsonb)'::regprocedure);
  out_src := replace(src, $x$'concentration','statblock'];$x$, $x$'concentration','statblock','personality'];$x$);
  if out_src = src then raise exception 'character_command: не найден список полей'; end if;
  execute out_src;
end $$;
