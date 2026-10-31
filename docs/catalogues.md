# Контракт каталогов: передача A–B → C–D

TASK-129 / #151. Эта ревизия реализует данные и API; интерфейс и запись экземпляров в Character остаются у Claude / исполнителя TASK-004. План bd69699 + 377d673 подтверждён Ярой и sol0139 в #129. Примеры реального формата: [examples/catalogues.json](examples/catalogues.json). Канонические сущности/хранение — [data.md](data.md).

## Публичные данные

`dist/js/data/features-2014.json` и `magic-items-2014.json` имеют envelope `{schemaVersion:1,catalogueKind:'feature'|'magic_item',edition:'5e-2014',revision,attribution,sources,sourceHashes,coverage,entries}`. Revision — SHA256 входов и генератора; это версия данных для provenance, не версия листа. Loader возвращает глубоко замороженные записи. Личные шаблоны в этот кэш не попадают, fetch отправляется с credentials=omit.

AbilityEntry: `{id,edition,kind,name:{ru,en},text:{en,ru:null},scope,level,prerequisiteText,actionType,source,review}`. kind = class_feature/subclass_feature/racial_trait/feat/option. Scope содержит classId/subclassId либо raceId/subraceId, и при необходимости parentId. ID явно зафиксирован в manifest, пример `srd51:feature:fighter:archery`. Одинаковое имя не означает одинаковую сущность. `source` содержит kind=srd51, hash PDF, url с #page, license и точные spans. Подписи классов/рас/подклассов/подрас находятся в `catalogue.scopes`; подклассы индексируются classId:subclassId, подрасы raceId:subraceId. У option показывать контекст родителя по scope.parentId;20 вариантов драконьего происхождения происходят из явных строк двух таблиц, не из придуманных правил.

Покрытие391 записей /729 кандидатов (709 заголовков +20 табличных выборов) и ограничения — [data/features/README.md](../data/features/README.md). Неизвестный уровень/actionType остаётся null; никакого автоматического развития класса, исполнения текста или расхода ресурсов нет. RU-названия собственные, проза оригинальная EN. `review.required=false` означает проверенную границу извлечения, не человеческое одобрение PR или автоматизацию механики.

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

`listCatalogueTemplates({kind?})`, `saveCatalogueTemplate(value)`, `deleteCatalogueTemplate(id,expectedRevision)` возвращают Promise. Для создания revision отсутствует или0, для изменения — фактическая прочитанная revision. Сервер пишет только через save_catalogue_entry/delete_catalogue_entry; direct table writes запрещены. В обоих RPC p_owner передаёт ожидаемый аккаунт фасада и сравнивается с auth.uid перед доступом: смена JWT после getUser не перенесёт действие старого аккаунта в новый. Это проверка контекста, не выбор владельца данных. CAS-конфликт имеет code=CATALOGUE_CONFLICT: перечитать запись и показать новое превью, не перезаписывать чужое изменение. Успешный save возвращает ровно revision+1. Kind существующего ID неизменяем. Квота500 общая для обоих типов, отдельная от Creature; scoped PK допускает одинаковый ID разных владельцев.

`privateCatalogueSnapshot(saved)` копирует только один сохранённый шаблон и возвращает ссылку `{kind,id:'user:<ownerId>:<id>',revision:'<number>'}`. Это provenance, не публично разрешаемый ключ. Копия не удаляется при удалении шаблона. До записи листа C/D показывают получателя и видимость текста участникам. Не записывать всю личную библиотеку в campaign/Character и не передавать её публичному loader. Ошибки сервера очищены от backend details с личной прозой. При смене пользователя/режима старый async результат отклоняется; локального кэша серверной библиотеки нет.

Песочница использует owner/id ключи root catalogueEntries в rasputye-v2-db с прежними version/campaigns/creatures. Проверяет ожидаемую ревизию последней локальной записи, возвращает ошибку localStorage; защищённую серверную авторизацию/межпроцессную транзакцию это не заменяет. Тестовые фабрики createCatalogueLibrary/createServerCatalogueLibrary принимают адаптеры.

## Граница C–D и проверки

Экземпляр Character получает **свой instance ID**, источник — catalogueRef, текст — выбранный снимок. Состав полей и CAS/operationId листа согласует D с TASK-004; API каталога не пишет characters.data, не импортирует sheet/store model sync для этого и не меняет КБ/атаки/ресурсы. Отмена превью ничего не сохраняет. Владелец/мастер и управляющий ресурсами остаются разными правами.

Воспроизведение: `node data/catalogues/generate_items.mjs`, Python/pdfplumber `data/features/generate.py`, затем `node data/catalogues/generate_examples.mjs`; никаких новых сетевых источников. Unit/data — `tests/catalogues.test.js`, `tests/catalogue-library.test.js`; SQL — собственный блок `supabase/tests/rls.sql` и `python3 tests/postgres/library_harness.py` с `catalogue_checks.py`. Последний создаёт отдельный локальный PostgreSQL, проверяет настоящие RLS/CAS/гонки/каскады со schema stubs; это не HTTP Supabase. Рабочие миграции не применяются этой порцией. Uploads библиотеки остаются закрытыми до отдельного живого Storage smoke. UI/узкий экран/клавиатура/подтверждение и запись листа проверяются при C/D; этот handoff их готовность не подтверждает.
