# Design

## Context

См. proposal.md и опубликованную матрицу
[#186](https://github.com/YGXVI/tavern/issues/186#issuecomment-6541281711).
`ownHeroModal` в main и опубликованном #156 пока использует фиксированные stats,
КД12, приблизительные HP и optimistic commit. `makeSheetCommand` в #156 работает
с существующим листом и не имеет create. Уже есть createCharacterSheet(cid,ch)
в sync.js: INSERT/read, повтор23505 сравнивает владельца, но не fingerprint
всего DTO. Rules подтвердил ограничение в186,6541200890; это не полный
идемпотентный command, и подменить им требуемые гарантии без доработки нельзя.

#176 имеет pure public loader/search/snapshot и private feature/magic_item;
в нём нет механики сборки. Его исправление CAS ABA и review идут отдельно.
Приоритет: сохранять один Character, один источник каждого текста и формул,
постоянную ветку и проверяемый diff. Этот план лежит в экспортном каталоге,
не в runtime/ветке ожидающего review #176.

## Goals / Non-Goals

**Goals:** проверяемая сборка по объявленному набору источников2014, полное
покрытие поддерживаемых обязательных решений, сохранность выбора и подтверждённая
запись. Данные, обработка выбора, UI, сервер и покрытие книг принимаются отдельно.

**Non-Goals:** исполнять произвольную прозу/JavaScript из книги, включать2024,
восстанавливать отсутствующие PHB/дополнения по памяти, вводить второй Character,
автобой или менять существующего героя вслед за обновлением справочника.

## Decisions

### D1. Источники и честный знаменатель полноты

Базовый публичный корпус: сохранённый SRD5.1,403 страницы, SHA256
`2504d2a0abb0a4d491a939be4f17910a2dde0312570ab8d208080225ccf0a1f0`.
Его12 классов,12 подклассов,9 рас/4 подрасы,Acolyte,Grappler — **SRD-пакет**,
не весь PHB. Для каждой книги/раздела manifest различает present/source-only/
normalized/creation-supported/not-available/manual-review. Неопределённое множество
«все книги2014» не имеет100%: регистрируются предоставленные книги и недоступные
наборы. Варианты, упомянутые в исходном тексте без определения, не выбираются.

Для числовых методов характеристик предлагается дополнительный официальный
источник: https://media.wizards.com/2015/downloads/dnd/BasicRules_Playerv3.4_PF.pdf,
внутри Player’s Basic Rules Version0.3, июнь2015, правила2014, PDF-страницы7–8.
Факты: стандартный массив15,14,13,12,10,8; бросок4d6 с отбрасыванием меньшего,
шесть результатов; optional point buy27, base8–15, costs0,1,2,3,4,5,7,9.
План предлагает самостоятельное кодирование механических фактов с provenance,
без публичной копии полного PDF/прозы/чужого перевода; это не лицензия CC-SRD.
До согласования L2 источник исследован, но не импортирован в приложение.

Отсутствие полной личной книги нельзя заменить заголовком или скачиванием
не-SRD прозы в публичный Git. Private-пакетP5 имеет отдельный контракт/доступ,
до него неподдержанные записи явно недоступны каноническому пути. Первый
SRD-выпуск не закрывает обещание полноты всех источников TASK186.

### D2. Нормализованные определения и ссылки

Новый public envelope:

```json
{
  "schemaVersion": 1,
  "catalogueKind": "character_option",
  "edition": "5e-2014",
  "revision": "<sha256-inputs-and-generator>",
  "sourceHashes": {},
  "coverage": {"entries": 0, "decisions": 0},
  "entries": []
}
```

Definition:
`{id,kind,name:{ru,en},source,review,featureRefs,grants,choices,progression?}`,
где kind=`class|subclass|race|subrace|background`; связи `classId`/`raceId`
и refs обязательны по типу. `source` содержит documentId/edition/hash/page/spans,
а каждый механический параметр/табличная ячейка связан с источником.
Имена не создают ID. Предлагаемые canonical IDs:
`srd51:class:<id>`, `srd51:subclass:<class>:<id>`,
`srd51:race:<id>`, `srd51:subrace:<race>:<id>`, `srd51:background:acolyte`.
Grappler и существующие способности используют **прежние feature IDs #176**.

Прежние `barbarian`/`halfelf`/`halforc` и `dndsu:class:*` остаются допустимыми
в своих старых данных. Явный alias/crosswalk сопоставляет их canonical refs;
никакого fuzzy-join по одному RU-имени и переименования сохранённых героев.

Class definition: hitDie, fixed initial proficiencies, choices навыков/инструментов,
starting equipment tree, **20 строк progression**; каждая содержит classLevel,
featureGrantRefs, choiceRefs, ASI event, spellcasting/resource parameters или
явное none/not-applicable. Null — неизвестно, не none. Подкласс имеет parentClass,
selection classLevel и собственные grants. Раса: ability increases/choices,
size/movement/senses,proficiencies/languages,subrace selection, racial magic/options.
Подраса добавляет/переопределяет только явно указанное источником.
Background: grants, equipment, languages/tools choices, featureRef, personality
tables; настройка background — отдельное правилоSRD60, не свободная выдача всего.

Публичный feature каталог расширяется `background_feature` и scope.backgroundId,
включая Shelter of the Faithful(SRD61). Старые391 записи не переписываются
догадками и не дублируются в definition. Grant schedule позволяет передать
правильный уровень получения при справочном level=null.

Обычные вещи/пакеты/оружие/броня и spell projection — общие данные TASK181,
на них ссылается builder. Spell IDs524 и существующие53 damage tables не меняются;
базовые/TCE списки остаются раздельными, доступ определяется source policy.
В main уже есть modules/spell-damage/engine.js:calculate/allLevels/aggregate,
rules/damage/levels и самостоятельные тесты63/63; его не заменяет новый builder.
Источник modules/spell-damage/srd-2014.json содержит319 SRD spells, техническая
проекция524 связывает308 уникальных API indexes. Остальные11 нужно проверить
по exact names/aliases,level,concentration/источнику: arcanists-magic-aura,
floating-disk,hideous-laughter,instant-summons,irresistible-dance,
magnificent-mansion,private-sanctum,resilient-sphere,secret-chest,
telepathic-bond,tiny-hut. Это несопоставленные записи источника, не доказанное
отсутствие соответствующего заклинания среди524. Если verified alias существует,
он сохраняет прежний dndsu ID; новый SRD-only ID допустим только после проверки
отсутствия прежней записи, с отдельным disposition, без fuzzy match.
Typed units сохраняют ft/lb/cp или исходную единицу с точной конверсией, без
округления в «примерное» число; ranges/radius/unknown не изобретаются.

Loader расширяет существующий публичный транспорт/поиск #176 через явный
registry валидаторов `character_option/equipment/spell`. У private API остаются
прежние feature/magic_item kinds. Расширять общий whitelist так, чтобы новый
тип прошёл private SQL без валидатора, запрещено. Публичный get/search проверяет
ссылки, циклы, source hashes и edition; error/retry/empty сохраняются.

### D3. Политика кампании и контекст

Предлагаемый read-only порт для конструктора:
`loadCreationContext(campaignId) -> CreationContext`.
`CreationContext={campaignId,policyRevision,edition,allowedSourceRevisions,
startLevel,allowedAbilityMethods,optionalRules,equipmentPolicy,hpMethod}`.
Политика задаётся мастером, сервер проверяет его право. Для новой кампании без
параметров предлагаются level1/standard-array,SRD2014,один класс,стартовые наборы,
фиксированное среднее HP после1-го; feats/multiclass/pointBuy/расовый перенос
выключены. Существующий `campaign.level` не игнорируется: read-адаптер показывает
его как прежний стартовый уровень, мастер подтверждает контекст;0/NaN/>20 — ошибка.

Мастер может явно разрешить level1–20, pointBuy или recorded rolls, feats,
multiclass и пользовательские исключения. Выключенное optional rule не прячется
как ошибка загрузки. TCE опции, variant human, flexible racial ASI,2024 не
включаются из факта наличия похожего имени/метаданных заклинания.

Высокоуровневое имущество не имеет одного канонического значения для любой
кампании. EquipmentPolicy явно разрешает class+background packages либо
мастерское назначение/богатство с источником. Неизвестная сумма не становится0.
Первая нормализованная версия поддерживает SRD starting packages; optional
покупка за случайные начальные средства у всех12 классов требует подтверждённой
полной таблицы и отдельного source manifest. Нельзя одновременно получить
альтернативное начальное богатство и прежние пакеты; item ownership не требует
владения предметом, а штрафы/КД/возможность колдовать определяются отдельно.

### D4. Draft и чистый движок решений

`BuildDraft={schemaVersion:1,draftId,accountScope,mode,campaignId,policyRevision,
rulesRevision,identity,abilityMethod,baseScores,rollReceipts,ancestry,
background,levelHistory,selections,manualOverrides,invalidationLog}`.
`levelHistory` хранит порядок уровней: один event на каждый characterLevel,
classId, вычисляемый classLevel, choice IDs. Общий уровень<=20. Для single-class
те же events, без второго движка. Roll receipts передаются как входные факты;
оценка/рендер не вызывают RNG. В серверном режиме происхождение бросков должно
быть проверяемым сервером; неподтверждённые ручные броски явно отмечаются/одобряются
мастером, не обозначаются серверным RNG.

Публичные чистые функции (без DOM/store/auth/SQL/random):
- `evaluateBuild(context,definitions,draft)` →
  `{status,choices,grants,derivedInputs,errors,warnings,sourceTrace}`;
- `proposeBuildChange(draft,change,context,definitions)` →
  `{nextDraft,invalidated:[{choiceId,reason,previousValue}],preservedInputs}`;
- `confirmBuildChange(proposal)` сохраняет подтверждённый результат;
- `toCreationProposal(evaluation,draft)` допустим только при resolved/valid.

Choice:
`{id,originRef,eventId,kind,count,allowedRefs,prerequisites,distinctFrom,
replacementPolicy,source}`. Grants имеют устойчивый origin/event ID; повтор
оценки не прибавляет их к уже рассчитанным значениям. Предикаты — закрытый
декларативный набор all/any/not, classLevel/characterLevel threshold,
abilityMinimum,hasFeature,hasSpell,sourceEnabled,unique. Сериализованные JS/eval
и эвристика по прозе запрещены. Неизвестный operator/недоступная ссылка =
manual_review/недопустимое подтверждение, не true.

Порядок: policy/source → ancestry/base scores → начальный класс/background →
последовательные class-level events и решения → proficiencies/equipment/magic →
derived inputs → validation/summary. Оценка prerequisites идёт на момент event,
а не только по финальным20 уровням; требуемая раньше способность/заклинание не
может быть взята позже задним числом. При изменении Constitution применяется
правило пересчёта HP, а формулы предоставляет Rules.

Подкласс по уровню класса: Cleric/Sorcerer/Warlock1; Druid/Wizard2;
остальные7 классов3. ASI:4/8/12/16/19; Fighter дополнительно6/14;
Rogue дополнительно10. Эти параметры проверены по каждому source span.
Feats доступны вместо конкретного ASI при разрешённой опции, не по общему
characterLevel и не каждому на1-м. Grappler:STR13, no repeat. Смена prerequisite
не удаляет feature из уже существующего листа автоматически.

Дубликат skill/tool proficiency из background/другого источника получает
replacement choice того же вида поSRD60, с trace, без скрытого удвоения.
Особые источники экспертизы проверяют наличие нужного владения. Язык не является
универсальной заменой любому skill/tool вне соответствующего правила.

Магия разделяет spellbook/known/prepared/always-prepared/ritual/racial sources,
источник характеристики и уровни класса. Общая высокая ячейка не разрешает
изучить высокий spell. Warlock Pact Magic отдельным pool. Рacial spells не
начисляются как обычные known spells; class/domain expanded list не равен
автоматическому изучению. Замены spells/invocations и choices на каждом уровне
учитываются только при явном разрешении источника. Wild Shape и похожие
использования — данные/ресурсы/выборы; не симуляция превращения в бою.

Формулы `abilityModifier, sheetProficiency, totalClassLevel, checkBonus,
spellNumbers` уже есть в #156: новый движок готовит входы и использует
согласованный импорт/re-export Rules. КД, HP, pools/overrides не переписываются
в новом module. Перенос pure формул из UI-пути требует ACK Rules, не самовольный
рефакторинг чужого файла. Rules уже передал использование sheet-rules/fields/model
(186,6541200890); переэкспорт отдельно согласуется. КД и movement в опубликованном
листе ручные: полного расчёта creation HP/armor/pools этот факт не доказывает.
Нужные отсутствующие формулы добавляются вместе с Rules с source fixtures,
не приписываются уже существующему helper и не копируются из него в новый код.

### D5. Окно и сохранение черновика

Шаги:1 кампания/источники/уровень/опции;2 раса/подраса;
3 класс/история уровней/доступные подклассы;4 предыстория/личность;
5 характеристики;6 обязательные навыки/владения/языки/черты/варианты;
7 вещи;8 магия;9 итог/создание. Порядок отображения не подменяет evaluation
dependency graph; ранний шаг может объяснить, какой ввод потребуется позже.
Ветви, не нужные конкретному герою, показывают причину или пропускаются явно.

Каждая карточка показывает RU label/EN fallback, источник, уровень/условия,
причину недоступности; нет генерации картинок книг. Основные кнопки Назад/Далее,
Сохранить черновик/Закрыть, на итоге Создать и отдельное действие Сесть, если
оно подтверждено command-контрактом. Финальная кнопка недоступна при обязательных
пробелах, но причины видны без угадывания. Нет автоматического назначения
token/места только из открытия окна.

При смене источника/класса/расы/уровня показывается diff затронутых решений;
старые значения сохраняются в invalidationLog, пока пользователь явно не
подтвердит очистку. Имя/заметки/исходные scores не удаляются. Перерасчёт и
возврат не порождают новое количество предметов/HP/grants.

Собственный optional localStorage key
`rasputye-character-build:<mode>:<accountId>:<campaignId>:<draftId>`;
root `rasputye-v2-db` не меняется ради draft. Только refs/выборы/собственный ввод,
без private prose/токенов/полных серверных библиотек. При смене аккаунта draft
другого accountScope не восстанавливается. Storage failure показывается; нельзя
называть «сохранённым» неуспешный setItem. Прежняя версия/revision открывается
через explicit review, неизвестная схема не стирается/не запускается.

Новый `views/character-builder.js` и scoped `.character-builder` блок screens.css.
Claude передал свободные screens.js/screens.css/новый module на bc0eade
(186,6541291093): вызов из mountHeroPick вместо ownHeroModal, широкая modal из
ui/kit.js, без нового маршрута/main.js/index.html, только существующие иконки.
Создание вне кампании и за столом не добавляется. До изменения сверяется новый HEAD;
sheet/Creature/C/D129 не захватываются. Навигация/focus trap модального окна,
Escape/close с сохранением, focus restore, поля label/aria,390px и keyboard
проверяются. Используются существующие стили/темы и без нового дизайн-пакета.

### D6. Creation proposal и серверный путь: граница P4

Предлагаемый DTO **порта**, не уже существующий endpoint:

```json
{
  "operationId": "<uuid-fixed-before-first-send>",
  "characterId": "<uuid-fixed-before-first-send>",
  "campaignId": "<campaign>",
  "contextRevision": "<policy-revision>",
  "rulesRevision": "<catalogue-revision>",
  "identity": {"name":"…","portrait":null},
  "build": {"ancestry":{},"background":{},"levelHistory":[],"selections":{}},
  "abilityInput": {"method":"standard_array","scores":{}},
  "rollReceipts": [],
  "manualOverrides": []
}
```

Owner/caller/канонические итоговые поля не принимаются как доверенный вывод UI.
Порт `submitCreation(proposal)` возвращает только подтверждённый Character/ACK
или typed validation/policy-conflict/permission/network/protocol error.
Повтор хранит тот же request+operationId и сверяет payload; потеря ACK не даёт
новый UUID. До retry текст не меняется без явного решения о новой операции.
Повтор ACK не заменяет свежий sheet старым snapshot, по семантике #156.

Базовая форма уже передана Rules: emptySheet({id,ownerId,name,profile:'pc'});
classes[{id,name,subclass,levels}], stats6, прежние identity/HP/AC/speed,
proficiencies.saves/skills, inventoryItems,featureEntries,spellSources,
knownSpells с sourceId→spellSources.id, resources/slotPools/hitDicePools.
Вложенные id — ID экземпляров, не canonical IDs класса/заклинания.
Legacy inventory/spells/features остаются строками. level=sum(classes.levels).
Owner/id отделяются от JSONB, версия string bigint и managed/controllers
приходят только от сервера.

Предложение дополнения на согласование P4:
`Character.creation={schemaVersion:1,edition,rulesRevision,policyRevision,
ancestryRef,backgroundRef,levelHistory,choices,sourceTrace,manualOverrides}`;
в выбранных entries optional catalogueRef хранит kind/id/revision/variantId.
Это provenance/решения, не вторые stats/HP/resources. Новые поля не считаются
уже одобренным контрактом TASK004; Rules должен подтвердить размещение/размер
и вложенную валидацию. Отсутствующие бронирование/пулы/канонические HP formulas
выделяются как новые механики с source fixtures, а не функционал emptySheet.

Rules выбирает конкретный create command и подтверждает canonical Character
fields/нумерацию версий/права и atomic create(+optional claim). `makeCharacter`
не второй источник истины: adapter использует подтверждённый DTO Rules.
Сервер проверяет schema/диапазоны/обязательные choices/prerequisites,
campaign policy/rules revision и caller. Нужен доверенный canonical rule data
по revision: присланная браузером definition не является серверным источником.
Публичные rules artifacts генерируются из тех же manifest и регистрируются
сервером через согласованную миграцию/seed; private definitions проверяются
только в разрешённом scope кампании. Generic predicate/grant validation и
вычисляемые значения реализуются/проверяются Rules в существующем серверном
пути, с общими conformance fixtures. Вторая база героев/Edge-платформа/собственный
незащищённый endpoint не предлагаются.

**P4 пока не разрешён к реализации:** нет ACK DTO/command, размещения доверенных
server rules artifacts/полного набора server validations/claim transaction.
Это обязательный совместный L2-стык, а не мелкая Open Question. До его конкретной
ревизии/approval P1–P3 могут выпускать данные/движок/окно-preview, но кнопка
создания не использует старый optimistic bypass и не выдаётся за готовую функцию.
Запрос опубликован в #61,6541215052. Смена этих обязательств потребует r2,
не молчаливого выбора автора.

### D7. Private пакеты и полные не-SRD книги: граница P5

Пакеты имеют ту же редакцию/типизированные определения/проверяемые choices,
но owner-only source и отдельные refs/revision. Произвольная проза не превращается
в исполняемую механику. Недоступная книга отмечается, не импортируется в public
Git/cache. Для игрока используются только явно разрешённые мастером проекции
механики/выбранных snapshots в кампании; вся книга не раскрывается.

**P5 пока не разрешён к реализации:** потребуются конкретные расширения kinds
private library, same-owner/CAS/quota и campaign projection/access/consent;
нынешние500 templates/64KiB нельзя молча объявить хранилищем PDF/любых книг.
Перед P5 фиксируются фактически предоставленные книги и точная ревизия
source manifest/SQL/API. Ни выдуманные PHB строки, ни обещание «полностью все
дополнения» не закрывают этот gate. P5 планируется следующим контрактом после
P1 и ответа Rules/Claude; он остаётся обязательной незавершённой частью задачи.

### D8. Вертикальные порции и приёмка

- **P0 сейчас:** reproducible audit из Git objects, все элементы SRD/пробелы,
  source method check, запросы Rules/UI, review blocker #176. Только research/docs.
- **P1 после approval/освобождения #176:** manifest/definitions/aliases и shared
  equipment/spell projection; все240 class rows,12 subclass gates,9+4 ancestry,
  Acolyte/customization и Grappler; unknown/review не скрываются. Новая публичная
  схема+loader валидаторы, без расширения private SQL.
- **P2:** pure resolver/history/choices/provenance/invalidation, formulas через
  Rules, fixtures для всех12 классов и1–20; rejected cases так же обязательны.
- **P3:** окно/scoped CSS/draft/preview с согласованным entrypoint. До P4
  серверное создание честно disabled/unavailable, не optimistic fallback.
- **P4:** joint Rules create DTO/server artifact validation/atomic command,
  persistence/retry/claim+two accounts. Точная ревизия до реализации.
- **P5:** supplied non-SRD/private packs и acceptance покрытия книг после
  отдельного точного private/campaign контракта. Не выдавать P1 за всю задачу.

Приёмка данных:100% source candidates получают disposition/reason/ref;
240 строк progression источниково проверены, а не просто сгенерированы циклом;
все числовые поля/spell/feature/equipment refs разрешимы либо manual_review;
два regenerate дают одинаковые bytes, source/ID/EN старых каталогов не изменены.

Тесты движка: таблица240 single-class profiles плюс обязательные варианты,
все12 subclass boundaries level-1/level, ASI Fighter6/14,Rogue10,
Fighter2/Wizard2, prerequisites с учётом истории, distinct choices,
дубли skill/tool/expertise, ancestry/subrace/dragon ancestry,
racial cantrip/level gates, domain/land/oath lists, Pact/known/prepared/book,
оборудование alternatives/pack quantity/armor constraints, HP/CON changes,
null/0/invalid/unsupported/2024, изменение upstream/back/reload.
Известные/подготовленные spells проверяются на каждом уровне, не только на финале.

Приёмка UI/server:390px,keyboard/labels/focus,roles,сбой loader/retry/empty,
storage quota/failure, смена аккаунта и политики, double submit/lost ACK,
same-operation different-payload, RLS/прямой API, два аккаунта и одновременная
смена policy, reload после подтверждённого создания, ни одного частичного листа.
Локальные stubs не заменяют live Supabase smoke. Обязательные npm/spec checks
выполняются для конкретного опубликованного SHA, не переносятся со старого PR.

## Risks / Trade-offs

- [Неполные книги] → отдельный source manifest и доступность, task не закрывается
  одной SRD-порцией. Не-SRD только личный путь.
- [Колонки/таблицы PDF] → source spans, визуальная проверка таблиц/числовые fixtures,
  ручные dispositions; не regex-парсер, выдающий механику без проверки.
- [Client/server расходятся] → общие rules revision/fixtures, серверная проверка
  input choices, P4 до ACK не включается.
- [Чужой незавершённый diff] → не менять #176 новым runtime, занятые файлы только
  после передачи, #117/переводы не дублируются.
- [Private утечка] → refs/проекции, запрет private prose в public/local common cache,
  серверная авторизация; никакой новый private kind без соответствующего SQL.
- [Слишком большой монолит] → отдельные модули данных/чистого resolver/UI/порта,
  ленивые assets и измеримый размер; без нового сборщика и зависимостей.

## Migration Plan

1. Согласовать эту ревизию P1–P3, UI-file handoff и Rules formula port.
2. Завершить review/integration исправленного #176, обычным merge включить свежий
   main в `codex/library`. Не создавать task/plan/review веток.
3. Перенести этот план/дельты в рабочую ветку без изменения содержания согласованной
   ревизии, затем последовательно данные/движок/preview. Каждый интеграционный PR
   имеет свой фиксированный SHA и обязательные проверки.
4. Согласовать конкретный P4 совместно с Rules: только новые неисполненные SQL
   версии после сверки main/live history, schema tests/rollback на local cluster.
   Production SQL/deploy — только по отдельно разрешённому пути интеграции.
5. Включать создание только при доступном подтверждённом command/server rules;
   существующие герои/legacy не мигрируют с потерей неизвестных полей.
6. Rollback кода обычным revert. Черновики новой версии не стирать; серверно
   созданные герои остаются Character, автоматическое удаление их/книг не выполняется.
   Заполненные SQL данные не DROP при откате frontend. Private P5 отдельным выпуском.

## Open Questions

Только детали, не меняющие контракт: точные RU подписи шагов и компактность
карточек после визуальной проверки в существующем дизайне. Все материальные
незакрытые стыки P4/P5 выше выделены как обязательные gates и не считаются
готовыми к apply на основании этого документа.
