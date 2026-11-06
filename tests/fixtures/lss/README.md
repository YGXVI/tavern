# Образцы выгрузок Long Story Short (для переноса героя, #203)

Собраны по формату, который пишет конвертер Foundry → LSS ([elfrey-lss-converter](https://github.com/Elfrey/elfrey-lss-converter), `src/module/convert.js`): внешний объект `{ data: "<JSON строкой>", spells: { mode, prepared, book }, jsonType: "character", version: "2" }`, внутри — `info`, `stats`, `saves`, `skills`, `vitality`, `spells` (`slots-N: { value, filled }`), `spellsPact`, `spellsInfo`, `text` (документы редактора: `prof`, `equipment`, `items`, `attacks`, `features`, `traits`, `spells-level-N`, `background`, `personality`, `ideals`, `bonds`, `flaws`), `subInfo`, `coins`, `weaponsList` (`name`, `mod`, `dmg`, `ability`, `isProf`), `resources` (`name`, `current`, `max`, `isShortRest`, `isLongRest`).

- `lira-converter.json` — волшебница 5 ур.: интерактивные атаки (`weaponsList`), ресурс «Магическое восстановление», потраченные ячейки (`filled`), временные хиты, `items` вместе с `equipment`, `subInfo`.
- `torin-multi.json` — мультикласс «Воин (3) / Жрец (2)», кости `multiclass` + `hp-dice-multi`, атаки текстом (`text.attacks`), магия жреца в `spellsInfo`.
- `lira-cards.json` — заклинания карточками (`spells.mode: "cards"`, `book`/`prepared` во внешнем объекте), без `weaponsList` и `resources`.
- `knight-site-export.json` — **по форме настоящей выгрузки с сайта LSS** (воин 5 ур., ноябрь 2026). Содержимое выдуманное: сам файл игрока в Git не кладём, в нём записи сессий.

## Что показала настоящая выгрузка (06.11.2026)

- Внешний объект: кроме `data`/`spells`/`jsonType`/`version` есть `edition: "2014"`, `sheetEdition: "2024"`, `spells.edition`, `rooms`, `linkAccess`, `lastWriterSessionId`, `vortexColor`, `wizard`, `disabledBlocks` — служебное, не переносится.
- `spells.mode: "cards"`: `prepared`, `book`, `granted`, `slotless` — **внутренние номера LSS** (24 hex-символа), не названия и не SRD-ключи. Сопоставить с нашим справочником нельзя.
- `info.charSubclass` — подкласс отдельным полем. `info.level` — число, `charClass` без «(N)».
- `bonuses[]`: `{ target: "weapon.<id>.attack", expr: "1" }` и `{ target: "stat.int.score", expr: "19", mode: "set", kind: "override", label }` (предмет задаёт значение характеристики, а `stats.int.score` остаётся базовым).
- `weaponsList[]` без `mod` и `ability`; урон с подстановкой характеристики: `"1d10+[STR]+1"`.
- `attunementsList[] { value, checked }` — настроенные предметы.
- `text.attacks` может быть свободным списком вещей и заметок, без единой атаки.
- `text.traits` — названия умений жирным, по одному на абзац, без описаний; `text.features` — «*Название.* описание» в одном абзаце, строки таблицы («1 - …») — продолжение предыдущего умения.
- `text.feats` — черты; `text.allies`, `text.quests`; заметки `notes-1` … `notes-6`.
- `text.prof` — строки «Знание языков:», «Сопротивление к:», «Доспехи:», «Оружие:», «Инструменты от класса:», «Инструменты от предыстории:»; рядом в корне `prof { armor-light|medium|heavy, weapon-simple|martial: { value } }`.
- `coins.total` при нулевых монетах — общий счёт без разбивки.
- `avatar { jpeg, webp }` — ссылки на сервер LSS. `exhaustion` — строка, `inspiration`, `vitality.darkvision`, `vitality.shield`.
- `skills[].isProf` — числа 0/1 (экспертизы в этом файле нет), `saves[].isProf` — true/false.

Первые три образца — не настоящие выгрузки. Ещё не сверено с настоящим файлом: `filled` у ячеек (у воина ячеек нет; конвертер при полном отдыхе пишет `filled` = `value`), экспертиза в `skills` (вероятно `isProf: 2`), `resources`.
