-- TASK-004: проверяем типизированную механику, не исполняя текст и не выдавая права по JSON.
create function public.validate_character_details(d jsonb, fields text[])
returns void language plpgsql security definer set search_path='' as $$
declare s jsonb; v jsonb; item jsonb; part jsonb; mechanic jsonb; k text; subkey text; list_name text; n bigint; low_value bigint;
begin
  if 'inventoryItems'=any(fields) and jsonb_typeof(d->'inventoryItems')='array' then
    for item in select value from jsonb_array_elements(d->'inventoryItems') loop
      v:=item->'weight';if v is not null and v<>'null'::jsonb and (jsonb_typeof(v)<>'number' or v::text::numeric<0 or v::text::numeric>9007199254740991) then raise exception 'Вес — неотрицательное число' using errcode='22023'; end if;
    end loop;
  end if;
  foreach k in array array['saves','skills'] loop
    if k=any(fields) and jsonb_typeof(d->k)='array' then
      for item in select value from jsonb_array_elements(d->k) loop
        if jsonb_typeof(item)<>'string' then raise exception 'Нужен ID владения: %',k using errcode='22023'; end if;
      end loop;
    end if;
  end loop;
  foreach list_name in array array['concentration','proficiencies'] loop
    if list_name=any(fields) and jsonb_typeof(d->list_name)='object' then
      foreach k in array case when list_name='concentration' then array['name','sourceId','duration'] else array['languages','tools'] end loop
        v:=d#>array[list_name,k];if v is not null and v<>'null'::jsonb and jsonb_typeof(v)<>'string' then raise exception 'Нужен текст: %.%',list_name,k using errcode='22023'; end if;
      end loop;
    end if;
  end loop;
  if 'movement'=any(fields) and d#>'{movement,hover}' is not null and d#>'{movement,hover}'<>'null'::jsonb and jsonb_typeof(d#>'{movement,hover}')<>'boolean' then raise exception 'Парение — логическое значение' using errcode='22023'; end if;
  if 'defenses'=any(fields) and jsonb_typeof(d->'defenses')='object' then
    foreach k in array array['resistances','immunities','vulnerabilities','conditionImmunities'] loop
      v:=d#>array['defenses',k];if v is null or v='null'::jsonb then continue; end if;
      if jsonb_typeof(v)='array' then
        for item in select value from jsonb_array_elements(v) loop
          if jsonb_typeof(item)<>'string' then raise exception 'Защиты — текстовые записи' using errcode='22023'; end if;
        end loop;
      elsif jsonb_typeof(v)<>'string' then raise exception 'Защиты — текст или список текста' using errcode='22023'; end if;
    end loop;
  end if;
  if 'overrides'=any(fields) and jsonb_typeof(d->'overrides')='object' then
    foreach k in array array['proficiency','initiative','saves','skills'] loop
      v:=d#>array['overrides',k];if v is null or v='null'::jsonb then continue; end if;
      if jsonb_typeof(v)<>'object' then raise exception 'Нужен объект переопределения: %',k using errcode='22023'; end if;
      for item in select value from jsonb_each(case when k in('saves','skills') then v else jsonb_build_object('value',v) end) loop
        if item='null'::jsonb then continue; end if;
        if jsonb_typeof(item)<>'object' then raise exception 'Нужно переопределение с value/reason' using errcode='22023'; end if;
        if item->'value' is not null and item->'value'<>'null'::jsonb then perform public.character_sheet_int(item->'value','override.value'); end if;
        if item->'reason' is not null and jsonb_typeof(item->'reason')<>'string' then raise exception 'Причина должна быть текстом' using errcode='22023'; end if;
      end loop;
    end loop;
  end if;
  if 'sidekick'=any(fields) and jsonb_typeof(d->'sidekick')='object' then
    s:=d->'sidekick';
    if s ? 'canSpeakLanguage' and jsonb_typeof(s->'canSpeakLanguage') not in ('boolean','null') then raise exception 'Говоримый язык: boolean или null' using errcode='22023'; end if;
    if s ? 'eligibilityNote' and jsonb_typeof(s->'eligibilityNote') not in ('string','null') then raise exception 'Основание исключения: текст' using errcode='22023'; end if;

    if s->'class' is not null and s->'class'<>'null'::jsonb and s->>'class' not in('warrior','expert','spellcaster') then raise exception 'Неизвестный класс Sidekick' using errcode='22023'; end if;
    foreach k in array array['level','baseLevel'] loop
      if s->k is not null and s->k<>'null'::jsonb then perform public.character_sheet_int(s->k,'sidekick.'||k,1,20); end if;
    end loop;
    if s->'hitDie' is not null and s->'hitDie'<>'null'::jsonb then
      n:=public.character_sheet_int(s->'hitDie','sidekick.hitDie');if n not in(4,6,8,10,12,20) then raise exception 'Неизвестная кость Sidekick' using errcode='22023'; end if;
    end if;
    if s ? 'partyIds' and s->'partyIds'<>'null'::jsonb then
      if jsonb_typeof(s->'partyIds')<>'array' then raise exception 'Нужен список героев подсказки' using errcode='22023'; end if;
      for item in select value from jsonb_array_elements(s->'partyIds') loop
        if jsonb_typeof(item)<>'string' then raise exception 'Нужен ID героя подсказки' using errcode='22023'; end if;
      end loop;
    end if;
  end if;
  if not('statblock'=any(fields)) or d->'statblock' is null or d->'statblock'='null'::jsonb then return; end if;
  s:=d->'statblock';
  if jsonb_typeof(s)<>'object' or octet_length(s::text)>65536 then raise exception 'Статблок должен быть объектом до 64 КиБ' using errcode='22023'; end if;
  foreach k in array array['type','senses','languages','hpFormula','cr','statblockImage','templateVersion','source'] loop
    v:=s->k;if v is not null and v<>'null'::jsonb and jsonb_typeof(v)<>'string' then raise exception 'Нужен текст statblock.%',k using errcode='22023'; end if;
  end loop;
  if s->'size' is not null and s->'size'<>'null'::jsonb and coalesce(s->>'size','') not in('tiny','small','medium','large','huge','gargantuan') then raise exception 'Неизвестный размер' using errcode='22023'; end if;
  if s->'cr' is not null and s->'cr'<>'null'::jsonb and (s->>'cr') !~ '^(0|[1-9][0-9]*|1/[248])$' then raise exception 'Неверная опасность' using errcode='22023'; end if;
  if s->>'source' is not null and s->>'source' not in('manual','image') then raise exception 'Неизвестный источник статблока' using errcode='22023'; end if;
  if s->>'source'='image' and coalesce(length(s->>'statblockImage'),0)=0 then raise exception 'Нужно изображение-источник' using errcode='22023'; end if;
  if s->'legendary' is not null and s->'legendary'<>'null'::jsonb then
    if jsonb_typeof(s->'legendary')<>'object' then raise exception 'Нужны параметры легендарных действий' using errcode='22023'; end if;
    if s#>'{legendary,count}' is not null and s#>'{legendary,count}'<>'null'::jsonb then perform public.character_sheet_int(s#>'{legendary,count}','legendary.count',0); end if;
  end if;
  foreach list_name in array array['traits','actions','bonusActions','reactions','legendary','lairActions'] loop
    v:=case when list_name='legendary' then s#>'{legendary,actions}' else s->list_name end;
    if v is null or v='null'::jsonb then continue; end if;
    if jsonb_typeof(v)<>'array' then raise exception 'Нужен список возможностей: %',list_name using errcode='22023'; end if;
    for item in select value from jsonb_array_elements(v) loop
      if jsonb_typeof(item)<>'object' or jsonb_typeof(item->'name') is distinct from 'string' or length(trim(item->>'name'))=0 then raise exception 'Нужна возможность с именем' using errcode='22023'; end if;
      if item->'text' is not null and jsonb_typeof(item->'text')<>'string' then raise exception 'Описание — текст' using errcode='22023'; end if;
      mechanic:=item->'attack';
      if mechanic is not null and mechanic<>'null'::jsonb then
        if jsonb_typeof(mechanic)<>'object' then raise exception 'Нужна структура атаки' using errcode='22023'; end if;
        if mechanic->'bonus' is not null and mechanic->'bonus'<>'null'::jsonb then perform public.character_sheet_int(mechanic->'bonus','attack.bonus'); end if;
        if mechanic->'reach' is not null and mechanic->'reach'<>'null'::jsonb then perform public.character_sheet_int(mechanic->'reach','attack.reach',0); end if;
      end if;
      mechanic:=item->'save';
      if mechanic is not null and mechanic<>'null'::jsonb then
        if jsonb_typeof(mechanic)<>'object' or coalesce(mechanic->>'ability','') not in('str','dex','con','int','wis','cha') or coalesce(mechanic->>'who','') not in('target','self') then raise exception 'Спасбросок требует характеристики и явного target/self' using errcode='22023'; end if;
        if mechanic->'dc' is not null and mechanic->'dc'<>'null'::jsonb then perform public.character_sheet_int(mechanic->'dc','save.dc',0); end if;
      end if;
      mechanic:=item->'damage';
      if mechanic is not null and mechanic<>'null'::jsonb then
        if jsonb_typeof(mechanic)<>'array' then raise exception 'Нужны компоненты урона' using errcode='22023'; end if;
        for part in select value from jsonb_array_elements(mechanic) loop
          if jsonb_typeof(part)<>'object' then raise exception 'Нужна запись компонента урона' using errcode='22023'; end if;
          foreach k in array array['dice','type'] loop
            if part->k is not null and part->k<>'null'::jsonb and jsonb_typeof(part->k)<>'string' then raise exception 'Формула и тип урона — текст' using errcode='22023'; end if;
          end loop;
        end loop;
      end if;
      low_value:=null;
      foreach k in array array['rechargeMin','rechargeMax'] loop
        if item->k is not null and item->k<>'null'::jsonb then
          n:=public.character_sheet_int(item->k,k,1,6);if k='rechargeMin' then low_value:=n;elsif low_value>n then raise exception 'Неверный диапазон перезарядки' using errcode='22023'; end if;
        end if;
      end loop;
    end loop;
  end loop;
end $$;
revoke all on function public.validate_character_details(jsonb,text[]) from public,anon,authenticated;

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
  perform public.validate_character_details(d,fields);
end $$;

