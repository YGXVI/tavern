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
select pg_temp.ok('мастер добавляет героев', $q$insert into public.characters (id, campaign_id, data) values ('ch-p', 'c-rls', '{"name":"Лира","hp":10}'), ('ch-q', 'c-rls', '{"name":"Торин","hp":12}')$q$);
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
select pg_temp.err('второго героя не взять', $q$select public.claim_character('c-rls', 'ch-q')$q$);
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
select pg_temp.rows('удалить токен игрок не может', $q$delete from public.tokens where id = 't-gob'$q$, 0);
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

-- ——— TASK-004: команды листа, роли, версия, повтор, архив ———
create function pg_temp.code(name text, q text, expected text) returns void language plpgsql as $$
begin
  begin execute q; insert into _r(test,ok,info) values(name,false,'ошибки не было');
  exception when others then insert into _r(test,ok,info) values(name,sqlstate = expected,sqlstate || ': ' || left(sqlerrm,140)); end;
end $$;
grant execute on function pg_temp.code(text,text,text) to authenticated,anon;
create temp table _sheet_replies(name text primary key, expected bigint, reply jsonb);
grant select,insert,update on _sheet_replies to authenticated;
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select pg_temp.ok('лист: мастер готовит ресурсы', $q$update public.characters set data = data || '{"hp":10,"hpMax":20,"tempHp":5,"level":5,"profile":"pc","conditions":[],"slots":{"1":{"max":4,"used":0}},"resources":[{"id":"rage","max":3,"spent":0}],"hitDicePools":[{"id":"wizard","die":6,"total":5,"spent":2}],"customLegacy":{"keep":true}}' where id = 'ch-p'$q$);
reset role;
select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select pg_temp.code('лист: ожидающий не читает RPC', $q$select public.read_character_sheet('c-rls','ch-p')$q$,'42501');
reset role;
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select pg_temp.ok('лист: место для управляющего', $q$update public.campaigns set data = jsonb_set(data,'{seats}','3') where id = 'c-rls'$q$);
select pg_temp.ok('лист: управляющий становится участником', $q$update public.campaign_members set status = 'active' where campaign_id = 'c-rls' and user_id = '00000000-0000-0000-0000-00000000000c'$q$);
select pg_temp.ok('лист: создаётся Sidekick', $q$insert into public.characters(id,campaign_id,owner_id,data) values('ch-sk','c-rls','00000000-0000-0000-0000-00000000000b','{"name":"Напарник","profile":"sidekick","level":4,"hp":20,"hpMax":25,"tempHp":0}')$q$);
select pg_temp.ok('лист: мастер подтверждает развитие Sidekick', $q$select public.character_command('c-rls','ch-sk',sheet_version,'30000000-0000-0000-0000-000000000001','growth','{"patch":{"level":5,"hpMax":31}}') from public.characters where id = 'ch-sk'$q$);
select pg_temp.cnt('лист: развитие не исцеляет', $q$select 1 from public.characters where id = 'ch-sk' and data -> 'level' = '5' and data -> 'hpMax' = '31' and data -> 'hp' = '20'$q$,1);
reset role;
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
insert into _sheet_replies(name,expected) select 'consume',sheet_version from public.characters where id = 'ch-p';
select pg_temp.ok('лист: расход через ожидаемую версию', $q$update _sheet_replies set reply = public.character_command('c-rls','ch-p',expected,'10000000-0000-0000-0000-000000000001','adjust','{"hp":-8,"counters":[{"field":"slots","id":"1","delta":1}]}') where name = 'consume'$q$);
select pg_temp.cnt('лист: временные хиты поглощают урон, ячейка расходуется', $q$select 1 from public.characters where id = 'ch-p' and data -> 'hp' = '7' and data -> 'tempHp' = '0' and data #> '{slots,1,used}' = '1' and data #> '{customLegacy,keep}' = 'true' and sheet_managed$q$,1);
select pg_temp.cnt('лист: повтор не расходует второй раз', $q$select 1 from _sheet_replies where name = 'consume' and (public.character_command('c-rls','ch-p',expected,'10000000-0000-0000-0000-000000000001','adjust','{"hp":-8,"counters":[{"field":"slots","id":"1","delta":1}]}') ->> 'replayed')::boolean$q$,1);
select pg_temp.cnt('лист: один повтор — одно событие', $q$select 1 from public.character_history where operation_id = '10000000-0000-0000-0000-000000000001'$q$,1);
select pg_temp.ok('лист: владелец задаёт характеристики с legacy-полем', $q$select public.character_command('c-rls','ch-p',sheet_version,'10000000-0000-0000-0000-000000000019','patch','{"stats":{"str":12,"dex":14,"customLegacy":{"keep":true}}}') from public.characters where id = 'ch-p'$q$);
select pg_temp.ok('лист: частичная правка вложенного поля', $q$select public.character_command('c-rls','ch-p',sheet_version,'10000000-0000-0000-0000-000000000020','patch','{"stats":{"str":16}}') from public.characters where id = 'ch-p'$q$);
select pg_temp.cnt('лист: частичная правка не стирает соседей и неизвестное', $q$select 1 from public.characters where id = 'ch-p' and data #> '{stats,str}' = '16' and data #> '{stats,dex}' = '14' and data #> '{stats,customLegacy,keep}' = 'true'$q$,1);
select pg_temp.ok('лист: дробная скорость не превращается в ноль', $q$select public.character_command('c-rls','ch-p',sheet_version,'10000000-0000-0000-0000-000000000021','patch','{"speed":15.5}') from public.characters where id = 'ch-p'$q$);
select pg_temp.code('лист: ID нельзя использовать с другим содержимым', $q$select public.character_command('c-rls','ch-p',expected,'10000000-0000-0000-0000-000000000001','adjust','{"hp":-7}') from _sheet_replies where name = 'consume'$q$,'22023');
select pg_temp.code('лист: устаревшая версия — конфликт', $q$select public.character_command('c-rls','ch-p',expected,'10000000-0000-0000-0000-000000000002','adjust','{"hp":-1}') from _sheet_replies where name = 'consume'$q$,'40001');
select pg_temp.code('лист: прямой UPDATE не обходит версии', $q$update public.characters set data = data || '{"hp":1}' where id = 'ch-p'$q$,'42501');
select pg_temp.code('лист: подмена версии запрещена', $q$update public.characters set sheet_version = 0 where id = 'ch-p'$q$,'42501');
select pg_temp.code('лист: ownerId не поле patch', $q$select public.character_command('c-rls','ch-p',sheet_version,'10000000-0000-0000-0000-000000000003','patch','{"ownerId":"другой"}') from public.characters where id = 'ch-p'$q$,'22023');
select pg_temp.code('лист: булево число недопустимо', $q$select public.character_command('c-rls','ch-p',sheet_version,'10000000-0000-0000-0000-000000000004','adjust','{"hp":true}') from public.characters where id = 'ch-p'$q$,'22023');
select pg_temp.code('лист: отрицательный остаток откатывает весь расход', $q$select public.character_command('c-rls','ch-p',sheet_version,'10000000-0000-0000-0000-000000000005','adjust','{"hp":-2,"counters":[{"field":"resources","id":"rage","delta":4}]}') from public.characters where id = 'ch-p'$q$,'22023');
select pg_temp.cnt('лист: после отказа HP и заряд прежние', $q$select 1 from public.characters where id = 'ch-p' and data -> 'hp' = '7' and data #> '{resources,0,spent}' = '0'$q$,1);
select pg_temp.code('лист: владелец не меняет уровень Sidekick', $q$select public.character_command('c-rls','ch-sk',sheet_version,'10000000-0000-0000-0000-000000000006','patch','{"level":6}') from public.characters where id = 'ch-sk'$q$,'42501');
select pg_temp.code('лист: вложенный уровень Sidekick также защищён', $q$select public.character_command('c-rls','ch-sk',sheet_version,'10000000-0000-0000-0000-000000000007','patch','{"sidekick":{"level":6}}') from public.characters where id = 'ch-sk'$q$,'42501');
select pg_temp.ok('лист: владелец назначает управляющего', $q$select public.character_command('c-rls','ch-p',sheet_version,'10000000-0000-0000-0000-000000000008','controller','{"userId":"00000000-0000-0000-0000-00000000000c","enabled":true}') from public.characters where id = 'ch-p'$q$);
select pg_temp.code('лист: постороннего управляющим не назначить', $q$select public.character_command('c-rls','ch-p',sheet_version,'10000000-0000-0000-0000-000000000009','controller','{"userId":"00000000-0000-0000-0000-00000000000d","enabled":true}') from public.characters where id = 'ch-p'$q$,'42501');
select pg_temp.code('лист: закрытая таблица повторов недоступна', $q$select * from public.character_operations$q$,'42501');
select pg_temp.code('лист: прямой INSERT управляющего запрещён', $q$insert into public.character_controllers(campaign_id,character_id,user_id) values('c-rls','ch-q','00000000-0000-0000-0000-00000000000b')$q$,'42501');
select pg_temp.code('лист: владелец не меняет чужой лист', $q$select public.character_command('c-rls','ch-q',sheet_version,'10000000-0000-0000-0000-000000000015','adjust','{"hp":-1}') from public.characters where id = 'ch-q'$q$,'42501');
reset role;
select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select pg_temp.cnt('лист: полный просмотр участником', $q$select 1 where public.read_character_sheet('c-rls','ch-p') #> '{data,customLegacy,keep}' = 'true'$q$,1);
select pg_temp.cnt('лист: полный просмотр без управления', $q$select 1 where public.read_character_sheet('c-rls','ch-sk') #> '{data,profile}' = '"sidekick"'$q$,1);
select pg_temp.cnt('лист: назначение даёт управление', $q$select 1 where public.can_control_character('c-rls','ch-p')$q$,1);
select pg_temp.ok('лист: управляющий лечит и тратит заряд', $q$select public.character_command('c-rls','ch-p',sheet_version,'20000000-0000-0000-0000-000000000001','adjust','{"hp":2,"counters":[{"field":"resources","id":"rage","delta":1}]}') from public.characters where id = 'ch-p'$q$);
select pg_temp.code('лист: управляющий не меняет сборку', $q$select public.character_command('c-rls','ch-p',sheet_version,'20000000-0000-0000-0000-000000000002','patch','{"stats":{"str":20}}') from public.characters where id = 'ch-p'$q$,'42501');
select pg_temp.code('лист: управляющий не подменяет максимум', $q$select public.character_command('c-rls','ch-p',sheet_version,'20000000-0000-0000-0000-000000000003','set_current','{"hpMax":50}') from public.characters where id = 'ch-p'$q$,'42501');
select pg_temp.code('лист: управляющий не архивирует', $q$select public.character_command('c-rls','ch-p',sheet_version,'20000000-0000-0000-0000-000000000004','archive') from public.characters where id = 'ch-p'$q$,'42501');
select pg_temp.code('лист: управляющий не делегирует права', $q$select public.character_command('c-rls','ch-p',sheet_version,'20000000-0000-0000-0000-000000000005','controller','{"userId":"00000000-0000-0000-0000-00000000000c","enabled":true}') from public.characters where id = 'ch-p'$q$,'42501');
select pg_temp.code('лист: отдых требует условий', $q$select public.character_command('c-rls','ch-p',sheet_version,'20000000-0000-0000-0000-000000000006','rest','{"kind":"short","conditionsConfirmed":false,"adjust":{}}') from public.characters where id = 'ch-p'$q$,'22023');
select pg_temp.code('лист: отдых требует вида', $q$select public.character_command('c-rls','ch-p',sheet_version,'20000000-0000-0000-0000-000000000007','rest','{"conditionsConfirmed":true,"adjust":{}}') from public.characters where id = 'ch-p'$q$,'22023');
select pg_temp.ok('лист: отдых восстанавливает ресурс одной командой', $q$select public.character_command('c-rls','ch-p',sheet_version,'20000000-0000-0000-0000-000000000008','rest','{"kind":"short","conditionsConfirmed":true,"adjust":{"counters":[{"field":"resources","id":"rage","delta":-1}]}}') from public.characters where id = 'ch-p'$q$);
select pg_temp.ok('лист: управляющий отмечает нулевые HP', $q$select public.character_command('c-rls','ch-p',sheet_version,'20000000-0000-0000-0000-000000000009','set_current','{"hp":0,"deathSaves":{"s":2,"f":1},"conditions":[{"id":"unconscious","source":"ручной"},"poisoned"]}') from public.characters where id = 'ch-p'$q$);
select pg_temp.ok('лист: лечение с нуля', $q$select public.character_command('c-rls','ch-p',sheet_version,'20000000-0000-0000-0000-000000000010','adjust','{"hp":9}') from public.characters where id = 'ch-p'$q$);
select pg_temp.cnt('лист: лечение снимает структурированное бессознательное и счётчики', $q$select 1 from public.characters where id = 'ch-p' and data -> 'conditions' = '["poisoned"]' and data -> 'deathSaves' = '{"s":0,"f":0}'$q$,1);
reset role;
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select pg_temp.ok('лист: мастер готовит текущий ход архивируемого героя', $q$update public.combats set data = data || '{"current":"t-p","turn":1,"ended":"t-p","round":2,"moved":{"t-p":10,"t-q2":5}}' where campaign_id = 'c-rls'$q$);
select pg_temp.code('лист: мастер тоже не удаляет управляемый лист мимо архива', $q$delete from public.characters where id = 'ch-sk'$q$,'42501');
reset role;
select pg_temp.cnt('лист: удаление последнего хода увеличивает раунд один раз', $q$select 1 where public.character_remove_combat_tokens('{"active":true,"round":2,"turn":1,"current":"b","ended":"b","entries":[{"tokenId":"a"},{"tokenId":"b"}],"moved":{}}',array['b']) @> '{"round":3,"current":"a","turn":0}'$q$,1);
select pg_temp.cnt('лист: удаление предыдущего не меняет текущий ход', $q$select 1 where public.character_remove_combat_tokens('{"active":true,"round":2,"turn":1,"current":"b","entries":[{"tokenId":"a"},{"tokenId":"b"}],"moved":{}}',array['a']) @> '{"round":2,"current":"b","turn":0}'$q$,1);
select pg_temp.cnt('лист: пустой бой завершается', $q$select 1 where public.character_remove_combat_tokens('{"active":true,"round":2,"turn":0,"current":"a","entries":[{"tokenId":"a"}],"moved":{}}',array['a']) @> '{"active":false,"entries":[],"turn":0}'$q$,1);
create function pg_temp.fail_archive_delete() returns trigger language plpgsql as $$
begin if current_setting('task004.fail_archive',true) = 'on' then raise exception 'Проверка полного отката' using errcode = '22023'; end if; return old; end $$;
create trigger test_archive_rollback before delete on public.tokens for each row execute function pg_temp.fail_archive_delete();
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select set_config('task004.fail_archive','on',true);
select pg_temp.code('лист: ошибка удаления откатывает весь архив', $q$select public.character_command('c-rls','ch-p',sheet_version,'10000000-0000-0000-0000-000000000017','archive') from public.characters where id = 'ch-p'$q$,'22023');
select pg_temp.cnt('лист: после отказа архива токен, ход и лист прежние', $q$select 1 from public.characters ch join public.combats cb on cb.campaign_id = ch.campaign_id where ch.id = 'ch-p' and ch.archived_at is null and cb.data ->> 'current' = 't-p' and exists(select 1 from public.tokens where id = 't-p')$q$,1);
select set_config('task004.fail_archive','off',true);
select pg_temp.ok('лист: владелец архивирует с токеном и боем', $q$select public.character_command('c-rls','ch-p',sheet_version,'10000000-0000-0000-0000-000000000010','archive') from public.characters where id = 'ch-p'$q$);
select pg_temp.cnt('лист: токен снят', $q$select 1 from public.tokens where id = 't-p'$q$,0);
select pg_temp.cnt('лист: архив сохранил HP и историю', $q$select 1 from public.characters where id = 'ch-p' and archived_at is not null and data -> 'hp' = '9'$q$,1);
select pg_temp.cnt('лист: ход перешёл к следующему без повторения ended', $q$select 1 from public.combats where campaign_id = 'c-rls' and data ->> 'current' = 't-q2' and data -> 'round' = '2' and not (data ? 'ended') and not (data -> 'moved' ? 't-p')$q$,1);
select pg_temp.code('лист: архив нельзя тратить', $q$select public.character_command('c-rls','ch-p',sheet_version,'10000000-0000-0000-0000-000000000011','adjust','{"hp":-1}') from public.characters where id = 'ch-p'$q$,'P0001');
select pg_temp.code('лист: архив нельзя поставить старым клиентом', $q$insert into public.tokens(id,campaign_id,scene_id,character_id,data) values('t-arch','c-rls','s-1','ch-p','{"kind":"hero"}')$q$,'P0001');
select pg_temp.ok('лист: владелец восстанавливает', $q$select public.character_command('c-rls','ch-p',sheet_version,'10000000-0000-0000-0000-000000000012','restore') from public.characters where id = 'ch-p'$q$);
select pg_temp.cnt('лист: восстановление не лечит и не возвращает токен', $q$select 1 from public.characters ch where id = 'ch-p' and archived_at is null and data -> 'hp' = '9' and not exists(select 1 from public.tokens t where t.character_id = ch.id)$q$,1);
select pg_temp.ok('лист: права управляющего отзываются', $q$select public.character_command('c-rls','ch-p',sheet_version,'10000000-0000-0000-0000-000000000013','controller','{"userId":"00000000-0000-0000-0000-00000000000c","enabled":false}') from public.characters where id = 'ch-p'$q$);
select set_config('rasputye.sheet_archive','c-rls',true);
select pg_temp.code('лист: поддельный GUC не открывает редактирование боя', $q$update public.combats set data = data || '{"round":99}' where campaign_id = 'c-rls'$q$,'42501');
reset role;
select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select pg_temp.code('лист: после отзыва повтор старой операции недоступен', $q$select public.character_command('c-rls','ch-p',0,'20000000-0000-0000-0000-000000000001','adjust','{"hp":2,"counters":[{"field":"resources","id":"rage","delta":1}]}')$q$,'42501');
reset role;
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select pg_temp.ok('лист: новое назначение перед выходом', $q$select public.character_command('c-rls','ch-p',sheet_version,'10000000-0000-0000-0000-000000000018','controller','{"userId":"00000000-0000-0000-0000-00000000000c","enabled":true}') from public.characters where id = 'ch-p'$q$);
reset role;
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select pg_temp.ok('лист: отстранение управляющего', $q$update public.campaign_members set status = 'pending' where campaign_id = 'c-rls' and user_id = '00000000-0000-0000-0000-00000000000c'$q$);
select pg_temp.cnt('лист: отстранение удаляет назначение', $q$select 1 from public.character_controllers where campaign_id = 'c-rls' and user_id = '00000000-0000-0000-0000-00000000000c'$q$,0);
select pg_temp.ok('лист: участник возвращается', $q$update public.campaign_members set status = 'active' where campaign_id = 'c-rls' and user_id = '00000000-0000-0000-0000-00000000000c'$q$);
reset role;
select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select pg_temp.cnt('лист: возвращение не восстанавливает старое назначение', $q$select 1 where public.can_control_character('c-rls','ch-p')$q$,0);
reset role;
select pg_temp.login('00000000-0000-0000-0000-00000000000d');
select pg_temp.code('лист: посторонний не читает RPC', $q$select public.read_character_sheet('c-rls','ch-p')$q$,'42501');
select pg_temp.cnt('лист: посторонний не читает историю', $q$select 1 from public.character_history$q$,0);
reset role;
set local role anon;
select pg_temp.code('лист: аноним не вызывает команду', $q$select public.character_command('c-rls','ch-p',0,'60000000-0000-0000-0000-000000000001','archive')$q$,'42501');
reset role;

-- Совместимость прежних элементов стола с versioned листом: одна edit-транзакция.
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select pg_temp.ok('edit: отдельный лист для передачи', $q$insert into public.characters(id,campaign_id,owner_id,data) values('ch-edit','c-rls','00000000-0000-0000-0000-00000000000b','{"name":"До","hp":10,"hpMax":20,"tempHp":3}')$q$);
reset role;
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select pg_temp.ok('edit: dirty patch и уже рассчитанный урон атомарны', $q$select public.character_command('c-rls','ch-edit',sheet_version,'70000000-0000-0000-0000-000000000001','edit','{"patch":{"name":"После"},"adjust":{"currentHp":-2,"tempHp":-3}}') from public.characters where id='ch-edit'$q$);
select pg_temp.cnt('edit: temp не поглощает урон второй раз', $q$select 1 from public.characters where id='ch-edit' and data->>'name'='После' and data->'hp'='8' and data->'tempHp'='0'$q$,1);
select pg_temp.code('edit: владелец не передаёт права себе произвольно', $q$select public.character_command('c-rls','ch-edit',sheet_version,'70000000-0000-0000-0000-000000000002','edit','{"ownerId":null}') from public.characters where id='ch-edit'$q$,'42501');
select pg_temp.code('edit: два толкования HP не принимаются', $q$select public.character_command('c-rls','ch-edit',sheet_version,'70000000-0000-0000-0000-000000000003','edit','{"adjust":{"hp":-1,"currentHp":-1}}') from public.characters where id='ch-edit'$q$,'22023');
select pg_temp.ok('edit: назначение управляющего', $q$select public.character_command('c-rls','ch-edit',sheet_version,'70000000-0000-0000-0000-000000000004','controller','{"userId":"00000000-0000-0000-0000-00000000000c","enabled":true}') from public.characters where id='ch-edit'$q$);
reset role;
select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select pg_temp.ok('edit: управляющий меняет текущие значения', $q$select public.character_command('c-rls','ch-edit',sheet_version,'70000000-0000-0000-0000-000000000005','edit','{"current":{"conditions":["poisoned"]},"adjust":{"currentHp":1}}') from public.characters where id='ch-edit'$q$);
select pg_temp.code('edit: управляющий не прячет сборку в общей команде', $q$select public.character_command('c-rls','ch-edit',sheet_version,'70000000-0000-0000-0000-000000000006','edit','{"patch":{"hpMax":100},"current":{"hp":20}}') from public.characters where id='ch-edit'$q$,'42501');
reset role;
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select pg_temp.code('edit: ошибочный выбор героя откатывает передачу целиком', $q$select public.character_command('c-rls','ch-edit',sheet_version,'70000000-0000-0000-0000-000000000007','edit','{"ownerId":"00000000-0000-0000-0000-00000000000c","membership":[{"userId":"00000000-0000-0000-0000-00000000000c","before":null,"after":null}]}') from public.characters where id='ch-edit'$q$,'22023');
select pg_temp.cnt('edit: после отказа владелец прежний', $q$select 1 from public.characters where id='ch-edit' and owner_id='00000000-0000-0000-0000-00000000000b'$q$,1);
select pg_temp.ok('edit: передача владения и выбранного героя атомарна', $q$select public.character_command('c-rls','ch-edit',sheet_version,'70000000-0000-0000-0000-000000000008','edit','{"ownerId":"00000000-0000-0000-0000-00000000000c","membership":[{"userId":"00000000-0000-0000-0000-00000000000c","before":null,"after":"ch-edit"}]}') from public.characters where id='ch-edit'$q$);
select pg_temp.cnt('edit: владение и выбор согласованы', $q$select 1 from public.characters ch join public.campaign_members m on m.campaign_id=ch.campaign_id and m.user_id=ch.owner_id where ch.id='ch-edit' and m.character_id=ch.id and ch.data->'hp'='9'$q$,1);
reset role;

select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select pg_temp.code('поля: ссылка заклинания должна существовать', $q$select public.character_command('c-rls','ch-edit',sheet_version,'80000000-0000-0000-0000-000000000001','patch','{"knownSpells":[{"id":"s","name":"Своё","sourceId":"missing"}]}') from public.characters where id='ch-edit'$q$,'22023');
select pg_temp.code('поля: круг пула не больше девяти', $q$select public.character_command('c-rls','ch-edit',sheet_version,'80000000-0000-0000-0000-000000000002','patch','{"slotPools":[{"id":"p","circle":10,"max":2,"spent":1}]}') from public.characters where id='ch-edit'$q$,'22023');
select pg_temp.code('поля: расход без структурированной записи не принимается', $q$select public.character_command('c-rls','ch-edit',sheet_version,'80000000-0000-0000-0000-000000000003','patch','{"attacks":["не объект"]}') from public.characters where id='ch-edit'$q$,'22023');
select pg_temp.code('поля: строка не множитель владения', $q$select public.character_command('c-rls','ch-edit',sheet_version,'80000000-0000-0000-0000-000000000004','patch','{"proficiencies":{"skills":{"stealth":"2"}}}') from public.characters where id='ch-edit'$q$,'22023');
select pg_temp.ok('поля: неизвестный ресурс не становится нулём', $q$select public.character_command('c-rls','ch-edit',sheet_version,'80000000-0000-0000-0000-000000000005','patch','{"resources":[{"id":"unknown","max":null,"spent":null,"recovery":"manual"}]}') from public.characters where id='ch-edit'$q$);
select pg_temp.cnt('поля: неизвестный расход сохраняется', $q$select 1 from public.characters where id='ch-edit' and data#>'{resources,0,spent}'='null'::jsonb$q$,1);
select pg_temp.ok('поля: корректный мультикласс', $q$select public.character_command('c-rls','ch-edit',sheet_version,'80000000-0000-0000-0000-000000000006','patch','{"level":5,"classes":[{"id":"f","name":"Воин","levels":1},{"id":"w","name":"Волшебник","levels":4}]}') from public.characters where id='ch-edit'$q$);
select pg_temp.code('поля: общий уровень нельзя оторвать от классов', $q$select public.character_command('c-rls','ch-edit',sheet_version,'80000000-0000-0000-0000-000000000007','patch','{"level":6}') from public.characters where id='ch-edit'$q$,'22023');
select pg_temp.ok('архив: три участника с несортированными entries', $q$insert into public.tokens(id,campaign_id,scene_id,character_id,data) values('t-order-low','c-rls','s-1','ch-q','{"name":"Низкий","kind":"hero"}'),('t-order-high','c-rls','s-1','ch-edit','{"name":"Высокий","kind":"hero"}'),('t-order-mid','c-rls','s-1','ch-sk','{"name":"Средний","kind":"hero"}')$q$);
select pg_temp.ok('архив: очередь по добавлению отличается от инициативы', $q$update public.combats set data='{"active":true,"sceneId":"s-1","round":7,"turn":0,"current":"t-order-high","ended":"t-order-high","moved":{},"entries":[{"tokenId":"t-order-low","init":5},{"tokenId":"t-order-high","init":20},{"tokenId":"t-order-mid","init":15}]}' where campaign_id='c-rls'$q$);
select pg_temp.ok('архив: текущий по инициативе снимается', $q$select public.character_command('c-rls','ch-edit',sheet_version,'70000000-0000-0000-0000-000000000009','archive') from public.characters where id='ch-edit'$q$);
select pg_temp.cnt('архив: следующим ходит средняя инициатива без лишнего раунда', $q$select 1 from public.combats where campaign_id='c-rls' and data->>'current'='t-order-mid' and data->'round'='7' and not (data ? 'ended')$q$,1);
reset role;

-- ——— Исключение ———
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select pg_temp.rows('мастер исключает игрока', $q$delete from public.campaign_members where campaign_id = 'c-rls' and user_id = '00000000-0000-0000-0000-00000000000b'$q$, 1);
select pg_temp.rows('мастера исключить нельзя', $q$delete from public.campaign_members where campaign_id = 'c-rls' and role = 'master'$q$, 0);
reset role;
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select pg_temp.cnt('исключённый не видит сцены', $q$select 1 from public.scenes$q$, 0);
select pg_temp.rows('исключённый не двигает своего героя', $q$update public.tokens set data = data || '{"x":99}' where id = 't-p'$q$, 0);
select pg_temp.code('лист: исключённый владелец не вызывает команду', $q$select public.character_command('c-rls','ch-p',0,'60000000-0000-0000-0000-000000000002','adjust','{"hp":-1}')$q$,'42501');
reset role;

select test, ok, info from _r order by at;
