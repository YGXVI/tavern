# Витрина экранов героя

Экраны героя (#203) нарисованы по макетам Фигмы (файл tavern, страница `_player`, разделы 14–18 и 22) и работают на **витринных данных** — объектах ровно той формы, которую показывают экраны. Правил и расчётов в экранах нет.

- Экраны: `dist/js/views/hero/` — `index.js` (адреса, «Мои герои», мастер создания, быстрый герой, импорт LSS), `steps.js` (шаги мастера), `sheet.js` (лист, классический лист, лист на карте, корнеры), `levelup.js` (повышение уровня), `parts.js` (общие куски). Стили — `dist/css/hero.css`, картинки — `dist/assets/hero/`.
- Данные: `fixture.js` — образцы (Лира, Торин, корнеры, повышение 5 → 6, импорт LSS, варианты мастера создания).
- **Шов для подключения** — `contract.js`. Экраны берут данные и сообщают о действиях только через него.

## Настоящие данные (#202, 05.11)

- **Подключено:** «Мои герои» (`heroList`) и лист (`heroView`) — свои герои во всех кампаниях; адрес героя `#/hero/<кампания>~<персонаж>` (один персонаж бывает в нескольких кампаниях). Переводчик — `adapter.js` (`toHeroView`, `toHeroCard`): числа из `readCharacter` (лист за столом), заклинания — со справочниками `spells-2014.json` и `spells-ref-2014.json`; у старых героев песочницы заклинания, сумка и умения читаются из текста листа. У настоящего листа `live: true`, пометки «на образце» нет.
- **Действия листа** (`actions.js`, через `updateCampaign` → команды листа на сервере): `setHp` (урон сначала по временным хитам, 0 хитов — без сознания), `roll`, `useResource` (ячейки, умения, кости; старые `slots`), `toggleCondition` (с `id`), `dropConcentration`, `deathSave`, `rest` (короткий — кости хитов; продолжительный — хиты, ячейки, умения, половина костей), `prepare`, `cast` (тратит ячейку), `editField` (`name`, заметки).
- **Ещё на образце:** мастер создания, быстрый герой, повышение уровня, импорт LSS, `addItem`, `bringToCampaign`; черты характера, идеалы и внешность (сервер пока не принимает поле `personality`).
- Экран перерисовывается, когда меняются его данные (`update` в `index.js`).

## Как подключить

1. Заменить тела функций `contract.js` так, чтобы они возвращали объекты той же формы из настоящего персонажа и правил (переводчик из формата персонажа).
2. Заменить заглушки в `heroActions` настоящими командами. Каждая получает простой объект и ничего не возвращает: экран перерисуется по новым данным.
3. Экраны трогать не нужно. Если для настоящих данных не хватает поля — добавить его в витрину и в этот документ.

Лист за столом (`views/table/sheet*.js`) пока старый; новый лист на карте показан превью `#/hero/lira/table`. Переключение стола на новый лист — после подключения данных.

## Адреса

| Адрес | Экран (номер в Фигме) |
| --- | --- |
| `#/heroes` | Мои герои (88) |
| `#/hero/new`, `#/hero/new?quick`, `?lss` | Как привести героя (45) |
| `#/hero/new/race` … `/look` | Пошагово: раса, класс, характеристики, предыстория, снаряжение, заклинания, образ (46–52) |
| `#/hero/new/done` | Героиня готова (53) |
| `#/hero/quick/1` … `/3`, `/done` | Быстрый герой (89–90) |
| `#/hero/import` | Перенос из Long Story Short (72) |
| `#/hero/lira[/magic|skills|bag|person]` | Удобный лист: бой, магия, навыки, сумка, личность (54–58); «откуда число» и короткий отдых — по нажатию (55, 59) |
| `#/hero/lira/classic/1` … `/3` | Классический лист (60) |
| `#/hero/lira/table[/вкладка][?roll|stub|ask|levelup]` | Лист на карте: свой, бросок, магия, корешок, мастер просит проверку, новый уровень (61–66, 73) |
| `#/hero/torin/table` | Чужой герой на карте (64) |
| `?down`, `?concentration`, `?noSlots`, `?multiclass`, `?unfinished` | Корнеры (67–71) |
| `#/hero/lira/levelup/hp|new|spells|done` | Повышение уровня (74–77) |

## Функции `contract.js`

| Функция | Возвращает |
| --- | --- |
| `heroView(id, corner)` | Лист героя — объект `HeroView` (ниже). `corner` — образец корнера, только для превью |
| `heroList()` | `{ heroes: HeroCard[], saved: string[] }` — карточки «Моих героев» и сохранённое из справочника (`saved` — уже настоящее: «В книгу героя» в `#/ref`, ключ `rasputye-ref-v1` на устройстве; пусто — образец) |
| `creationView()` | Всё для мастера создания: `campaign`, `paths`, `steps`, `races`, `classes`, `abilities`, `backgrounds`, `backgroundSkills`, `backgroundLangs`, `equipment`, `spells`, `look`, `done`, `quick` |
| `creationLive(stepId)` | Живой лист справа на шаге: `{ name, summary, portrait?, stats: [{short, mod, score}], facts: [[подпись, значение?, новое?]] }` |
| `levelUpView()` | Повышение: `from`, `to`, `steps`, `hp`, `news`, `spells`, `live`, `done` |
| `lssImportView()` | Разбор файла LSS: `matched`, `issues[{kind: 'warn'|'error', title, text, primary, secondary}]`, `hero`, `file` |

## `HeroView` — лист героя

Все числа уже готовы к показу (строки со знаком: `'+3'`, `'−1'`).

| Поле | Что это |
| --- | --- |
| `id`, `name`, `portrait`, `art` | Имя, круглый портрет (токен), большой портрет |
| `subtitle`, `summary`, `fullTitle` | Подписи: «Волшебница 5 · Человек · Мудрец», «Человек · Волшебница 5», полная строка для итога |
| `race`, `background`, `alignment`, `pronoun` | Строки |
| `classes[]` | `{ name, short, level, sub, hitDie }` — несколько для мультикласса |
| `level`, `xp: {now, next}`, `player`, `isMine` | Уровень, опыт, игрок; `isMine: false` — чужой герой (только то, что открыто отряду, поле `shared`) |
| `campaign` | `{ id, name, live }` или `null` |
| `status` | `ready` · `draft` · `unfinished`; при `unfinished` — `missing: { text, tabs: ['magic', 'person'] }` |
| `vitals` | `hp {now, max, temp}`, `ac {value, note}`, `init`, `speed`, `prof`, `size`, `carry`, `jump {long, high}`, `passive {perception, insight, investigation}`, `deathSaves {ok, fail}`, `inspiration`, `exhaustion`, `hitDice {left, total, die}` |
| `concentration` | `{ spell }` или `null` |
| `conditions[]` | `{ id, name }` |
| `abilities[]` | `{ key, short, name, score, mod, save, saveProf }` |
| `skills[]` | `{ name, ab, mod, prof: 'none' | 'prof' | 'expert' }` |
| `resources[]` | `{ id, name, kind: 'slot' | 'use', total, left }` — ячейки (ромбы) и умения/кости хитов (точки) |
| `economy[]` | `{ name, left }` — действие, бонусное, реакция, движение |
| `actions` | `{ action[], bonus[], reaction[], special[] }`, строка: `{ id, name, sub, icon: 'spell' | 'weapon' | 'feature', hit?, dc?, dmg?, slotLevel?, explain? }`; `{ empty: true, name, action }` — заглушка «Заклинаний пока нет» |
| `spellcasting` | `{ ability, short, mod, dc, attack, prepared {now, max}, book {now, max}, spells[] }`; заклинание: `{ id, name, level, school, time, range, comp, duration, prepared, conc?, ritual?, dc?, dice?, meta?, text, srd }` или `null` |
| `inventory` | `{ load {now, max}, coins {pp, ep, gp, sp, cp}, equipped[], pack[], attunement[] }`; предмет: `{ name, sub, tag?, qty, icon }` |
| `features[]` | `{ name, source, text }` |
| `traits[]` | Черты расы и предыстории строками |
| `proficiencies` | `armor {light, medium, heavy, shield}`, `weapons {simple, martial, other}`, `languages`, `tools`, `weaponsText` |
| `personality` | `traits`, `ideals`, `bonds`, `flaws`, `backstoryTitle`, `backstory`, `appearance`, `allies[{name, text}]`, `goals[]`, `extra[{name, text}]`, `treasures[]`, `notes[]` |
| `explain` | Подсказки «откуда число» по ключам `ac`, `init`, `hp`, `dc`, `attack.<id>`, `save.<key>`: строка вида «к20 + 7 = Интеллект +4 · мастерство +3» |

Поля только для корнеров (появятся из настоящего состояния): `down` (без сознания — действия гаснут), `notice` (строка рядом с состояниями), `concCheck { spell, damage, dc, roll, text }`, `noSlot { level, title, text, can }`, `log { title, sub, portrait }` (последний бросок на столе).

## Действия `heroActions`

| Действие | Поля |
| --- | --- |
| `createFrom` | `{ path: 'steps' | 'quick' | 'lss' }` |
| `choose` | `{ step, id, value }` — любой выбор в мастере создания или быстром герое |
| `finish` | `{ draftId }` |
| `bringToCampaign` | `{ heroId, campaignId }` |
| `setHp` | `{ heroId, delta, temp }` |
| `roll` | `{ heroId, what, formula }` |
| `useResource` | `{ heroId, id }` |
| `toggleCondition`, `dropConcentration`, `deathSave` | `{ heroId, id? }` |
| `rest` | `{ heroId, kind: 'short' | 'long', hitDice, recover: [уровни ячеек] }` |
| `prepare` | `{ heroId, spellId, prepared }` |
| `cast` | `{ heroId, spellId, slot?, pickSlot? }` |
| `editField` | `{ heroId, field, value }` — правки листа, меню «ещё», портрет |
| `addItem` | `{ heroId }` |
| `levelUp` | `{ heroId, hp?: 'average' | 'roll', spells?: [names], auto?, done? }` |
| `importLss` | `{ decisions: { [номер расхождения]: 'primary' | 'secondary' }, later? }` |

Выборы мастера создания и быстрого героя до подключения хранятся только в `sessionStorage` вкладки (ключ `rasputye-hero-draft`) и в данные кампании не попадают.
