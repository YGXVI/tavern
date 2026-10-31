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

select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select pg_temp.ok('статблок: восстановление для проверки полей', $q$select public.character_command('c-rls','ch-edit',sheet_version,'90000000-0000-0000-0000-000000000001','restore') from public.characters where id='ch-edit'$q$);
select pg_temp.code('статблок: save требует кто бросает', $q$select public.character_command('c-rls','ch-edit',sheet_version,'90000000-0000-0000-0000-000000000002','patch','{"statblock":{"actions":[{"name":"Взгляд","text":"Описание","save":{"ability":"wis","dc":12}}]}}') from public.characters where id='ch-edit'$q$,'22023');
select pg_temp.ok('статблок: нулевые бонусы и явный self сохраняются', $q$select public.character_command('c-rls','ch-edit',sheet_version,'90000000-0000-0000-0000-000000000003','patch','{"statblock":{"source":"manual","legendary":{"count":0,"actions":[]},"actions":[{"name":"Своя способность","text":"Это текст, HP не изменяются","attack":{"bonus":0},"save":{"ability":"wis","dc":0,"who":"self"},"damage":[{"dice":"1d6+1","type":"свой"}]}]}}') from public.characters where id='ch-edit'$q$);
select pg_temp.cnt('статблок: текст и формула не изменили HP', $q$select 1 from public.characters where id='ch-edit' and data->'hp'='9' and data#>'{statblock,actions,0,attack,bonus}'='0' and data#>'{statblock,legendary,count}'='0'$q$,1);
select pg_temp.code('статблок: неизвестный бонус не строка', $q$select public.character_command('c-rls','ch-edit',sheet_version,'90000000-0000-0000-0000-000000000004','patch','{"statblock":{"actions":[{"name":"Атака","text":"","attack":{"bonus":"неизвестно"}}]}}') from public.characters where id='ch-edit'$q$,'22023');
select pg_temp.code('статблок: изображение требует ref', $q$select public.character_command('c-rls','ch-edit',sheet_version,'90000000-0000-0000-0000-000000000005','patch','{"statblock":{"source":"image"}}') from public.characters where id='ch-edit'$q$,'22023');
select pg_temp.code('статблок: перезарядка не произвольное число', $q$select public.character_command('c-rls','ch-edit',sheet_version,'90000000-0000-0000-0000-000000000006','patch','{"statblock":{"actions":[{"name":"Дыхание","text":"","rechargeMin":5,"rechargeMax":3}]}}') from public.characters where id='ch-edit'$q$,'22023');
select pg_temp.code('статблок: размер UTF8 ограничен', $q$select public.character_command('c-rls','ch-edit',sheet_version,'90000000-0000-0000-0000-000000000007','patch',jsonb_build_object('statblock',jsonb_build_object('senses',repeat('я',34000)))) from public.characters where id='ch-edit'$q$,'22023');
select pg_temp.code('override: булев итог не число', $q$select public.character_command('c-rls','ch-edit',sheet_version,'90000000-0000-0000-0000-000000000008','patch','{"overrides":{"initiative":{"value":true,"reason":""}}}') from public.characters where id='ch-edit'$q$,'22023');
select pg_temp.ok('override: явный ноль допустим', $q$select public.character_command('c-rls','ch-edit',sheet_version,'90000000-0000-0000-0000-000000000009','patch','{"overrides":{"initiative":{"value":0,"reason":"Исключение"}}}') from public.characters where id='ch-edit'$q$);
select pg_temp.code('Sidekick: класс только из трёх', $q$select public.character_command('c-rls','ch-sk',sheet_version,'90000000-0000-0000-0000-000000000010','patch','{"sidekick":{"class":"wizard"}}') from public.characters where id='ch-sk'$q$,'22023');
select pg_temp.ok('Sidekick: подтверждённая базовая точка', $q$select public.character_command('c-rls','ch-sk',sheet_version,'90000000-0000-0000-0000-000000000011','patch','{"sidekick":{"class":"warrior","baseLevel":5,"hitDie":8,"partyIds":["ch-q"]}}') from public.characters where id='ch-sk'$q$);
reset role;

select pg_temp.login('00000000-0000-0000-0000-00000000000a');
insert into _sheet_replies(name,expected) select 'growth-repeat',sheet_version from public.characters where id='ch-sk';
select pg_temp.ok('Sidekick: развитие с ID операции и отдельным пулом', $q$update _sheet_replies set reply=public.character_command('c-rls','ch-sk',expected,'a1000000-0000-0000-0000-000000000001','growth','{"patch":{"level":6,"hpMax":38,"hitDicePools":[{"id":"growth-die-1","source":"sidekick-growth","operationId":"a1000000-0000-0000-0000-000000000001","die":8,"total":1,"spent":0}],"sidekick":{"growthHistory":[{"id":"a1000000-0000-0000-0000-000000000001","operationId":"a1000000-0000-0000-0000-000000000001","from":5,"to":6}]}}}') where name='growth-repeat'$q$);
select pg_temp.cnt('Sidekick: повтор роста возвращает ACK', $q$select 1 from _sheet_replies where name='growth-repeat' and (public.character_command('c-rls','ch-sk',expected,'a1000000-0000-0000-0000-000000000001','growth','{"patch":{"level":6,"hpMax":38,"hitDicePools":[{"id":"growth-die-1","source":"sidekick-growth","operationId":"a1000000-0000-0000-0000-000000000001","die":8,"total":1,"spent":0}],"sidekick":{"growthHistory":[{"id":"a1000000-0000-0000-0000-000000000001","operationId":"a1000000-0000-0000-0000-000000000001","from":5,"to":6}]}}}')->>'replayed')::boolean$q$,1);
select pg_temp.cnt('Sidekick: повтор не добавляет HP или кости, раны остаются', $q$select 1 from public.characters where id='ch-sk' and data->'level'='6' and data->'hpMax'='38' and data->'hp'='20' and jsonb_array_length(data->'hitDicePools')=1 and data#>'{hitDicePools,0,total}'='1'$q$,1);
select pg_temp.cnt('Sidekick: одна запись серверной истории на развитие', $q$select 1 from public.character_history where operation_id='a1000000-0000-0000-0000-000000000001'$q$,1);
select pg_temp.code('Sidekick: устаревшая новая команда не применяет рост', $q$select public.character_command('c-rls','ch-sk',expected,'a1000000-0000-0000-0000-000000000002','growth','{"patch":{"level":6,"hpMax":38,"hitDicePools":[{"id":"growth-die-1","source":"sidekick-growth","operationId":"a1000000-0000-0000-0000-000000000001","die":8,"total":1,"spent":0}],"sidekick":{"growthHistory":[{"id":"a1000000-0000-0000-0000-000000000001","operationId":"a1000000-0000-0000-0000-000000000001","from":5,"to":6}]}}}') from _sheet_replies where name='growth-repeat'$q$,'40001');
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
-- TASK-125: отдельная проверка отзыва доступа к снимкам.
select pg_temp.cnt('library: исключённый не читает свой снимок кампании', $q$select 1 from public.campaign_creatures where id='summon'$q$,0);
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
