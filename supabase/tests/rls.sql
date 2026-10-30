-- TASK-002 · проверка прав (RLS и триггеров-охранников) от имени мастера, игрока, ожидающего и постороннего.
-- Всё в одной транзакции без COMMIT: после выполнения данные исчезают. Последний SELECT — таблица результатов.
-- Запуск: Supabase SQL (MCP execute_sql или SQL Editor) от владельца базы. Ожидание: все строки ok = true.
begin;

create temp table _r (at timestamptz default clock_timestamp(), test text, ok boolean, info text);
grant insert, select on _r to authenticated, anon;

create function pg_temp.login(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create function pg_temp.ok(name text, q text) returns void language plpgsql as $$
begin
  begin execute q; insert into _r (test, ok) values (name, true);
  exception when others then insert into _r (test, ok, info) values (name, false, left(sqlerrm, 160)); end;
end $$;
create function pg_temp.err(name text, q text) returns void language plpgsql as $$
begin
  begin execute q; insert into _r (test, ok, info) values (name, false, 'ошибки не было');
  exception when others then insert into _r (test, ok, info) values (name, true, left(sqlerrm, 160)); end;
end $$;
create function pg_temp.rows(name text, q text, n int) returns void language plpgsql as $$
declare c int;
begin
  begin execute q; get diagnostics c = row_count; insert into _r (test, ok, info) values (name, c = n, format('строк: %s, ждали %s', c, n));
  exception when others then insert into _r (test, ok, info) values (name, false, left(sqlerrm, 160)); end;
end $$;
create function pg_temp.cnt(name text, q text, n int) returns void language plpgsql as $$
declare c int;
begin
  begin execute format('select count(*) from (%s) x', q) into c; insert into _r (test, ok, info) values (name, c = n, format('видно: %s, ждали %s', c, n));
  exception when others then insert into _r (test, ok, info) values (name, false, left(sqlerrm, 160)); end;
end $$;
grant execute on function pg_temp.login(uuid), pg_temp.ok(text, text), pg_temp.err(text, text), pg_temp.rows(text, text, int), pg_temp.cnt(text, text, int) to authenticated, anon;

-- Люди: мастер M, игрок P, второй игрок Q (останется ожидающим), посторонний X.
insert into auth.users (id, raw_user_meta_data, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', '{"full_name":"Мастер"}', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000b', '{"full_name":"Игрок"}', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000c', '{"full_name":"Ждущий"}', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000d', '{"full_name":"Посторонний"}', 'authenticated', 'authenticated');

-- ——— Мастер готовит кампанию ———
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select pg_temp.ok('мастер создаёт кампанию', $q$insert into public.campaigns (id, owner_id, name, data) values ('c-rls', '00000000-0000-0000-0000-00000000000a', 'Проверка', '{"seats": 2, "settings": {}}')$q$);
select pg_temp.cnt('создатель стал мастером', $q$select 1 from public.campaign_members where campaign_id = 'c-rls' and role = 'master' and status = 'active'$q$, 1);
select pg_temp.ok('мастер ставит приглашение', $q$insert into public.campaign_invites (campaign_id, code, manual) values ('c-rls', 'RSP-RLS1', true)$q$);
select pg_temp.ok('мастер добавляет героев', $q$insert into public.characters (id, campaign_id, data) values ('ch-p', 'c-rls', '{"name":"Лира","hp":10}'), ('ch-s', 'c-rls', '{"name":"Сид","hp":8}')$q$);
select pg_temp.ok('мастер заводит героя второму игроку', $q$insert into public.characters (id, campaign_id, owner_id, data) values ('ch-q', 'c-rls', '00000000-0000-0000-0000-00000000000c', '{"name":"Торин","hp":12}')$q$);
select pg_temp.ok('мастер создаёт сцену', $q$insert into public.scenes (id, campaign_id, data) values ('s-1', 'c-rls', '{"name":"Склеп","walls":[{"id":"w1","kind":"door","open":false,"locked":false},{"id":"w2","kind":"door","open":false,"locked":true},{"id":"w3","kind":"wall"}],"lights":[]}')$q$);
select pg_temp.ok('мастер пишет тайное сцены', $q$insert into public.scene_secrets (scene_id, campaign_id, data) values ('s-1', 'c-rls', '{"traps":[{"id":"tr1","dc":15}]}')$q$);
select pg_temp.ok('мастер ставит токены', $q$insert into public.tokens (id, campaign_id, scene_id, character_id, hidden, ord, data) values
  ('t-gob', 'c-rls', 's-1', null, false, 1, '{"kind":"foe","name":"Гоблин","x":100,"y":100,"hp":7}'),
  ('t-ogre', 'c-rls', 's-1', null, true, 2, '{"kind":"foe","name":"Огр","x":300,"y":300,"hp":59}'),
  ('t-lock', 'c-rls', 's-1', null, false, 3, '{"kind":"item","name":"Алтарь","x":50,"y":50,"locked":true}'),
  ('t-q2', 'c-rls', 's-1', 'ch-q', false, 7, '{"kind":"hero","name":"Торин","x":70,"y":70}')$q$);
select pg_temp.ok('мастер пишет скрытый бросок', $q$insert into public.log_entries (id, campaign_id, author, at, vis, data) values ('r-gm', 'c-rls', '00000000-0000-0000-0000-00000000000a', 1, 'gm', '{"kind":"roll"}')$q$);
select pg_temp.ok('тайная часть броска', $q$insert into public.log_secrets (id, campaign_id, author, vis, data) values ('r-gm', 'c-rls', '00000000-0000-0000-0000-00000000000a', 'gm', '{"label":"Огр: атака","total":19}')$q$);
select pg_temp.ok('мастер загружает карту в хранилище', $q$insert into storage.objects (bucket_id, name) values ('maps', 'c-rls/map.webp')$q$);
reset role;

-- ——— Предпросмотр и вступление ———
set local role anon;
select pg_temp.cnt('аноним видит карточку приглашения', $q$select 1 where (public.invite_preview('rsp-rls1') ->> 'name') = 'Проверка'$q$, 1);
select pg_temp.err('аноним не читает таблицы кампаний', $q$select 1 from public.campaigns$q$);
reset role;

select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select pg_temp.cnt('неверный код — отказ', $q$select 1 where (public.join_campaign('RSP-NOPE') ->> 'ok')::boolean = false$q$, 1);
select pg_temp.cnt('игрок подаёт заявку', $q$select 1 where (public.join_campaign('RSP-RLS1') ->> 'status') = 'pending'$q$, 1);
select pg_temp.cnt('ожидающий видит кампанию', $q$select 1 from public.campaigns where id = 'c-rls'$q$, 1);
select pg_temp.cnt('ожидающий не видит сцены', $q$select 1 from public.scenes$q$, 0);
select pg_temp.cnt('ожидающий не видит героев', $q$select 1 from public.characters$q$, 0);
select pg_temp.err('ожидающий не одобряет себя сам', $q$update public.campaign_members set status = 'active' where campaign_id = 'c-rls' and user_id = '00000000-0000-0000-0000-00000000000b'$q$);
reset role;
select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select pg_temp.cnt('второй тоже подаёт заявку', $q$select 1 where (public.join_campaign('RSP-RLS1') ->> 'status') = 'pending'$q$, 1);
reset role;
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select pg_temp.rows('мастер принимает игрока', $q$update public.campaign_members set status = 'active' where campaign_id = 'c-rls' and user_id = '00000000-0000-0000-0000-00000000000b'$q$, 1);
select pg_temp.ok('мастер делает мест: 1', $q$update public.campaigns set data = jsonb_set(data, '{seats}', '1') where id = 'c-rls'$q$);
select pg_temp.err('мест нет — второго не принять', $q$update public.campaign_members set status = 'active' where campaign_id = 'c-rls' and user_id = '00000000-0000-0000-0000-00000000000c'$q$);
reset role;

-- ——— Игрок за столом ———
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select pg_temp.cnt('игрок выбирает свободного героя', $q$select 1 where (public.claim_character('c-rls', 'ch-p') ->> 'ok')::boolean$q$, 1);
select pg_temp.cnt('TASK-123: игрок берёт второго свободного героя', $q$select 1 where (public.claim_character('c-rls', 'ch-s') ->> 'ok')::boolean$q$, 1);
select pg_temp.cnt('TASK-123: первый выбранный остаётся героем в членстве', $q$select 1 from public.campaign_members where user_id = '00000000-0000-0000-0000-00000000000b' and character_id = 'ch-p'$q$, 1);
select pg_temp.cnt('TASK-123: героя другого участника не взять', $q$select 1 where (public.claim_character('c-rls', 'ch-q') ->> 'error') = 'taken'$q$, 1);
select pg_temp.err('роль мастера себе не дать', $q$update public.campaign_members set role = 'master' where campaign_id = 'c-rls' and user_id = '00000000-0000-0000-0000-00000000000b'$q$);
select pg_temp.ok('игрок ставит своего героя', $q$insert into public.tokens (id, campaign_id, scene_id, character_id, hidden, ord, data) values ('t-p', 'c-rls', 's-1', 'ch-p', false, 4, '{"kind":"hero","name":"Лира","x":10,"y":10}')$q$);
select pg_temp.err('чужого героя на сцену не поставить', $q$insert into public.tokens (id, campaign_id, scene_id, character_id, hidden, ord, data) values ('t-q', 'c-rls', 's-1', 'ch-q', false, 5, '{"kind":"hero"}')$q$);
select pg_temp.err('существо игрок не создаёт', $q$insert into public.tokens (id, campaign_id, scene_id, hidden, ord, data) values ('t-x', 'c-rls', 's-1', false, 6, '{"kind":"foe"}')$q$);
select pg_temp.cnt('игрок видит только нескрытые токены', $q$select 1 from public.tokens where campaign_id = 'c-rls'$q$, 4);
select pg_temp.cnt('скрытого огра в ответе нет', $q$select 1 from public.tokens where id = 't-ogre'$q$, 0);
select pg_temp.cnt('тайное сцены (ловушки) не видно', $q$select 1 from public.scene_secrets$q$, 0);
select pg_temp.cnt('тайная часть броска мастера не видна', $q$select 1 from public.log_secrets$q$, 0);
select pg_temp.cnt('факт скрытого броска виден', $q$select 1 from public.log_entries where id = 'r-gm'$q$, 1);
select pg_temp.rows('открытое перемещение: игрок двигает гоблина', $q$update public.tokens set data = data || '{"x":140,"y":120,"movedAt":5}' where id = 't-gob'$q$, 1);
select pg_temp.rows('и поворачивает его', $q$update public.tokens set data = data || '{"rot":90}' where id = 't-gob'$q$, 1);
select pg_temp.err('хиты гоблина игрок не меняет', $q$update public.tokens set data = data || '{"hp":1}' where id = 't-gob'$q$);
select pg_temp.err('размер гоблина игрок не меняет', $q$update public.tokens set data = data || '{"scale":2}' where id = 't-gob'$q$);
select pg_temp.err('скрыть гоблина игрок не может', $q$update public.tokens set hidden = true where id = 't-gob'$q$);
select pg_temp.err('закреплённый токен не двигается', $q$update public.tokens set data = data || '{"x":60}' where id = 't-lock'$q$);
select pg_temp.rows('скрытый огр недоступен для изменения', $q$update public.tokens set data = data || '{"x":1}' where id = 't-ogre'$q$, 0);
select pg_temp.err('удалить чужой токен игрок не может', $q$delete from public.tokens where id = 't-gob'$q$);
select pg_temp.rows('свой герой: размер и свет', $q$update public.tokens set data = data || '{"scale":1.4,"light":{"bright":20}}' where id = 't-p'$q$, 1);
select pg_temp.rows('лист своего героя игрок меняет', $q$update public.characters set data = data || '{"hp":7}' where id = 'ch-p'$q$, 1);
select pg_temp.rows('лист чужого героя недоступен', $q$update public.characters set data = data || '{"hp":1}' where id = 'ch-q'$q$, 0);
select pg_temp.rows('незапертую дверь игрок открывает', $q$update public.scenes set data = jsonb_set(data, '{walls,0,open}', 'true') where id = 's-1'$q$, 1);
select pg_temp.err('запертую дверь не открыть', $q$update public.scenes set data = jsonb_set(data, '{walls,1,open}', 'true') where id = 's-1'$q$);
select pg_temp.err('стену дверью не сделать', $q$update public.scenes set data = jsonb_set(data, '{walls,2,kind}', '"door"') where id = 's-1'$q$);
select pg_temp.err('свет сцены меняет мастер', $q$update public.scenes set data = jsonb_set(data, '{lights}', '[{"id":"l1"}]') where id = 's-1'$q$);
select pg_temp.ok('игрок дописывает исследованные клетки', $q$select public.add_explored('s-1', array['1,1', '2,1'])$q$);
select pg_temp.err('напрямую исследованное не переписать', $q$insert into public.scene_explored (scene_id, campaign_id, cells) values ('s-1', 'c-rls', '{}') on conflict (scene_id) do update set cells = '{}'$q$);
select pg_temp.ok('игрок пишет свой бросок', $q$insert into public.log_entries (id, campaign_id, author, at, vis, data) values ('r-p', 'c-rls', '00000000-0000-0000-0000-00000000000b', 2, 'all', '{"label":"Лира: атака","total":14}')$q$);
select pg_temp.err('бросок от чужого имени нельзя', $q$insert into public.log_entries (id, campaign_id, author, at, vis, data) values ('r-x', 'c-rls', '00000000-0000-0000-0000-00000000000a', 3, 'all', '{}')$q$);
select pg_temp.ok('игрок рисует', $q$insert into public.drawings (id, campaign_id, scene_id, author, data) values ('d-p', 'c-rls', 's-1', '00000000-0000-0000-0000-00000000000b', '{"type":"line"}')$q$);
select pg_temp.ok('игрок просит переход', $q$insert into public.portal_requests (id, campaign_id, author, data) values ('q-p', 'c-rls', '00000000-0000-0000-0000-00000000000b', '{"tokenId":"t-p"}')$q$);
select pg_temp.cnt('игрок видит файл карты кампании', $q$select 1 from storage.objects where bucket_id = 'maps' and name like 'c-rls/%'$q$, 1);
select pg_temp.err('игрок не загружает карты', $q$insert into storage.objects (bucket_id, name) values ('maps', 'c-rls/p.webp')$q$);
reset role;

-- ——— Бой и спасброски ———
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select pg_temp.ok('мастер начинает бой', $q$insert into public.combats (campaign_id, data) values ('c-rls', '{"active":true,"round":1,"turn":0,"current":"t-gob","entries":[{"tokenId":"t-gob","init":15},{"tokenId":"t-p","init":null},{"tokenId":"t-q2","init":null},{"tokenId":"t-ogre","init":null}],"moved":{}}')$q$);
select pg_temp.ok('мастер просит спасбросок', $q$insert into public.save_requests (id, campaign_id, data) values ('sv-1', 'c-rls', '{"status":"open","results":{}}')$q$);
select pg_temp.cnt('мастер видит тайную часть броска', $q$select 1 from public.log_secrets$q$, 1);
select pg_temp.ok('мастер выключает открытое перемещение', $q$update public.campaigns set data = jsonb_set(data, '{settings,openMovement}', 'false') where id = 'c-rls'$q$);
reset role;
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select pg_temp.rows('игрок бросает свою инициативу', $q$update public.combats set data = jsonb_set(data, '{entries,1,init}', '12') where campaign_id = 'c-rls'$q$, 1);
select pg_temp.err('второй раз инициативу не переписать', $q$update public.combats set data = jsonb_set(data, '{entries,1,init}', '20') where campaign_id = 'c-rls'$q$);
select pg_temp.rows('инициатива за другого героя (сидит с телефона)', $q$update public.combats set data = jsonb_set(data, '{entries,2,init}', '9') where campaign_id = 'c-rls'$q$, 1);
select pg_temp.err('инициативу скрытого огра — мастер', $q$update public.combats set data = jsonb_set(data, '{entries,3,init}', '3') where campaign_id = 'c-rls'$q$);
select pg_temp.err('инициативу гоблина не тронуть', $q$update public.combats set data = jsonb_set(data, '{entries,0,init}', '1') where campaign_id = 'c-rls'$q$);
select pg_temp.err('ход монстра не закончить', $q$update public.combats set data = data || '{"ended":"t-gob"}' where campaign_id = 'c-rls'$q$);
select pg_temp.err('раунд игрок не меняет', $q$update public.combats set data = data || '{"round":2}' where campaign_id = 'c-rls'$q$);
select pg_temp.rows('движение героя и видимого гоблина в бою', $q$update public.combats set data = jsonb_set(data, '{moved}', '{"t-p":15,"t-gob":10}') where campaign_id = 'c-rls'$q$, 1);
select pg_temp.err('движение скрытого огра — мастер', $q$update public.combats set data = jsonb_set(data, '{moved,t-ogre}', '5') where campaign_id = 'c-rls'$q$);
select pg_temp.rows('спасбросок своего героя', $q$update public.save_requests set data = jsonb_set(data, '{results,t-p}', '{"total":13}') where id = 'sv-1'$q$, 1);
select pg_temp.rows('спасбросок за другого героя', $q$update public.save_requests set data = jsonb_set(data, '{results,t-q2}', '{"total":11}') where id = 'sv-1'$q$, 1);
select pg_temp.err('спасбросок за гоблина нельзя', $q$update public.save_requests set data = jsonb_set(data, '{results,t-gob}', '{"total":20}') where id = 'sv-1'$q$);
select pg_temp.err('свой результат не переписать', $q$update public.save_requests set data = jsonb_set(data, '{results,t-p}', '{"total":20}') where id = 'sv-1'$q$);
select pg_temp.err('выключено перемещение: гоблина не сдвинуть', $q$update public.tokens set data = data || '{"x":200}' where id = 't-gob'$q$);
select pg_temp.rows('своего героя — можно', $q$update public.tokens set data = data || '{"x":30}' where id = 't-p'$q$, 1);
reset role;
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select pg_temp.ok('мастер передаёт ход Торину (его игрока нет за столом)', $q$update public.combats set data = data || '{"turn":2,"current":"t-q2"}' where campaign_id = 'c-rls'$q$);
reset role;
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select pg_temp.rows('игрок заканчивает ход за другого героя', $q$update public.combats set data = data || '{"ended":"t-q2"}' where campaign_id = 'c-rls'$q$, 1);
reset role;

-- ——— Посторонний и ожидающий ———
select pg_temp.login('00000000-0000-0000-0000-00000000000d');
select pg_temp.cnt('посторонний не видит кампанию', $q$select 1 from public.campaigns where id = 'c-rls'$q$, 0);
select pg_temp.cnt('посторонний не видит сцены', $q$select 1 from public.scenes$q$, 0);
select pg_temp.cnt('посторонний не видит героев', $q$select 1 from public.characters$q$, 0);
select pg_temp.cnt('посторонний не видит журнал', $q$select 1 from public.log_entries$q$, 0);
select pg_temp.cnt('посторонний не видит участников', $q$select 1 from public.campaign_members where campaign_id = 'c-rls'$q$, 0);
select pg_temp.cnt('посторонний не видит профили участников', $q$select 1 from public.profiles where id <> '00000000-0000-0000-0000-00000000000d'$q$, 0);
select pg_temp.err('посторонний не пишет в журнал', $q$insert into public.log_entries (id, campaign_id, author, at, data) values ('r-d', 'c-rls', '00000000-0000-0000-0000-00000000000d', 4, '{}')$q$);
select pg_temp.err('посторонний не дописывает клетки', $q$select public.add_explored('s-1', array['3,3'])$q$);
select pg_temp.cnt('посторонний не видит файл карты', $q$select 1 from storage.objects where bucket_id = 'maps'$q$, 0);
select pg_temp.err('посторонний не кладёт файл в чужую кампанию', $q$insert into storage.objects (bucket_id, name) values ('maps', 'c-rls/x.webp')$q$);
reset role;
select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select pg_temp.err('ожидающий не просит переход', $q$insert into public.portal_requests (id, campaign_id, author, data) values ('q-c', 'c-rls', '00000000-0000-0000-0000-00000000000c', '{}')$q$);
reset role;

-- ——— TASK-123 (план TASK-097): свои токены, призывы, езда, частичная правка, хиты прибавкой ———
-- Открытое перемещение здесь выключено (выше) — чужие токены двигает только мастер.
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select pg_temp.ok('места: 2 — у игрока два героя, но место одно', $q$update public.campaigns set data = jsonb_set(data, '{seats}', '2') where id = 'c-rls'$q$);
select pg_temp.rows('второй игрок принят: места считают игроков, не героев', $q$update public.campaign_members set status = 'active' where campaign_id = 'c-rls' and user_id = '00000000-0000-0000-0000-00000000000c'$q$, 1);
-- review #126: вторая кампания мастера — для проверки границы сцена/кампания и И1 у мастера
select pg_temp.ok('TASK-123 (review): вторая кампания мастера со сценой', $q$insert into public.campaigns (id, owner_id, name, data) values ('c-rls2', '00000000-0000-0000-0000-00000000000a', 'Другая', '{"seats": 1, "settings": {}}')$q$);
select pg_temp.ok('TASK-123 (review): сцена второй кампании', $q$insert into public.scenes (id, campaign_id, data) values ('s-2', 'c-rls2', '{"name":"Чужая"}')$q$);
select pg_temp.err('TASK-123 (review): и мастер не ставит токен на сцену другой кампании', $q$insert into public.tokens (id, campaign_id, scene_id, ord, data) values ('t-xs', 'c-rls', 's-2', 1, '{"kind":"foe"}')$q$);
select pg_temp.err('TASK-123 (review): второй токен героя и мастеру не поставить (И1)', $q$insert into public.tokens (id, campaign_id, scene_id, character_id, ord, data) values ('t-q3', 'c-rls', 's-1', 'ch-q', 8, '{"kind":"hero","name":"Торин","x":90,"y":90}')$q$);
reset role;

select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select pg_temp.ok('игрок ставит второго своего героя', $q$insert into public.tokens (id, campaign_id, scene_id, character_id, ord, data) values ('t-s', 'c-rls', 's-1', 'ch-s', 10, '{"kind":"hero","name":"Сид","x":500,"y":500}')$q$);
select pg_temp.ok('игрок ставит свой токен-картинку', $q$insert into public.tokens (id, campaign_id, scene_id, owner_id, ord, data) values ('t-owl', 'c-rls', 's-1', '00000000-0000-0000-0000-00000000000b', 11, '{"kind":"custom","name":"Сова","img":"sb:c-rls/b/owl.webp","x":200,"y":200}')$q$);
select pg_temp.err('свой токен скрытым — отказ', $q$insert into public.tokens (id, campaign_id, scene_id, owner_id, hidden, ord, data) values ('t-x1', 'c-rls', 's-1', '00000000-0000-0000-0000-00000000000b', true, 12, '{"kind":"custom"}')$q$);
select pg_temp.err('свой токен от чужого имени — отказ', $q$insert into public.tokens (id, campaign_id, scene_id, owner_id, ord, data) values ('t-x2', 'c-rls', 's-1', '00000000-0000-0000-0000-00000000000c', 12, '{"kind":"custom"}')$q$);
select pg_temp.err('свой токен без владельца — отказ', $q$insert into public.tokens (id, campaign_id, scene_id, ord, data) values ('t-x3', 'c-rls', 's-1', 12, '{"kind":"custom"}')$q$);
select pg_temp.err('свой токен закреплённым — отказ', $q$insert into public.tokens (id, campaign_id, scene_id, owner_id, ord, data) values ('t-x4', 'c-rls', 's-1', '00000000-0000-0000-0000-00000000000b', 12, '{"kind":"custom","locked":true}')$q$);
select pg_temp.err('предмет игрок не ставит', $q$insert into public.tokens (id, campaign_id, scene_id, owner_id, ord, data) values ('t-x5', 'c-rls', 's-1', '00000000-0000-0000-0000-00000000000b', 12, '{"kind":"item"}')$q$);
select pg_temp.err('токен без вида игрок не ставит', $q$insert into public.tokens (id, campaign_id, scene_id, owner_id, ord, data) values ('t-x6', 'c-rls', 's-1', '00000000-0000-0000-0000-00000000000b', 12, '{"name":"?"}')$q$);
select pg_temp.err('слишком большой токен — отказ', $q$insert into public.tokens (id, campaign_id, scene_id, owner_id, ord, data) values ('t-x7', 'c-rls', 's-1', '00000000-0000-0000-0000-00000000000b', 12, jsonb_build_object('kind', 'custom', 'img', repeat('x', 70000)))$q$);
select pg_temp.ok('призыв коня к своему герою', $q$insert into public.tokens (id, campaign_id, scene_id, owner_id, ord, data) values ('t-horse', 'c-rls', 's-1', '00000000-0000-0000-0000-00000000000b', 13, '{"kind":"foe","monsterId":"warhorse","name":"Боевой конь","summonedBy":"t-p","disposition":"friendly","x":300,"y":200,"hp":19,"hpMax":19,"ac":11}')$q$);
select pg_temp.ok('призыв волка ко второму герою', $q$insert into public.tokens (id, campaign_id, scene_id, owner_id, ord, data) values ('t-wolf', 'c-rls', 's-1', '00000000-0000-0000-0000-00000000000b', 14, '{"kind":"foe","monsterId":"wolf","name":"Волк","summonedBy":"t-s","x":520,"y":500,"hp":11,"hpMax":11}')$q$);
select pg_temp.err('призыв к чужому герою — отказ', $q$insert into public.tokens (id, campaign_id, scene_id, owner_id, ord, data) values ('t-x8', 'c-rls', 's-1', '00000000-0000-0000-0000-00000000000b', 15, '{"kind":"foe","summonedBy":"t-q2"}')$q$);
select pg_temp.err('существо без призывателя — отказ', $q$insert into public.tokens (id, campaign_id, scene_id, owner_id, ord, data) values ('t-x9', 'c-rls', 's-1', '00000000-0000-0000-0000-00000000000b', 15, '{"kind":"foe"}')$q$);
select pg_temp.err('верхом сразу при постановке — отказ', $q$insert into public.tokens (id, campaign_id, scene_id, owner_id, ord, data) values ('t-x10', 'c-rls', 's-1', '00000000-0000-0000-0000-00000000000b', 15, '{"kind":"custom","riding":"t-horse"}')$q$);
select pg_temp.err('TASK-123 (review): свой токен на сцену чужой кампании — отказ', $q$insert into public.tokens (id, campaign_id, scene_id, owner_id, ord, data) values ('t-x11', 'c-rls', 's-2', '00000000-0000-0000-0000-00000000000b', 15, '{"kind":"custom"}')$q$);
select pg_temp.err('TASK-123 (review): второй токен своего героя — отказ (И1)', $q$insert into public.tokens (id, campaign_id, scene_id, character_id, ord, data) values ('t-s2', 'c-rls', 's-1', 'ch-s', 15, '{"kind":"hero","name":"Сид","x":10,"y":10}')$q$);
select pg_temp.rows('статы своему токену', $q$update public.tokens set data = data || '{"hp":1,"hpMax":1,"ac":11,"speed":30,"initBonus":2}' where id = 't-owl'$q$, 1);
select pg_temp.rows('имя, картинка, союзность, слой своему токену', $q$update public.tokens set data = data || '{"name":"Сова Аси","img":"sb:c-rls/b/owl2.webp","disposition":"friendly","layer":1}' where id = 't-owl'$q$, 1);
select pg_temp.rows('ездовое и размер — своему призыву', $q$update public.tokens set data = data || '{"mount":true,"size":"large"}' where id = 't-horse'$q$, 1);
select pg_temp.err('размер чужому гоблину — отказ', $q$update public.tokens set data = data || '{"size":"huge"}' where id = 't-gob'$q$);
select pg_temp.err('вид токена не меняется', $q$update public.tokens set data = data || '{"kind":"foe"}' where id = 't-owl'$q$);
select pg_temp.err('существо призыва не подменить', $q$update public.tokens set data = data || '{"monsterId":"ogre"}' where id = 't-horse'$q$);
select pg_temp.err('призывателя не подменить', $q$update public.tokens set data = data || '{"summonedBy":"t-owl"}' where id = 't-horse'$q$);
select pg_temp.err('владельца не сменить', $q$update public.tokens set owner_id = '00000000-0000-0000-0000-00000000000c' where id = 't-owl'$q$);
select pg_temp.err('TASK-123 (review): свой токен на сцену чужой кампании не перенести', $q$update public.tokens set scene_id = 's-2' where id = 't-owl'$q$);
select pg_temp.err('свой токен не скрыть', $q$update public.tokens set hidden = true where id = 't-owl'$q$);
select pg_temp.err('имя своему герою — в листе, не на токене', $q$update public.tokens set data = data || '{"name":"Не Лира"}' where id = 't-p'$q$);
-- Хиты прибавкой
select pg_temp.ok('коню −3 хита', $q$select public.adjust_token('t-horse', '{"hp":-3}')$q$);
select pg_temp.ok('и ещё −2', $q$select public.adjust_token('t-horse', '{"hp":-2}')$q$);
select pg_temp.cnt('оба расхода учтены: 19 − 3 − 2 = 14', $q$select 1 from public.tokens where id = 't-horse' and (data ->> 'hp')::int = 14$q$, 1);
select pg_temp.cnt('хиты не ниже 0', $q$select 1 where (public.adjust_token('t-horse', '{"hp":-100}') ->> 'hp')::int = 0$q$, 1);
select pg_temp.cnt('и не выше максимума', $q$select 1 where (public.adjust_token('t-horse', '{"hp":100}') ->> 'hp')::int = 19$q$, 1);
select pg_temp.cnt('временные хиты прибавкой', $q$select 1 where (public.adjust_token('t-horse', '{"tempHp":5}') ->> 'tempHp')::int = 5$q$, 1);
select pg_temp.err('прибавкой — только хиты', $q$select public.adjust_token('t-horse', '{"ac":1}')$q$);
select pg_temp.err('хиты героя — в листе', $q$select public.adjust_token('t-p', '{"hp":-1}')$q$);
select pg_temp.err('хиты гоблина игрок не меняет и прибавкой', $q$select public.adjust_token('t-gob', '{"hp":-1}')$q$);
select pg_temp.ok('TASK-123 (review): свой токен с hpMax 0', $q$insert into public.tokens (id, campaign_id, scene_id, owner_id, ord, data) values ('t-zero', 'c-rls', 's-1', '00000000-0000-0000-0000-00000000000b', 16, '{"kind":"custom","name":"Ноль","x":10,"y":10,"hp":0,"hpMax":0}')$q$);
select pg_temp.cnt('TASK-123 (review): при hpMax 0 хиты не выше нуля', $q$select 1 where (public.adjust_token('t-zero', '{"hp":5}') ->> 'hp')::int = 0$q$, 1);
select pg_temp.rows('TASK-123 (review): токен с нулём удалён владельцем', $q$delete from public.tokens where id = 't-zero'$q$, 1);
-- Частичная правка
select pg_temp.ok('частичная правка: только место совы', $q$select public.patch_token('t-owl', '{"x":210}')$q$);
select pg_temp.cnt('остальные поля совы на месте', $q$select 1 from public.tokens where id = 't-owl' and (data ->> 'x')::int = 210 and (data ->> 'hp')::int = 1 and data ->> 'name' = 'Сова Аси'$q$, 1);
select pg_temp.ok('частичная правка снимает поле', $q$select public.patch_token('t-owl', '{}', array['layer'])$q$);
select pg_temp.cnt('слой совы снят', $q$select 1 from public.tokens where id = 't-owl' and not data ? 'layer'$q$, 1);
select pg_temp.err('правка исчезнувшего токена — «Токен удалён мастером»', $q$select public.patch_token('t-nope', '{"x":1}')$q$);
select pg_temp.err('частичная правка хитов гоблина — отказ', $q$select public.patch_token('t-gob', '{"hp":0}')$q$);
reset role;
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select pg_temp.rows('TASK-123 (review): мастер закрепляет сову игрока', $q$update public.tokens set data = data || '{"locked":true}' where id = 't-owl'$q$, 1);
reset role;
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select pg_temp.err('TASK-123 (review): закреплённую свою сову владелец не двигает', $q$select public.move_tokens('s-1', '[{"id":"t-owl","x":99}]')$q$);
select pg_temp.err('TASK-123 (review): и частичной правкой тоже', $q$select public.patch_token('t-owl', '{"x":99}')$q$);
select pg_temp.err('TASK-123 (review): и не поворачивает', $q$select public.patch_token('t-owl', '{"rot":90}')$q$);
select pg_temp.err('TASK-123 (review): и замок сам не снимает', $q$select public.patch_token('t-owl', '{}', array['locked'])$q$);
reset role;
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select pg_temp.rows('TASK-123 (review): мастер снимает замок', $q$update public.tokens set data = data - 'locked' where id = 't-owl'$q$, 1);
reset role;
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
-- Езда
select pg_temp.err('сесть на не ездовое — «Это не ездовое»', $q$select public.patch_token('t-p', '{"riding":"t-owl","x":210,"y":200}')$q$);
select pg_temp.ok('Лира садится на коня', $q$select public.patch_token('t-p', '{"riding":"t-horse","x":300,"y":200}')$q$);
select pg_temp.err('чужого героя на своего коня не посадить', $q$select public.patch_token('t-q2', '{"riding":"t-horse","x":300,"y":200}')$q$);
select pg_temp.err('на самого себя не сесть', $q$select public.patch_token('t-horse', '{"riding":"t-horse"}')$q$);
select pg_temp.rows('сова тоже ездовое', $q$update public.tokens set data = data || '{"mount":true}' where id = 't-owl'$q$, 1);
select pg_temp.err('конь со всадником не садится на сову: верхом цепочкой нельзя', $q$select public.patch_token('t-horse', '{"riding":"t-owl"}')$q$);
select pg_temp.ok('сова больше не ездовое', $q$select public.patch_token('t-owl', '{}', array['mount'])$q$);
reset role;
select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select pg_temp.ok('Торин садится на чужого коня (любое видимое ездовое)', $q$select public.patch_token('t-q2', '{"riding":"t-horse","x":300,"y":200}')$q$);
select pg_temp.err('чужого коня второй игрок не двигает', $q$select public.move_tokens('s-1', '[{"id":"t-horse","x":350,"y":200}]')$q$);
select pg_temp.err('чужие статы — «Статы меняет владелец или мастер»', $q$update public.tokens set data = data || '{"hp":0}' where id = 't-owl'$q$);
select pg_temp.err('чужой токен не удалить — «Удаляет мастер»', $q$delete from public.tokens where id = 't-owl'$q$);
select pg_temp.err('чужого всадника не ссадить', $q$select public.patch_token('t-p', '{}', array['riding'])$q$);
reset role;
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select pg_temp.cnt('конь везёт обоих всадников одной транзакцией', $q$select 1 where public.move_tokens('s-1', '[{"id":"t-p","x":400,"y":250,"movedAt":9},{"id":"t-q2","x":400,"y":250,"movedAt":9},{"id":"t-horse","x":400,"y":250,"movedAt":9}]') = 3$q$, 1);
select pg_temp.cnt('все трое на новом месте', $q$select 1 from public.tokens where id in ('t-p', 't-q2', 't-horse') and (data ->> 'x')::int = 400 and (data ->> 'y')::int = 250$q$, 3);
select pg_temp.err('чужого всадника мимо коня не увезти', $q$select public.move_tokens('s-1', '[{"id":"t-horse","x":450,"y":250},{"id":"t-q2","x":460,"y":250}]')$q$);
select pg_temp.cnt('отказ по одному — не двинулся никто', $q$select 1 from public.tokens where id = 't-horse' and (data ->> 'x')::int = 400$q$, 1);
select pg_temp.err('перемещение не меняет хиты', $q$select public.move_tokens('s-1', '[{"id":"t-horse","x":410,"hp":1}]')$q$);
select pg_temp.ok('владелец коня ссаживает чужого всадника', $q$select public.patch_token('t-q2', '{}', array['riding'])$q$);
select pg_temp.err('без посадки чужой герой с конём не едет', $q$select public.move_tokens('s-1', '[{"id":"t-horse","x":420,"y":250},{"id":"t-q2","x":420,"y":250}]')$q$);
reset role;
-- Бой и спасброски своих призывов
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select pg_temp.ok('мастер добавляет коня в бой', $q$update public.combats set data = jsonb_set(data, '{entries}', (data -> 'entries') || '[{"tokenId":"t-horse","init":null}]') where campaign_id = 'c-rls'$q$);
reset role;
select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select pg_temp.err('инициатива чужого призыва — отказ', $q$update public.combats set data = jsonb_set(data, '{entries,4,init}', '7') where campaign_id = 'c-rls'$q$);
select pg_temp.err('спасбросок за чужой призыв — отказ', $q$update public.save_requests set data = jsonb_set(data, '{results,t-horse}', '{"total":2}') where id = 'sv-1'$q$);
reset role;
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select pg_temp.err('свой призыв в бой игрок не добавляет', $q$update public.combats set data = jsonb_set(data, '{entries}', (data -> 'entries') || '[{"tokenId":"t-wolf","init":null}]') where campaign_id = 'c-rls'$q$);
select pg_temp.rows('инициатива своего призыва', $q$update public.combats set data = jsonb_set(data, '{entries,4,init}', '11') where campaign_id = 'c-rls'$q$, 1);
select pg_temp.rows('спасбросок своего призыва', $q$update public.save_requests set data = jsonb_set(data, '{results,t-horse}', '{"total":12}') where id = 'sv-1'$q$, 1);
reset role;
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select pg_temp.ok('ход коня', $q$update public.combats set data = data || '{"turn":4,"current":"t-horse"}' where campaign_id = 'c-rls'$q$);
reset role;
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select pg_temp.rows('владелец заканчивает ход своего призыва', $q$update public.combats set data = data || '{"ended":"t-horse"}' where campaign_id = 'c-rls'$q$, 1);
reset role;
-- Скрытие, удаление и связи
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select pg_temp.rows('мастер скрывает сову', $q$update public.tokens set hidden = true where id = 't-owl'$q$, 1);
reset role;
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select pg_temp.cnt('скрытую свою сову владелец не видит (В1)', $q$select 1 from public.tokens where id = 't-owl'$q$, 0);
select pg_temp.err('и не правит', $q$select public.patch_token('t-owl', '{"x":1}')$q$);
select pg_temp.err('TASK-123 (review): id своих токенов снаружи не запросить — в том числе скрытой совы (И7)', $q$select public.owned_token_ids('c-rls')$q$);
select pg_temp.err('TASK-123 (review): и id героев тоже', $q$select public.hero_token_ids('c-rls')$q$);
reset role;
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select pg_temp.rows('мастер показывает сову', $q$update public.tokens set hidden = false where id = 't-owl'$q$, 1);
select pg_temp.rows('мастер убирает второго героя со сцены', $q$delete from public.tokens where id = 't-s'$q$, 1);
select pg_temp.cnt('призванный волк остаётся без ссылки на призывателя', $q$select 1 from public.tokens where id = 't-wolf' and not data ? 'summonedBy'$q$, 1);
reset role;
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select pg_temp.err('своего героя игрок не удаляет — «Удаляет мастер»', $q$delete from public.tokens where id = 't-p'$q$);
select pg_temp.rows('свой токен игрок удаляет', $q$delete from public.tokens where id = 't-owl'$q$, 1);
reset role;
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select pg_temp.rows('мастер удаляет коня под Лирой', $q$delete from public.tokens where id = 't-horse'$q$, 1);
select pg_temp.cnt('Лира спешилась и осталась на месте', $q$select 1 from public.tokens where id = 't-p' and not data ? 'riding' and (data ->> 'x')::int = 400$q$, 1);
reset role;
-- Картинки своих токенов
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select pg_temp.ok('игрок загружает картинку своего токена', $q$insert into storage.objects (bucket_id, name) values ('tokens', 'c-rls/00000000-0000-0000-0000-00000000000b/owl.webp')$q$);
select pg_temp.err('в чужую папку — нельзя', $q$insert into storage.objects (bucket_id, name) values ('tokens', 'c-rls/00000000-0000-0000-0000-00000000000c/x.webp')$q$);
reset role;
select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select pg_temp.cnt('участник видит картинку чужого токена', $q$select 1 from storage.objects where bucket_id = 'tokens' and name like 'c-rls/%'$q$, 1);
select pg_temp.rows('но не удаляет её', $q$delete from storage.objects where bucket_id = 'tokens'$q$, 0);
reset role;
select pg_temp.login('00000000-0000-0000-0000-00000000000d');
select pg_temp.cnt('посторонний картинок токенов не видит', $q$select 1 from storage.objects where bucket_id = 'tokens'$q$, 0);
reset role;

-- ——— Исключение ———
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select pg_temp.rows('мастер исключает игрока', $q$delete from public.campaign_members where campaign_id = 'c-rls' and user_id = '00000000-0000-0000-0000-00000000000b'$q$, 1);
select pg_temp.rows('мастера исключить нельзя', $q$delete from public.campaign_members where campaign_id = 'c-rls' and role = 'master'$q$, 0);
reset role;
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select pg_temp.cnt('исключённый не видит сцены', $q$select 1 from public.scenes$q$, 0);
select pg_temp.rows('исключённый не двигает своего героя', $q$update public.tokens set data = data || '{"x":99}' where id = 't-p'$q$, 0);
select pg_temp.rows('TASK-123: и свой призыв тоже', $q$update public.tokens set data = data || '{"x":99}' where id = 't-wolf'$q$, 0);
reset role;
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select pg_temp.cnt('TASK-123: призыв исключённого остаётся на сцене (В2)', $q$select 1 from public.tokens where id = 't-wolf'$q$, 1);
select pg_temp.rows('TASK-123: мастер убирает его вручную', $q$delete from public.tokens where id = 't-wolf'$q$, 1);
reset role;

-- ——— TASK-123: кампания удаляется целиком, вместе с токенами игроков ———
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select pg_temp.rows('TASK-123: мастер удаляет кампанию с токенами игроков', $q$delete from public.campaigns where id = 'c-rls'$q$, 1);
reset role;

select test, ok, info from _r order by at;
