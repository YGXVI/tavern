# Данные и владельцы

## Реализовано: демо-стол v2 (TASK-007, DEC-011)

Источник — `dist/js/**`. Это по-прежнему локальная демонстрация: данные лежат в браузере, сервера, проверки личности и защиты закрытых полей нет. «Онлайн» имитируется между вкладками одного браузера: данные — событием `storage`, мгновенные действия (пинг, перетаскивание, линейка, шаблон, бросок, присутствие) — `BroadcastChannel('rasputye-v2')`.

| Хранилище | Ключ | Форма | Назначение |
| --- | --- | --- | --- |
| localStorage | `rasputye-v2-db` | `{version: 1, rev, users, campaigns}` | Все пользователи-заглушки и кампании. При другом `version` читается как пустое и засевается демо (миграций пока нет). |
| sessionStorage | `rasputye-v2-session` | `{userId, at}` | Кто «вошёл» в этой вкладке: у каждой вкладки свой человек. Не токен. |
| localStorage | `rasputye-v2-last-user` | строка `userId` | Кого подставить в новой вкладке (кроме ссылки-приглашения). |
| sessionStorage | `rasputye-v2-cam:<campaignId>:<sceneId>` | `{x, y, z}` | Камера стола в этой вкладке. |
| IndexedDB | `rasputye-v2-assets` / `images` | Blob по UUID | Загруженные карты. В данных — ссылка `idb:<uuid>`, файл живёт только в этом браузере. |

Старые ключи прототипа (ниже) новый интерфейс не читает и не стирает.

### Схема `rasputye-v2-db` (версия 1)

- `users: {[id]: {id, name, handle, hue, provider: 'discord-demo', createdAt}}` — заглушки «входа через Discord», без токенов и почты.
- `campaigns: {[id]: Campaign}`.
- `Campaign = {id, name, description, cover, level, seats, createdAt, ownerId, status, members, invite, characters, scenes, activeSceneId, combat, paused, log, settings, saveRequests?, portalRequests?}`.
- `Member = {userId, role: 'master'|'player', status: 'active'|'pending', characterId, joinedAt, lastSeen?, sceneId?}`. `sceneId` — личная сцена игрока, если отряд разделился.
- `invite = {code: 'RSP-XXXX', createdAt?, expiresAt|null, manual}`.
- `Character` — базовый шаблон листа (`makeCharacter` в `dist/js/data/demo.js`): `id, ownerId, name, portrait, classId/className, raceId/raceName, level, stats{str…cha}, saves[], skills[], ac, hp, hpMax, tempHp, speed, darkvision, deathSaves{s,f}, conditions[], attacks[], slots{}, spells, inventory, features, notes, initBonus, light, aura`. Детали листа — TASK-004.
- `Scene = {id, name, note, status, map{src, width, height}, grid{size, offsetX, offsetY, feet, visible, calibrated?}, lighting: 'bright'|'dark', fog{mode: 'vision'|'manual'|'off', ops[], explored[]}, walls[], lights[], terrain{difficult[], blocked[]}, tokens[], drawings[], pins[], portals[], traps[]}`.
- Мировые координаты — пиксели исходной картинки карты; клетка — `"c,r"` от смещения сетки.
- `Token = {id, kind: 'hero'|'foe'|'item', characterId?, monsterId?, name, img, size, x, y, hidden, conditions[], hp?, hpMax?, ac?, light?, aura?, disengaged?}`. Хиты героя берутся из листа, существа — с токена.
- Рисунки сцены `drawings[]` (TASK-031 — объекты): `{id, type: 'line', color, pts[], author}` или `{id, type: 'text', x, y, text, color, size, author}`, или фигура (TASK-032) `{id, type: 'shape', shape: 'seg', a, b, color, author}` / `{id, type: 'shape', shape: 'cone'|'line'|'cube'|'sphere', origin, angle (рад), size (фт, дробный — по 0,5 фт; TASK-042), color, author}` — точка `origin` свободная, без привязки к клеткам; размер в футах переводится в пиксели по сетке сцены, как у шаблона линейки. Мастер выделяет, двигает, перекрашивает и удаляет любые, игрок — свои (`author`).
- Поворот и размер токена (TASK-030, необязательные): `rot` — поворот картинки в градусах 0–359; `scale` — свободный множитель диаметра к размеру по категории (0,25–8; средний × 1,4 = 7 фт), правила (клетки, досягаемость) по-прежнему считаются по `size`; `locked: true` — токен не сдвигает никто, пока мастер не снимет замок. `movedAt` < 0 — мастер отправил токен «под всех».
- `movedAt` (TASK-024, необязательное) — время последнего перемещения токена, мс; кого двигали позже, тот рисуется поверх. Нет поля — порядок по списку токенов сцены.
- Поля токена (TASK-023, необязательные): `disposition: 'hostile'|'neutral'|'friendly'|'secret'` (нет поля — враг для `foe`), `nameHidden` (игроки видят «Неизвестное существо»), `elevation` (фт над полом).
- Запись журнала броска: `vis: 'all'|'gm'|'blind'|'self'` (TASK-023); старое `hidden: true` без `vis` читается как `gm`.
- `aura = {name, radius (фт), color: 'magic'|'holy'|'fire'|'nature'|'frost'|'blood'|'shadow'|'#rrggbb', opacity?: 5–100 (%; нет поля = 16), text?, concentration?}`; у героя копия хранится и в листе. Ауры рисуются отдельным слоем под токенами (TASK-020).
- `Wall = {id, a{x,y}, b{x,y}, kind: 'wall'|'window'|'invisible'|'door'|'secret', open, locked, lockDc?, discovered?, name?}`.
- `combat = {active, sceneId, round, turn, entries[{tokenId, init|null}], moved{tokenId: футы}}`; `init: null` — игрок бросит сам.
- `log` — последние 120 записей `{id, at, userId, kind, label|text, total?, detail?, hidden?}`.
- `settings = {diagonal: '5'|'5-10-5', sharedVision, playersSeeHp: 'status'|'exact', openMovement}`; `openMovement` (нет поля = `true`) — игроки двигают любые видимые токены (TASK-018).

Права в демо проверяются только интерфейсом (`canControlToken`, роль в членстве). Любая вкладка может записать что угодно в `localStorage`; скрытые токены, заметки мастера и ловушки физически лежат у игрока в браузере. Для игры по сети — серверный режим ниже (DEC-014); песочница остаётся как «Попробовать без входа».

## Реализовано: серверный режим (TASK-002, DEC-014)

Источник — `dist/js/server/**` (`config.js`, `client.js`, `model.js`, `sync.js`), миграции — `supabase/migrations/`, проверка прав — `supabase/tests/rls.sql`. Включается флагом `SERVER_ENABLED` в `config.js`; пока он `false` — ссылкой `?server=1` для своего браузера. Экраны и стол работают с той же формой `Campaign`, что выше: `model.js` собирает её из строк таблиц (`assemble`) и раскладывает обратно (`explode`, `diffRows`). Песочница (ключи выше) не меняется и на сервер не переносится.

### Браузер в серверном режиме

| Хранилище | Ключ | Форма | Назначение |
| --- | --- | --- | --- |
| localStorage | `rasputye-v2-auth` | сессия supabase-js | Вход через Discord (токены Supabase Auth, обновляются сами). Выход его стирает. |
| localStorage | `rasputye-server-preview` | `'1'` | Предпросмотр сервера до включения флага (`?server=1` / `?server=0`). |
| sessionStorage | `rasputye-v2-mode` | `'server'`/`'sandbox'` | Режим вкладки: «Попробовать без входа» переключает на песочницу. |
| sessionStorage | `rasputye-v2-return` | hash | Куда вернуться после Discord (например, ссылка-приглашение). |

### Таблицы (схема `public`, RLS на всех)

Ключи кампаний, героев, сцен, токенов и записей — строки, которые задаёт клиент (`c-…`, `ch-…`, `s-…`, `t-…`), как в песочнице. Пользователь — `uuid` Supabase Auth. Объекты сцены, токена, героя и т. п. лежат в `data jsonb` в той же форме, что в `rasputye-v2-db`, без полей, вынесенных в колонки.

| Таблица | Ключ | Что хранит | Читает | Пишет |
| --- | --- | --- | --- | --- |
| `profiles` | `id` (uuid) | ник, `handle`, `avatar_url`, `hue` — из Discord при входе | себя и тех, с кем общая кампания | триггер `on_auth_user_profile`; сам — свой |
| `campaigns` | `id` | `owner_id`, `name`, `data` — остальные поля `Campaign` верхнего уровня (описание, обложка, места, `activeSceneId`, `settings`, пауза) | участники и ожидающие | мастер; создатель становится мастером триггером |
| `campaign_members` | `campaign_id, user_id` | `role`, `status`, `character_id`, `scene_id`, `joined_at` | участники; ожидающий — свою строку | мастер (места проверяет триггер); вступление — `join_campaign`, герой — `claim_character`; уйти может сам |
| `campaign_invites` | `campaign_id` | `code` `RSP-XXXX`, `expires_at`, `manual`, `revoked` | мастер; по коду — `invite_preview` (и без входа) | мастер |
| `characters` | `id` | `owner_id`, `data` — лист героя | участники | мастер; игрок — лист своего героя, новый — только свой |
| `scenes` | `id` | `ord`, `data` — сцена без токенов, рисунков, тайного и исследованных клеток | участники | мастер; игрок — открыть/закрыть незапертую дверь |
| `scene_secrets` | `scene_id` | `data = {traps[], pins[]}` — ловушки и метки, которые игроки не видят | мастер | мастер |
| `scene_explored` | `scene_id` | `cells text[]` — исследованные клетки тумана | участники | функция `add_explored` (только добавление) |
| `tokens` | `id` | `scene_id`, `character_id`, `hidden`, `ord`, `data` — остальное `Token` | участники; скрытые — мастер | мастер; игрок — свой герой (место, поворот, размер, свет, аура…), любой видимый незакреплённый — место и поворот при открытом перемещении |
| `drawings` | `id` | `scene_id`, `author`, `ord`, `data` | участники | автор и мастер |
| `log_entries` | `id` | `author`, `at` (мс), `vis`, `data`; у скрытого броска в `data` нет суммы и подписи | участники | автор (`author` = вошедший) |
| `log_secrets` | `id` | тайная часть скрытого броска: `label`, `total`, `detail`, `nat`… | мастер; автор, кроме `blind` | автор |
| `save_requests` | `id` | `data` — запрос спасброска с `results` | участники | мастер; игрок — один раз результат любого героя |
| `portal_requests` | `id` | `author`, `data` — герой просит переход | мастер и автор | автор; мастер удаляет |
| `combats` | `campaign_id` | `data` — `combat` + `current` (чей ход по данным мастера) и `ended` (игрок закончил ход героя) | участники | мастер; игрок — инициативу героя один раз, `moved` видимых токенов, `ended` для хода героя |

Функции: `invite_preview(code)`, `join_campaign(code)`, `claim_character(campaign, character)`, `add_explored(scene, cells[])`; помощники прав `is_member`, `is_master`, `is_applicant`, `my_character`, `shares_campaign`, `hero_token_ids`, `visible_token_ids`.

Реальное время: изменения этих таблиц (Realtime проверяет RLS для каждого получателя; удаления приходят всем подписчикам таблицы только с ключом — клиент сам отсекает чужие кампании), Broadcast `bus` и Presence на приватном канале `campaign:<id>` (только участники), личный канал `user:<uid>`. Мастер, скрыв токен, рассылает `hidden-ids`, чтобы игроки убрали его у себя. Скрытый бросок в Broadcast идёт без суммы.

Карты и обложки: приватный бакет `maps`, путь `<campaign_id>/<uuid>.<ext>`, в данных ссылка `sb:<путь>`; браузер получает подписанную ссылку на 6 часов. Читают участники и ожидающие, загружает мастер, до 25 МБ, только картинки.

## Личная библиотека Creature (TASK-122, TASK-125)

Эта порция предоставляет модель и API; экран библиотеки, постановка на сцену и копирование изображений в кампанию — TASK-097 у Claude. Невлитый PR не означает наличие функции на сайте. Общая поставка содержит SRD и каталог метаданных; личные не-SRD статблоки не публикуются в Git или общем каталоге.

`Creature = {id, ownerId, name, img, statblockImage?, size, type, alignment, ac, acNote, hp, hpFormula, speed{walk,fly,swim,climb,burrow}, stats{str,dex,con,int,wis,cha}, saves[{ability,bonus}], skills[{name,bonus}], senses, languages, cr, traits[], actions[], bonusActions[], reactions[], legendary{count,actions[]}, source:'manual'|'image', updatedAt}`.

Возможность: `{name,text,attack?{bonus,reach,range{normal,long}},damage?[{dice,type}],save?{ability,dc,who:'target'|'self'},recharge?}`. Расстояния в футах. Неизвестные числа — `null`, включая неполный статблок картинкой; такая запись не становится автоматически пригодной к бою. Обязательны ID/владелец/имя; image требует statblockImage. `cr` — строка (`'1/4'`, `'2'`) либо null. Копия SRD сохраняет provenance (исходный ID, атрибуция CC BY 4.0), исходную прозу и дополнительные JSON-поля. Сырой saving_throw без известного субъекта не превращается в типизированный save. Несколько компонентов урона сохраняются отдельно.

| Хранилище | Форма и границы | Кто читает/пишет |
| --- | --- | --- |
| Песочница, `rasputye-v2-db` | Необязательное `creatures:{[id]:Creature}` на верхнем уровне, версия 1 и campaigns сохраняются; до 500 на ownerId | Выбранный демо-пользователь через API; это локальные данные браузера, не защищённая авторизация |
| `public.creatures` | `id text PK, owner_id uuid, data jsonb, updated_at`; data без id/ownerId/updatedAt | Только владелец; мастер кампании не получает чужую личную библиотеку |
| `public.creature_library_quota` | Внутренний `owner_id,used` (0–500), AFTER INSERT/DELETE; upsert-update не расходует место | API доступа не имеет; атомарный счётчик выдерживает параллельные вставки |
| `public.campaign_creatures` | PK `(campaign_id,id)`, `owner_id nullable,source_id nullable,data,updated_at`; самостоятельный снимок, без FK к личному шаблону | Мастер CRUD; активный игрок читает/добавляет только свои копии призывов; исключённый не читает |
| Приватный bucket `library` | `<user UUID>/<file UUID>.<png/jpg/webp>`, до 5 MiB; в Creature ссылка `library:<path>` | Только владелец первого сегмента пути; обновление проверяет и новый путь |

На клиенте максимум — 65536 байт нормализованного JSON в UTF-8. База отдельно ограничивает `data::text` (JSONB) тем же пределом; его пробелы и порядок сериализации могут отклонить пограничную запись раньше. Ошибка возвращается, данные не обрезаются. Размер/MIME ограничены bucket и клиентом; клиент проверяет сигнатуру, а не только расширение. Подписанные URL выдаются на 60 секунд и не сохраняются в статблоке; это временная ссылка, не мгновенно отзываемая сессия. `resolveLibraryImage` не является общим resolver картинок стола; подключение делает UI TASK-097.

`dist/js/core/library.js`: `listCreatures()`, `saveCreature(value)`, `deleteCreature(id)`, `copySrdCreature(monster)`, `uploadLibraryImage(file)`, `resolveLibraryImage(ref)` — Promise. Новые ID создаёт клиент, ownerId берётся из текущего входа. Сохранение возвращает подтверждённую сервером строку либо ошибку; sandbox не скрывает ошибку localStorage. Серверная библиотека не входит в store, sync/model или Realtime кампании. Ответ от предыдущего пользователя/режима отклоняется; кэша личных записей между аккаунтами нет.

`createLibrary` и `createServerLibrary` позволяют внедрять адаптеры для тестов. Проверка SQL: `python3 tests/postgres/library_harness.py` (локальные PostgreSQL binaries). Стенд создаёт отдельный временный кластер без TCP, применяет миграции и проверяет реальные RLS/триггеры/гонку; auth/storage/realtime моделируются минимальными схемами. Это не проверка работающего Supabase HTTP Storage API. На рабочий проект эти миграции до review/merge не применялись.

## Старый прототип (`dist/legacy/`)

Источник — `dist/legacy/app.js`, `dist/access.js`, `dist/legacy/themes.js`. Данные привязаны к origin сайта и профилю браузера. Localhost и опубликованный сайт имеют независимые хранилища. Нет аккаунтов, сервера, синхронизации и безопасной границы между мастером и игроком.

| Ключ localStorage | Форма | Назначение |
| --- | --- | --- |
| `tavern-campaign-v1` | объект кампании | Исторический ключ, сохраняем при ребрендинге. |
| `rasputye-theme-v1` | строка ID темы | Предпочтение человека на этом устройстве. |
| `rasputye-session-v1` | `{role, characterId?}` | Режим демо; `characterId` только для игрока. Не токен авторизации. |

### Объект кампании

- `name: string` — название; `round: number` начинается с 1; `turn: number` — индекс текущего участника отсортированного списка.
- `tokens: Token[]`; `notes: string`; `logs: LogEntry[]` (код оставляет последние 60 записей).
- `grid: boolean`, `fog: boolean`, `paths: Point[][]`.
- `map?: string` — JPEG data URL после обработки загруженной картинки; исходная SVG-карта встроена в HTML.

`Token = {id, name, kind, hp, max, ac, mod, x, y, init}`. `kind` — `hero | enemy`; `init` — `number | null`; `x/y` — проценты размеров карты. Стартовые ID `a…e`, новые — UUID. Имена и порядковые номера не являются ID. Токен сейчас совмещает представление на сцене и боевые данные героя; полноценного листа отдельно нет.

`Point = {x, y}`. `LogEntry = {label, result, detail, time}`; `result` может быть числом или строкой, `time` — локальная строка `HH:MM`, не полноценная временная метка.

В демо мастер меняет всю кампанию. Игрок меняет HP и положение выбранного `hero`; интерфейс скрывает инструменты мастера. Все данные, включая `notes`, по-прежнему лежат на одном устройстве. Скрытие UI не обеспечивает конфиденциальность. Экспорт — JSON кампании без темы/сессии; импорта пока нет.

## Целевая модель: ещё не реализована

| Сущность | Кто владеет / кто пишет | Кто читает |
| --- | --- | --- |
| `User` | Сам пользователь; идентичность подтверждает сервер | Сам пользователь; другим — минимальный профиль по участию. |
| `Campaign` | Создатель-мастер; передача владения только явным действием | Участники, только разрешённые поля. |
| `CampaignMembership` | Мастер приглашает/отзывает участников; сервер проверяет роль | Участник видит своё членство, мастер — состав. |
| `Character` | Игрок владеет своим героем; мастер редактирует данные в рамках кампании по явной политике | Владелец и мастер; остальным — доступные публичные поля. Правила доступа к герою вне кампании требуют отдельного решения. |
| `Scene`, `Token`, `Drawing` | Мастер управляет сценой; игрок перемещает только связанные с его членством разрешённые токены | Игрок получает лишь раскрытые данные сцены. |
| `Combat`, `Combatant` | Мастер начинает бой, задаёт порядок и переключает ход | Участники видят разрешённое состояние боя. |
| `Roll` | Автор создаёт бросок; сервер фиксирует автора/время/видимость | Согласно выбранной видимости; детали политики ещё не выбраны. |
| `Note` / `ChronicleEntry` | Автор/мастер; публикация в кампанию отдельным действием | Закрытые заметки — только мастеру; опубликованная хроника — участникам. |
| `CatalogEntry` | Редакторы общего каталога либо автор домашнего контента | В зависимости от источника и области видимости. |
| `SessionRecording`, `Transcript`, `Speaker`, `SummaryDraft` | Согласованная запись сессии; мастер проверяет черновики и связь говорящих | Только явно разрешённые участники; хранение, согласие, сроки удаления требуют решения до реализации. |

Это границы проектирования, не обещание готовых таблиц/endpoint. Идентификаторы `userId`, `campaignId`, `membershipId`, `characterId`, `sceneId`, `tokenId` должны быть отдельными стабильными ID. Связь токена с персонажем не должна зависеть от имени. Роль проверяется для кампании в каждом серверном запросе; закрытые поля не отправляются игроку.

## Изменение контрактов

1. Зарезервировать задачу на контракт и перечислить потребителей.
2. Описать новую схему, доступ, миграцию и обратную совместимость в решении.
3. Не менять текущие ключи и форматы молча; не стирать сохранения и не смешивать новую схему со старым ключом без версии/миграции.
4. Сначала согласовать контракт, затем параллельно делать непересекающиеся реализации.

Не добавлять реальные пользовательские записи, токены доступа, аудио или персональные данные в fixture и Git. Не выбирать серверную БД/провайдера авторизации под видом уже принятого решения.
