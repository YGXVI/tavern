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

-- ——— TASK-125: личная библиотека (только этот блок принадлежит Codex библиотеки) ———
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select pg_temp.ok('library: мастер создаёт личный шаблон', $q$insert into public.creatures(id,owner_id,data) values('lib-a','00000000-0000-0000-0000-00000000000a','{"name":"Страж A","source":"manual","hp":10}')$q$);
select pg_temp.ok('library: мастер создаёт закрытую копию врага', $q$insert into public.campaign_creatures(campaign_id,id,data,source_id) values('c-rls','enemy','{"name":"Враг","source":"manual","hp":10}','lib-a')$q$);
select pg_temp.ok('library: мастер загружает личную картинку', $q$insert into storage.objects(bucket_id,name) values('library','00000000-0000-0000-0000-00000000000a/stat.webp')$q$);
reset role; -- bucket configuration is an administrator assertion, not permission to list buckets via API
select pg_temp.cnt('library: bucket приватный, MIME/размер ограничены', $q$select 1 from storage.buckets where id='library' and not public and file_size_limit=5242880 and allowed_mime_types=array['image/png','image/jpeg','image/webp']$q$,1);
reset role;
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select pg_temp.ok('library: игрок создаёт личный шаблон', $q$insert into public.creatures(id,owner_id,data) values('lib-b','00000000-0000-0000-0000-00000000000b','{"name":"Призыв B","source":"manual"}')$q$);
select pg_temp.cnt('library: игрок не читает личный шаблон мастера', $q$select 1 from public.creatures where id='lib-a'$q$,0);
select pg_temp.rows('library: игрок не правит чужой шаблон', $q$update public.creatures set data=data||'{"hp":1}' where id='lib-a'$q$,0);
select pg_temp.rows('library: игрок не удаляет чужой шаблон', $q$delete from public.creatures where id='lib-a'$q$,0);
select pg_temp.err('library: нельзя создать от чужого владельца', $q$insert into public.creatures(id,owner_id,data) values('lib-spoof','00000000-0000-0000-0000-00000000000a','{"name":"X","source":"manual"}')$q$);
select pg_temp.err('library: нельзя сменить владельца', $q$update public.creatures set owner_id='00000000-0000-0000-0000-00000000000a' where id='lib-b'$q$);
select pg_temp.err('library: нельзя сменить ID', $q$update public.creatures set id='lib-replaced' where id='lib-b'$q$);
select pg_temp.err('library: обязательное имя проверяется на сервере', $q$insert into public.creatures(id,owner_id,data) values('lib-empty','00000000-0000-0000-0000-00000000000b','{"source":"manual"}')$q$);
select pg_temp.err('library: image требует картинку статблока', $q$insert into public.creatures(id,owner_id,data) values('lib-image-empty','00000000-0000-0000-0000-00000000000b','{"name":"Image","source":"image"}')$q$);
select pg_temp.err('library: ID/владелец не маскируются внутри data', $q$update public.creatures set data=data||'{"ownerId":"fake"}' where id='lib-b'$q$);
select pg_temp.err('library: больше 64К UTF-8 не проходит', $q$insert into public.creatures(id,owner_id,data) values('lib-big','00000000-0000-0000-0000-00000000000b',jsonb_build_object('name','Большой','source','manual','notes',repeat('я',32768)))$q$);
select pg_temp.ok('library: ровно 65536 байт принимается', $q$insert into public.creatures(id,owner_id,data) select 'lib-boundary','00000000-0000-0000-0000-00000000000b',jsonb_set(d,'{notes}',to_jsonb(repeat('a',65536-octet_length(convert_to(d::text,'UTF8'))))) from (select '{"name":"Edge","source":"manual","notes":""}'::jsonb d) x$q$);
select pg_temp.ok('library: игрок ставит свою копию призыва', $q$insert into public.campaign_creatures(campaign_id,id,owner_id,data,source_id) values('c-rls','summon','00000000-0000-0000-0000-00000000000b','{"name":"Призыв B","source":"manual","hp":9}','lib-b')$q$);
select pg_temp.cnt('library: игрок читает только свой призыв', $q$select 1 from public.campaign_creatures where campaign_id='c-rls'$q$,1);
select pg_temp.err('library: игрок не создаёт чужую копию', $q$insert into public.campaign_creatures(campaign_id,id,owner_id,data) values('c-rls','spoof','00000000-0000-0000-0000-00000000000a','{"name":"X","source":"manual"}')$q$);
select pg_temp.rows('library: игрок не меняет снимок', $q$update public.campaign_creatures set data=data||'{"hp":2}' where id='summon'$q$,0);
select pg_temp.rows('library: игрок не удаляет снимок', $q$delete from public.campaign_creatures where id='summon'$q$,0);
select pg_temp.ok('library: правка личного шаблона', $q$update public.creatures set data=data||'{"hp":1}' where id='lib-b'$q$);
select pg_temp.cnt('library: правка шаблона не меняет копию', $q$select 1 from public.campaign_creatures where id='summon' and data->>'hp'='9'$q$,1);
select pg_temp.rows('library: удаление личного шаблона', $q$delete from public.creatures where id='lib-b'$q$,1);
select pg_temp.cnt('library: удаление шаблона не удаляет копию', $q$select 1 from public.campaign_creatures where id='summon'$q$,1);
select pg_temp.err('library: нельзя читать квоту напрямую', $q$select * from public.creature_library_quota$q$);
select pg_temp.cnt('library: чужую картинку не видно', $q$select 1 from storage.objects where bucket_id='library'$q$,0);
select pg_temp.err('library: нельзя загрузить в чужую папку', $q$insert into storage.objects(bucket_id,name) values('library','00000000-0000-0000-0000-00000000000a/forged.png')$q$);
select pg_temp.ok('library: своя картинка', $q$insert into storage.objects(bucket_id,name) values('library','00000000-0000-0000-0000-00000000000b/own.png')$q$);
select pg_temp.err('library: нельзя перенести файл в чужую папку', $q$update storage.objects set name='00000000-0000-0000-0000-00000000000a/stolen.png' where bucket_id='library' and name='00000000-0000-0000-0000-00000000000b/own.png'$q$);
select pg_temp.rows('library: нельзя удалить чужую картинку', $q$delete from storage.objects where bucket_id='library' and name='00000000-0000-0000-0000-00000000000a/stat.webp'$q$,0);
reset role;
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select pg_temp.cnt('library: мастер не читает личную библиотеку игрока', $q$select 1 from public.creatures where owner_id='00000000-0000-0000-0000-00000000000b'$q$,0);
select pg_temp.cnt('library: мастер видит обе копии кампании', $q$select 1 from public.campaign_creatures where campaign_id='c-rls'$q$,2);
select pg_temp.rows('library: мастер может править копию', $q$update public.campaign_creatures set data=data||'{"hp":8}' where id='summon'$q$,1);
-- Regression PR150: an existing private ID must not be a cross-owner uniqueness oracle.
select pg_temp.ok('library: A создаёт общий логический ID', $q$insert into public.creatures(id,owner_id,data) values('shared-id','00000000-0000-0000-0000-00000000000a','{"name":"Только A","source":"manual"}')$q$);
reset role;
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select pg_temp.cnt('library: B не видит существующий shared-id A', $q$select 1 from public.creatures where id='shared-id'$q$,0);
select pg_temp.ok('library: B создаёт тот же ID без конфликта с A', $q$insert into public.creatures(id,owner_id,data) values('shared-id','00000000-0000-0000-0000-00000000000b','{"name":"Только B","source":"manual"}')$q$);
select pg_temp.ok('library: upsert B меняет только свою строку общего ID', $q$insert into public.creatures(id,owner_id,data) values('shared-id','00000000-0000-0000-0000-00000000000b','{"name":"Обновлён B","source":"manual"}') on conflict(owner_id,id) do update set data=excluded.data$q$);
select pg_temp.cnt('library: B читает только своё содержимое shared-id', $q$select 1 from public.creatures where id='shared-id' and data->>'name'='Обновлён B'$q$,1);
select pg_temp.rows('library: B удаляет только свою строку shared-id', $q$delete from public.creatures where id='shared-id'$q$,1);
reset role;
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select pg_temp.cnt('library: shared-id A пережил чужие upsert и delete', $q$select 1 from public.creatures where id='shared-id' and data->>'name'='Только A'$q$,1);
select pg_temp.rows('library: A удаляет свою строку shared-id', $q$delete from public.creatures where id='shared-id'$q$,1);
select pg_temp.ok('library: шаблон ссылается на загруженный файл', $q$update public.creatures set data=data||'{"img":"library:00000000-0000-0000-0000-00000000000a/stat.webp"}' where id='lib-a'$q$);
select pg_temp.err('library: связанный файл не удаляется', $q$delete from storage.objects where bucket_id='library' and name='00000000-0000-0000-0000-00000000000a/stat.webp'$q$);
select pg_temp.err('library: отсутствующий личный файл не сохраняется в шаблон', $q$update public.creatures set data=data||'{"statblockImage":"library:00000000-0000-0000-0000-00000000000a/missing.png"}' where id='lib-a'$q$);
select pg_temp.err('library: чужой файл не сохраняется в шаблон', $q$update public.creatures set data=data||'{"img":"library:00000000-0000-0000-0000-00000000000b/own.png"}' where id='lib-a'$q$);
select pg_temp.cnt('library: связанный файл не в списке сирот', $q$select * from public.library_unused_images()$q$,0);
select pg_temp.err('library: внутренний счётчик файлов недоступен', $q$select * from public.library_storage_usage$q$);
select pg_temp.err('library: внутреннюю блокировку нельзя вызвать напрямую', $q$select public.library_lock_owner('00000000-0000-0000-0000-00000000000a')$q$);
reset role;
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select pg_temp.ok('library: несколько шаблонов используют один статблок', $q$insert into public.creatures(id,owner_id,data) select 'image-'||g,'00000000-0000-0000-0000-00000000000b','{"name":"Картинка","source":"image","statblockImage":"library:00000000-0000-0000-0000-00000000000b/own.png"}' from generate_series(1,2) g$q$);
select pg_temp.err('library: снимок кампании не хранит приватную ссылку library', $q$insert into public.campaign_creatures(campaign_id,id,owner_id,data) values('c-rls','private-image','00000000-0000-0000-0000-00000000000b','{"name":"Копия","source":"image","statblockImage":"library:00000000-0000-0000-0000-00000000000b/own.png"}')$q$);
select pg_temp.rows('library: удаление первого шаблона', $q$delete from public.creatures where id='image-1'$q$,1);
select pg_temp.err('library: второй шаблон продолжает защищать файл', $q$delete from storage.objects where bucket_id='library' and name='00000000-0000-0000-0000-00000000000b/own.png'$q$);
select pg_temp.rows('library: удаление последнего шаблона', $q$delete from public.creatures where id='image-2'$q$,1);
select pg_temp.cnt('library: список сирот содержит только свой неиспользуемый файл', $q$select * from public.library_unused_images() where path='00000000-0000-0000-0000-00000000000b/own.png'$q$,1);
select pg_temp.cnt('library: список сирот не содержит чужих файлов', $q$select * from public.library_unused_images() where path not like '00000000-0000-0000-0000-00000000000b/%'$q$,0);
select pg_temp.rows('library: удаление неиспользуемого файла', $q$delete from storage.objects where bucket_id='library' and name='00000000-0000-0000-0000-00000000000b/own.png'$q$,1);
select pg_temp.cnt('library: удаление освобождает файловую квоту', $q$select * from public.library_image_usage() where files=0 and bytes=0$q$,1);
reset role;
select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select pg_temp.cnt('library: ожидающий не читает копии', $q$select 1 from public.campaign_creatures$q$,0);
select pg_temp.err('library: ожидающий не создаёт копию', $q$insert into public.campaign_creatures(campaign_id,id,owner_id,data) values('c-rls','pending','00000000-0000-0000-0000-00000000000c','{"name":"X","source":"manual"}')$q$);
reset role;
select pg_temp.login('00000000-0000-0000-0000-00000000000d');
select pg_temp.ok('library: 500 записей своего владельца', $q$insert into public.creatures(id,owner_id,data) select 'quota-'||g,'00000000-0000-0000-0000-00000000000d','{"name":"Квота","source":"manual"}' from generate_series(1,500) g$q$);
select pg_temp.err('library: запись 501 запрещена', $q$insert into public.creatures(id,owner_id,data) values('quota-501','00000000-0000-0000-0000-00000000000d','{"name":"Лишняя","source":"manual"}')$q$);
select pg_temp.ok('library: upsert не расходует квоту повторно', $q$insert into public.creatures(id,owner_id,data) values('quota-1','00000000-0000-0000-0000-00000000000d','{"name":"Обновлена","source":"manual"}') on conflict(owner_id,id) do update set data=excluded.data$q$);
select pg_temp.rows('library: удаление освобождает одно место', $q$delete from public.creatures where id='quota-1'$q$,1);
select pg_temp.ok('library: новое место можно занять', $q$insert into public.creatures(id,owner_id,data) values('quota-new','00000000-0000-0000-0000-00000000000d','{"name":"Новая","source":"manual"}')$q$);
select pg_temp.cnt('library: ровно 500 после отказа и upsert', $q$select 1 from public.creatures$q$,500);
select pg_temp.cnt('library: посторонний не видит копии кампании', $q$select 1 from public.campaign_creatures$q$,0);
select pg_temp.ok('library: откатываемый Storage probe не считает multipart overhead размером файла', $q$do $probe$ begin begin
  insert into storage.objects(bucket_id,name,metadata) values('library','00000000-0000-0000-0000-00000000000d/probe.png','{"contentLength":5243904,"mimetype":"image/png"}');
  raise exception using errcode='P0002';
exception when sqlstate 'P0002' then null; end; end $probe$$q$);
select pg_temp.cnt('library: откат Storage probe не расходует место', $q$select * from public.library_image_usage() where files=0 and bytes=0$q$,1);
select pg_temp.ok('library: 200 неиспользуемых файлов учитываются', $q$insert into storage.objects(bucket_id,name,metadata) select 'library','00000000-0000-0000-0000-00000000000d/file-'||g||'.png','{"size":1}' from generate_series(1,200) g$q$);
select pg_temp.cnt('library: точное число и объём через личный RPC', $q$select * from public.library_image_usage() where files=200 and bytes=200$q$,1);
select pg_temp.err('library: файл 201 запрещён', $q$insert into storage.objects(bucket_id,name,metadata) values('library','00000000-0000-0000-0000-00000000000d/overflow.png','{"size":1}')$q$);
select pg_temp.ok('library: upsert файла не расходует второе место', $q$insert into storage.objects(bucket_id,name,metadata) values('library','00000000-0000-0000-0000-00000000000d/file-1.png','{"size":2}') on conflict(bucket_id,name) do update set metadata=excluded.metadata$q$);
select pg_temp.cnt('library: upsert изменил только байты', $q$select * from public.library_image_usage() where files=200 and bytes=201$q$,1);
select pg_temp.err('library: нельзя переместить файл даже в своей папке', $q$update storage.objects set name='00000000-0000-0000-0000-00000000000d/renamed.png' where bucket_id='library' and name='00000000-0000-0000-0000-00000000000d/file-1.png'$q$);
select pg_temp.rows('library: очищаются только свои 200 сирот', $q$delete from storage.objects where bucket_id='library'$q$,200);
select pg_temp.ok('library: ровно 100 МиБ принимается', $q$insert into storage.objects(bucket_id,name,metadata) select 'library','00000000-0000-0000-0000-00000000000d/big-'||g||'.png','{"size":5242880}' from generate_series(1,20) g$q$);
select pg_temp.cnt('library: квота учитывает 100 МиБ без шаблонов', $q$select * from public.library_image_usage() where files=20 and bytes=104857600$q$,1);
select pg_temp.err('library: один байт сверх 100 МиБ запрещён', $q$insert into storage.objects(bucket_id,name,metadata) values('library','00000000-0000-0000-0000-00000000000d/extra.png','{"size":1}')$q$);
select pg_temp.err('library: один файл больше 5 МиБ запрещён', $q$insert into storage.objects(bucket_id,name,metadata) values('library','00000000-0000-0000-0000-00000000000d/huge.png','{"size":5242881}')$q$);
select pg_temp.ok('library: уменьшение файла освобождает байты', $q$update storage.objects set metadata='{"size":1}' where bucket_id='library' and name='00000000-0000-0000-0000-00000000000d/big-1.png'$q$);
select pg_temp.ok('library: освобождённые байты можно занять', $q$insert into storage.objects(bucket_id,name,metadata) values('library','00000000-0000-0000-0000-00000000000d/small.png','{"size":1024}')$q$);
select pg_temp.cnt('library: неуспешные загрузки не портят счётчик', $q$select * from public.library_image_usage() where files=21 and bytes=99615745$q$,1);
reset role;

-- ——— Исключение ———
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select pg_temp.rows('мастер исключает игрока', $q$delete from public.campaign_members where campaign_id = 'c-rls' and user_id = '00000000-0000-0000-0000-00000000000b'$q$, 1);
select pg_temp.rows('мастера исключить нельзя', $q$delete from public.campaign_members where campaign_id = 'c-rls' and role = 'master'$q$, 0);
reset role;
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select pg_temp.cnt('исключённый не видит сцены', $q$select 1 from public.scenes$q$, 0);
select pg_temp.rows('исключённый не двигает своего героя', $q$update public.tokens set data = data || '{"x":99}' where id = 't-p'$q$, 0);
-- TASK-125: отдельная проверка отзыва доступа к снимкам.
select pg_temp.cnt('library: исключённый не читает свой снимок кампании', $q$select 1 from public.campaign_creatures where id='summon'$q$,0);
reset role;

select test, ok, info from _r order by at;
