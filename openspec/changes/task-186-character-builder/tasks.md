# Tasks

Это план. Отметки P0 подтверждают исследование/публикацию, не реализацию runtime,
не согласие L2 и не merge/deploy. P4/P5 имеют обязательные gates designD6/D7.

## 1. P0 — доказательства и стыки

- [x] 1.1 Зафиксировать свежий main/#176/#156 полными SHA; read-only audit.py воспроизводит inventory.json из Git objects без чтения незавершённой работы коллег.
- [x] 1.2 Опубликовать поэлементную матрицу пяти разделов с источниками/уровнями/пробелами в #186 и общую матрицу справки в #181; ссылки6541281711/6541297938.
- [x] 1.3 Проверить отсутствие методов исходных характеристик в SRD и источник фактов Basic Rules2014; фактические PDF-страницы7–8, источник не импортирован в runtime.
- [ ] 1.4 Получить подтверждение конкретной ревизии P1–P3 и дополнительных фактов источника; проверить ссылку/версию в Issue, не считать ACK направления согласием схемы.
- [ ] 1.5 Согласовать новый UI module/scoped CSS/ownHeroModal с Claude и импорт/re-export формул с Rules; получить их HEAD и границы файлов в комментариях #186/#61.
- [ ] 1.6 Дождаться исправления CAS/review/integration #176, включить main обычным merge; подтвердить отсутствие постороннего TASK186 runtime в diff #176 и сохранить ревизию плана при переносе.

## 2. P1 — определения и общие данные

- [ ] 2.1 Создать source/decision manifest пяти разделов с dispositions каждого кандидата и утверждёнными aliases; тесты проверяют100% решений/ссылок/уникальность и исключение2024.
- [ ] 2.2 Нормализовать12 classes и240 source-verified progression rows,12 subclasses/class-level schedules/ASI; fixtures сравнивают каждую числовую ячейку/choice с источником, нет предполагаемых нулей.
- [ ] 2.3 Нормализовать9 races/4 subraces, наследование, ASI/languages/proficiencies/racial spells/особые варианты; тесты на каждую расу/подрасу и aliases halfelf/halforc сохраняют старые IDs.
- [ ] 2.4 Нормализовать Acolyte/customization/duplicate proficiency policy и Grappler prerequisites/availability; добавить background feature со source61 без дублирования прежних391 записей; тесты scope/ref и negative cases.
- [ ] 2.5 Создать единые с TASK181 equipment/weapon/armor/tool/pack и spell projections; source manifests, реальное число строк, единицы/null,524 прежнихspell IDs/53 formula tables сохраняются;319 SRD/308 связей/11 unmapped проверены exact aliases без fuzzy match, исходный damage engine63/63 не дублируется.
- [ ] 2.6 Добавить public schemas/loader registry/get/query с reuse транспорта #176; тесты retry/empty/invalidate/immutable/crossrefs/unknown kind и неизменности private whitelist.
- [ ] 2.7 Документировать Definition/Grant/Choice/source/coverage в docs с реальным примером, проверенными ссылками и измеренными counts; два regenerate дают одинаковые bytes и зафиксированные hashes.

## 3. P2 — чистый движок допустимых решений

- [ ] 3.1 Реализовать BuildDraft/CreationContext/evaluateBuild и закрытые predicate/grant types; tests JSON validation/cycles/unknown operator/null не допускают неявного valid.
- [ ] 3.2 Реализовать историю уровней и scopes/grants/ASI/feats/multiclass prerequisites; табличные fixtures12×20 и все boundaries подкласса, Fighter6/14,Rogue10,Fighter2/Wizard2 проходят.
- [ ] 3.3 Реализовать ability method/racial increases/ASI/limits с formula port Rules; tests standard-array/27 points/8–15/recorded rolls/CON/на момент prerequisites и итогового уровня.
- [ ] 3.4 Реализовать skill/tool/language/expertise choices/дубли и source trace; tests same-kind replacement, ограничения количества/списка и отсутствие удвоенных grants.
- [ ] 3.5 Реализовать equipment trees и magic/book/known/prepared/racial/domain/pact choices; tests альтернатив/пакетов/классовых уровней/списков/истории замен и отдельных pools.
- [ ] 3.6 Реализовать propose/confirm change с invalidation diff и сохранением ввода; tests смены расы/класса/уровня/policy/back повторно не начисляют grants и не стирают identity/base inputs.
- [ ] 3.7 Документировать ошибки/unsupported/manual override и conformance fixtures; сравнить производные с опубликованными Rules helpers без второго набора формул.

## 4. P3 — окно и черновик

- [ ] 4.1 Реализовать согласованный новый UI module и scoped CSS/entrypoint без изменения sheet/Creature/C-D129; браузерный smoke показывает шаги1–9 и нужные ветви по разным классам.
- [ ] 4.2 Добавить owner/mode/campaign-scoped draft persistence/reload/close, error handling без private prose cache; tests storage failure/unknown schema/account switch/revision changes сохраняют ввод.
- [ ] 4.3 Добавить summary/source traces/disabled reasons/change confirmation/focus restore; tests keyboard/labels/focus/390px в согласованной визуальной системе, без горизонтальной прокрутки страницы.
- [ ] 4.4 Проверить loader error/retry/empty и все required-choice переходы; доP4 нет optimistic fallback создания, состояние unavailable объяснено, preview не называется полной готовностью функции.
- [ ] 4.5 Обновить документы и матрицу готовности data/engine/UI отдельно; опубликовать SHA/скриншоты/проверенные и непроверенные сценарии P3.

## 5. P4 — Character и серверная проверка (r2: P4a и P4b, design D6a)

- [x] 5.1 P4a (05.11, миграция `20261105100000_character_create`, ветка `rules5e`): в `codex/rules5e` миграция `create_character_sheet` (одна транзакция, повтор по operationId, `23505` на занятый ID, owner из auth.uid, только `pc`, проверка формы `creation`, уровни, HP по формуле, claim в той же транзакции), `character_creation_hp`, клиент `makeCreateRequest`/`create`, `creationHitPoints` в `sheet-rules.js`; тесты local PostgreSQL и Node, как в прототипе D6a.
- [ ] 5.2 P4a: подключить `toCharacterData` к `create` в окне P3 с пометкой «проверено в браузере»; тесты lost ACK, повтор, другой payload, отказ без частичного листа, второй герой игрока.
- [x] 5.3 P4a: номер `20261105100000` — после миграций листа и слияния 05.11; на тестовую базу применяется CI, откат — новой миграцией (`drop function` трёх функций создания); production SQL этим не разрешается — только после бэкапа (`tools/backup-db.py`).
- [ ] 5.4 P4b: отдельная ревизия плана — хранилище политики кампании, реестр ревизий справочника, серверная проверка выборов и prerequisites на общих fixtures; прямой поддельный запрос отклоняется.
- [ ] 5.5 Пройти end-to-end создание/reload/два аккаунта/смена политики/смена аккаунта/двойное подтверждение и создание+место; явно отделить local от live Supabase.
- [ ] 5.6 Документировать итоговую команду, поля и права, обновить матрицу создания; проверить существующих героев и legacy без потерь.

## 6. P5 — реальные не-SRD материалы и покрытие книг (отдельный контракт)

- [ ] 6.1 Зафиксировать предоставленные личные книги/редакции/элементы и отсутствующие источники; отчёт содержит проверяемый знаменатель и не объявляет все PHB/дополнения покрытыми по одному SRD.
- [ ] 6.2 Согласовать точные private kinds/format/CAS/quota и owner/campaign projections/consent отдельной L2-ревизией до runtime/SQL; проверить отсутствие public prose/cache расширения.
- [ ] 6.3 Импортировать/валидировать предоставленные структурированные private definitions по agreed schema; tests edition/ref/choices/ownership/account switching и whitelist кода отклоняют недоступную/неисполняемую механику.
- [ ] 6.4 Проверить применение только разрешённого мастером механического snapshot игроком, без раскрытия целой книги; создать/перечитать героя из private variant и сохранить provenance без публичной утечки.
- [ ] 6.5 Опубликовать покрытия каждой предоставленной книги и список незакрытого/ручного review; task не закрывается ложным «всё2014» при недоступных источниках.

## 7. Интеграционная приёмка

- [ ] 7.1 На конкретной финальной ревизии выполнить npm ci, npm test, spec:validate/current+archive, JS syntax, diff и затронутые browser/server сценарии; сохранить результаты/ограничения без переноса старых89/89 на новый код.
- [ ] 7.2 Сверить все requirements и фактические data/UI/server/source gates, migration rollback без потери созданных героев, провести независимую семантическую приёмку Rules и human result review; незакрытое остаётся явным.

## Workflow follow-up

- Синхронизировать проверенные delta specs и архивировать только реализованный объём по AGENTS; полный незавершённый TASK186 не архивировать как готовый.
- PR из codex/library имеет зафиксированный SHA; human review/integration/deploy ведутся в Issue, авторL2 не интегрирует себя. Новых task/review веток нет.
