# Контракт каталогов: передача A–B → C–D

TASK-129 / #151. Эта ревизия реализует данные и API; интерфейс и запись экземпляров в Character остаются у Claude / исполнителя TASK-004. План bd69699 + 377d673 подтверждён Ярой и sol0139 в #129. Примеры реального формата: [examples/catalogues.json](examples/catalogues.json). Канонические сущности/хранение — [data.md](data.md).

## Публичные данные

`dist/js/data/features-2014.json` и `magic-items-2014.json` имеют envelope `{schemaVersion:1,catalogueKind:'feature'|'magic_item',edition:'5e-2014',revision,attribution,sources,sourceHashes,coverage,entries}`. Revision — SHA256 входов и генератора; это версия данных для provenance, не версия листа. Loader возвращает глубоко замороженные записи. Личные шаблоны в этот кэш не попадают, fetch отправляется с credentials=omit.

AbilityEntry: `{id,edition,kind,name:{ru,en},text:{en,ru:null},scope,level,prerequisiteText,actionType,source,review}`. kind = class_feature/subclass_feature/racial_trait/feat/option, а в публичном каталоге также background_feature (TASK-186). Личные шаблоны и SQL этот вид не принимают. Scope содержит classId/subclassId, raceId/subraceId либо backgroundId, и при необходимости parentId. ID явно зафиксирован в manifest, пример `srd51:feature:fighter:archery`. Одинаковое имя не означает одинаковую сущность. `source` содержит kind=srd51, hash PDF, url с #page, license и точные spans. Подписи классов/рас/подклассов/подрас находятся в `catalogue.scopes`; подклассы индексируются classId:subclassId, подрасы raceId:subraceId. У option показывать контекст родителя по scope.parentId;20 вариантов драконьего происхождения происходят из явных строк двух таблиц, не из придуманных правил.

Покрытие392 записей /731 кандидат (711 заголовков +20 табличных выборов; +1 особенность предыстории Acolyte в TASK-186 P1b) и ограничения — [data/features/README.md](../data/features/README.md). Неизвестный уровень/actionType остаётся null; никакого автоматического развития класса, исполнения текста или расхода ресурсов нет. RU-названия собственные, проза оригинальная EN. `review.required=false` означает проверенную границу извлечения, не человеческое одобрение PR или автоматизацию механики.

MagicItemEntry сохраняет все прежние поля/ID `data/magic-items/magic-items-2014.json`, добавляя только `source.kind='srd2014'|'metadata'`. 934 ID =221 SRD +713 metadata-only;98 вложенных вариантов сохраняют прежние id и srd_index. `technical` включает исходные дальности/длительности/цены/веса/заряды/бонусы, без выдуманных значений; null, false,0 не склеиваются. Metadata-only description.ru/en остаются null; показывать «Описание не включено», не пустую SRD-карточку. Все источники/publications и признаки review сохранены. Исходные JSON/SQLite не перезаписываются.

## API публичного каталога

Импорт из `dist/js/core/catalogues.js`:

```js
const catalogue = await loadCatalogue('feature');
const rows = queryCatalogue(catalogue, { query: 'темное зрение', raceId: 'elf' });
const preview = catalogueSnapshot(catalogue, rows[0].id);
// preview = {data: независимая копия, catalogueRef:{kind,id,revision}}
```

`loadCatalogue(kind)` — лениво, один запрос для параллельных вызовов, повтор после ошибки разрешён. `reloadCatalogue(kind)` явно сбрасывает публичный кэш; старый in-flight ответ не заменяет новый кэш. Ошибка запроса/формата отклоняет Promise, пустой успешный каталог возвращает entries=[]; эти состояния различать в UI. `createCatalogueLoader({fetcher,urls})` позволяет внедрить адаптер теста.

`queryCatalogue(catalogue, filters)` возвращает новый массив неизменяемых записей. query ищет по RU/EN названию и тексту; регистр/Unicode/ё-е нормализуются только для поиска. Совместные фильтры: kind (категория способности), classId,subclassId,raceId,subraceId,level; type (type.code предмета),rarity (rarity.code),attunement (true/false/null),hasDescription; source (source.kind или publication.id). Отсутствующий фильтр отключён; явно переданный level:null выбирает неизвестный уровень. Сброс — filters={}.

`catalogueSnapshot(catalogue,id,{variantId})` возвращает `{data,catalogueRef}` для превью. У предмета с variants требуется **существующий srd_index** в variantId. Он фиксируется в catalogueRef.variantId, точная вложенная запись находится в data.selectedVariant; родительский шаблон и его variants сохранены для происхождения. Нельзя выдавать технические поля родителя за параметры выбранного варианта — использовать выбранный variant. Нет скрытого выбора первого варианта, equipped/attuned/quantity, нового instance ID или записи Character. Текст и source в data — снимок, не живая ссылка на каталог.

## Личные шаблоны

Оболочка `{id,ownerId,kind:'feature'|'magic_item',data,revision,updatedAt}`. Поля оболочки не дублируются в data. Data — типизированная ручная запись с edition=5e-2014 и source.kind=manual. Для feature обязательны name и text (хотя бы один язык), category kind; для magic_item — name/description; нормализатор дополняет неизвестные значения null/пустыми коллекциями, не создавая численных бонусов. `normalizeManualCatalogueData`, `validateCatalogueEntry`, `validatePrivateCatalogueEntry` — чистые функции в rules/catalogue.js. Неверные JSON/типы/пропуски/циклы/getters не скрываются; ошибки содержат пути полей. Ограничение64KiB считается по UTF-8 data; JSONB-сериализация базы может отвергнуть пограничную запись раньше из-за пробелов.

Импорт из `core/catalogue-library.js`:

```js
const saved = await saveCatalogueTemplate({
  kind: 'feature', data: {name:{ru:'Моё умение'}, text:{ru:'Мой текст'}}
}); // новый ID/владелец, revision1; возвращается ACK
const changed = await saveCatalogueTemplate({...saved, data:{...saved.data, text:{ru:'Изменено',en:null}}});
await deleteCatalogueTemplate(changed.id, changed.revision);
```

`listCatalogueTemplates({kind?})`, `saveCatalogueTemplate(value)`, `deleteCatalogueTemplate(id,expectedRevision)` возвращают Promise. Для создания revision отсутствует или0, для изменения — фактическая прочитанная revision. Сервер пишет только через save_catalogue_entry/delete_catalogue_entry; direct table writes запрещены. В обоих RPC p_owner передаёт ожидаемый аккаунт фасада и сравнивается с auth.uid перед доступом: смена JWT после getUser не перенесёт действие старого аккаунта в новый. Это проверка контекста, не выбор владельца данных. CAS-конфликт имеет code=CATALOGUE_CONFLICT: перечитать запись и показать новое превью, не перезаписывать чужое изменение. Успешный save возвращает ровно revision+1. Kind существующего ID неизменяем. Квота500 общая для обоих типов, отдельная от Creature; scoped PK допускает одинаковый ID разных владельцев. **ID шаблона не переиспользуется владельцем** (#176, sol0139-pr176-id-policy-1): после удаления create(revision0) того же ID любого kind — CATALOGUE_CONFLICT без записи; восстановление/копия получают новый ID. Поэтому устаревший save/delete после delete/recreate не попадает в новую запись.

`privateCatalogueSnapshot(saved)` копирует только один сохранённый шаблон и возвращает ссылку `{kind,id:'user:<ownerId>:<id>',revision:'<number>'}`. Это provenance, не публично разрешаемый ключ. Копия не удаляется при удалении шаблона. До записи листа C/D показывают получателя и видимость текста участникам. Не записывать всю личную библиотеку в campaign/Character и не передавать её публичному loader. Ошибки сервера очищены от backend details с личной прозой. При смене пользователя/режима старый async результат отклоняется; локального кэша серверной библиотеки нет.

Песочница использует owner/id ключи root catalogueEntries в rasputye-v2-db с прежними version/campaigns/creatures; использованные ID — root catalogueEntryIds с теми же ключами, пишется одним setItem вместе с записью. Живые записи, сохранённые до реестра, регистрируются при следующей записи владельца; ID, удалённые до реестра, восстановить нельзя. Проверяет ожидаемую ревизию последней локальной записи, возвращает ошибку localStorage; защищённую серверную авторизацию/межпроцессную транзакцию это не заменяет. Тестовые фабрики createCatalogueLibrary/createServerCatalogueLibrary принимают адаптеры.

## Параметры создания героя (TASK-186 P1)

`dist/js/data/character-options-2014.json` — публичный каталог `catalogueKind:'character_option'` в той же оболочке v1 (`schemaVersion/edition/revision/sourceHashes/coverage/entries`), загружается тем же `loadCatalogue('character_option')`. Личные шаблоны этот вид не принимают: `CATALOGUE_KINDS` (private) по-прежнему `feature`/`magic_item`, публичный список — `PUBLIC_CATALOGUE_KINDS`. Объём — только SRD-пакет (12 классов × 20 уровней, 12 подклассов, 9 рас, 4 подрасы, Acolyte, Grappler), покрытие и проверки — [data/character-options/README.md](../data/character-options/README.md).

**Definition** `{id,kind,name,aliases,source,review,featureRefs,grants,choices}`; kind = class/subclass/race/subrace/background/feat, ID `srd51:<kind>:<slug>` (подкласс/подраса — `srd51:subclass:<class>:<id>`, `srd51:subrace:<race>:<id>`). У класса есть `class{hitDie,savingThrows,spellcasting,subclassLevel,subclassFeatureLevels,asiLevels,columns,multiclass}` и ровно 20 строк `progression[{level,proficiencyBonus,values,spellSlots,subclassFeature,grants,choices}]`; у подкласса — `classId`, `selectionLevel`, `optionRef` и 20 строк по **уровню класса**. Уровень всегда уровень соответствующего класса; общий уровень персонажа используется только в предикате `characterLevel` (например, заклинания тифлинга). `null` — неизвестно/нет значения в таблице, не 0.

**Grant** `{id,kind,…}` — устойчивый ID, повторная оценка не начисляет его второй раз. kind: feature{ref}, proficiency{category,value}, language, ability_increase{ability,value,maximum?}, size, speed, sense, resistance, hit_points{perClassLevel|perCharacterLevel}, spell{ref,…,prerequisites?}, spell_list_addition{ref,spellLevel}, item{ref|filter,quantity}, currency{unit,value}. Стартовое снаряжение лежит отдельно в `startingEquipment{grants,choices}` класса и предыстории; у класса оно выдаётся только первым классом. **Choice** `{id,kind,count,options|from|spellFilter,featureRef?,distinct,optional?,replacementPolicy?}`; kind: skill, tool, language, expertise, feature_option (варианты — ID опций #176), subclass, subrace, asi_or_feat, spell, ability_increase, favored_enemy, terrain, equipment (`alternatives[{id,items,requiresProficiency?}]`, count 1). **Предикаты** — закрытый набор `all/any/not/classLevel/characterLevel/abilityMinimum/hasFeature/hasSpell/sourceEnabled/unique`; неизвестный оператор — ошибка валидации, исполняемых строк нет. Черта доступна только через `asi_or_feat` при `sourceEnabled:'rule:feats'`.

Пример (реальная строка Fighter 3):

```json
{"level":3,"proficiencyBonus":2,"values":{},"spellSlots":null,"subclassFeature":false,
 "grants":[{"id":"srd51:class:fighter:L3:feature:martial-archetype","kind":"feature","ref":"srd51:feature:fighter:martial-archetype"}],
 "choices":[{"id":"srd51:class:fighter:L3:subclass","kind":"subclass","count":1,"options":["srd51:subclass:fighter:champion"],"featureRef":"srd51:feature:fighter:martial-archetype","distinct":true}]}
```

Снаряжение — отдельный публичный каталог `loadCatalogue('equipment')` (`dist/js/data/equipment-2014.json`): оружие, доспехи, снаряжение, инструменты и наборы SRD с точными ценами (`cp`) и весом; формат и проверки — [data/equipment/README.md](../data/equipment/README.md).

`validateCharacterOption`, `resolveCharacterOptionRefs` и `validateEquipmentEntry` (`dist/js/rules/character-options.js`) — чистые функции без DOM/store/RNG/eval. Каталог описывает допустимые варианты; порядок решений, проверка истории уровней и инвалидация зависимых выборов — движок P2, запись героя — путь TASK-004 после согласования DTO с «Правилами».

## Движок сборки героя (TASK-186 P2)

`dist/js/rules/character-builder.js` — чистые функции без DOM/store/сети/RNG/eval и без часов: одинаковый вход всегда даёт одинаковую оценку. Формулы листа TASK-004 не повторяются. Единственная нужная — модификатор характеристики для числа подготовленных заклинаний — передаётся портом `ports.abilityModifier`. По умолчанию это существующий `mod()` из `data/rules.js`, где неизвестное значение остаётся `null`; после #156 порт переключается на экспорт «Правил» по согласованию с ними.

- `defaultCreationContext()` — политика новой кампании по плану r1: 5e-2014, SRD, уровень 1, стандартный набор, один класс, стартовые наборы; черты, мультикласс, покупка очков и перенос расовых бонусов выключены. `creationContextFromCampaign(campaign, policy?)` показывает прежний `campaign.level` как notice для подтверждения мастером и не применяет его сам; 0, NaN и >20 — ошибка. Перенос расовых бонусов (TCE) этой ревизией не поддержан, и включённый флаг — ошибка, а не тихое игнорирование.
- `createDraft()` — `BuildDraft {schemaVersion:1,draftId,accountScope,mode,campaignId,policyRevision,rulesRevision,identity,abilityMethod,baseScores,rollReceipts,ancestry,background,levelHistory[{classId}],selections,manualOverrides,invalidationLog}`. `selections` хранит решения по устойчивым ID выборов каталога: массив вариантов; `{type:'asi',increases}` / `{type:'feat',featId}`; для снаряжения `{alternative,picks}`. Заклинания класса имеют синтетические ID `<class>:spells:cantrips|known|spellbook|prepared`.
- `evaluateBuild(context, {options,spells,equipment,features}, draft, ports?)` → `{status:'valid'|'incomplete'|'invalid', choices, grants, derivedInputs, errors, warnings, missing, sourceTrace}`. Порядок: политика → характеристики и расовые прибавки → предыстория → события уровней по порядку. Подкласс, ASI и варианты считаются по уровню **своего** класса; предпосылки мультикласса, черт и вариантов (например, воззваний) проверяются на момент события, без ещё не полученных прибавок. Владения: сначала фиксированные выдачи; дубликат навыка или инструмента получает выбор замены того же вида (SRD стр. 60); выбор уже имеющегося владения — ошибка с причиной. Заклинания: известные и книга ограничены кругом из таблицы **своего** класса, общие ячейки мультикласса этого не расширяют; ячейки договора — отдельно. Стартовое снаряжение даёт только первый класс и предыстория.
- `derivedInputs` — входы для листа (итоговые и базовые характеристики, след прибавок, классы, PB, владения, языки, особенности, заклинания, ячейки, входы хитов, снаряжение). HP/КД/атаки считает TASK-004.
- `proposeBuildChange(draft, change, …)` — предпросмотр изменения (setRace/setSubrace/setBackground/setLevelHistory/setAbilityMethod/setBaseScores/setRollReceipts/setSelection/setIdentity/rebase): затронутые решения и что сохранено. Ничего не удаляется. `confirmBuildChange(proposal)` убирает затронутые выборы в `invalidationLog` с прежним значением.
- `toCreationProposal(evaluation, draft, {operationId, characterId})` — DTO порта P4 (план r1 D6); только при `valid`. ID задаёт вызывающий и хранит для повтора; производные значения в DTO не передаются. Это не готовая серверная команда: формат и идемпотентность согласуются с «Правилами» (#61).

`manualOverrides` переносятся в черновике и DTO, но движок их не применяет: мастерские исключения — часть P4 с серверной проверкой. Проекция заклинаний: `loadCatalogue('spell')` → `dist/js/data/spells-2014.json` (без текста; `srd` отмечает 319 заклинаний SRD 5.1: 308 по ссылке API, 11 по проверенным псевдонимам).


Экземпляр Character получает **свой instance ID**, источник — catalogueRef, текст — выбранный снимок. Состав полей и CAS/operationId листа согласует D с TASK-004; API каталога не пишет characters.data, не импортирует sheet/store model sync для этого и не меняет КБ/атаки/ресурсы. Отмена превью ничего не сохраняет. Владелец/мастер и управляющий ресурсами остаются разными правами.

Воспроизведение: `node data/catalogues/generate_items.mjs`, Python/pdfplumber `data/features/generate.py`, затем `node data/catalogues/generate_examples.mjs`; никаких новых сетевых источников. Unit/data — `tests/catalogues.test.js`, `tests/catalogue-library.test.js`; SQL — собственный блок `supabase/tests/rls.sql` и `python3 tests/postgres/library_harness.py` с `catalogue_checks.py`. Последний создаёт отдельный локальный PostgreSQL, проверяет настоящие RLS/CAS/гонки/каскады со schema stubs; это не HTTP Supabase. Рабочие миграции не применяются этой порцией. Uploads библиотеки остаются закрытыми до отдельного живого Storage smoke. UI/узкий экран/клавиатура/подтверждение и запись листа проверяются при C/D; этот handoff их готовность не подтверждает.
