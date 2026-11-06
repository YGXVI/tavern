# Образцы выгрузок Long Story Short (для переноса героя, #203)

Собраны по формату, который пишет конвертер Foundry → LSS ([elfrey-lss-converter](https://github.com/Elfrey/elfrey-lss-converter), `src/module/convert.js`): внешний объект `{ data: "<JSON строкой>", spells: { mode, prepared, book }, jsonType: "character", version: "2" }`, внутри — `info`, `stats`, `saves`, `skills`, `vitality`, `spells` (`slots-N: { value, filled }`), `spellsPact`, `spellsInfo`, `text` (документы редактора: `prof`, `equipment`, `items`, `attacks`, `features`, `traits`, `spells-level-N`, `background`, `personality`, `ideals`, `bonds`, `flaws`), `subInfo`, `coins`, `weaponsList` (`name`, `mod`, `dmg`, `ability`, `isProf`), `resources` (`name`, `current`, `max`, `isShortRest`, `isLongRest`).

- `lira-converter.json` — волшебница 5 ур.: интерактивные атаки (`weaponsList`), ресурс «Магическое восстановление», потраченные ячейки (`filled`), временные хиты, `items` вместе с `equipment`, `subInfo`.
- `torin-multi.json` — мультикласс «Воин (3) / Жрец (2)», кости `multiclass` + `hp-dice-multi`, атаки текстом (`text.attacks`), магия жреца в `spellsInfo`.
- `lira-cards.json` — заклинания карточками (`spells.mode: "cards"`, `book`/`prepared` во внешнем объекте), без `weaponsList` и `resources`.
- `knight-site-export.json`, `sorcerer-site-export.json`, `paladin-site-export.json`, `cleric-site-export.json` — **по форме четырёх настоящих выгрузок с сайта LSS** (воин, чародей, паладин, жрец; ноябрь 2026). Содержимое выдуманное: файлы игроков в Git не кладём, в них записи сессий.

## Что показали настоящие выгрузки (06.11.2026, четыре файла)

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
- `skills[].isProf` — числа 0/1 или нет поля (экспертизы в файлах нет, считаем 2), `saves[].isProf` — true/false.
- Ячейки `spells.slots-N { value, filled }`: **`filled` — потраченные** (у свежего паладина с полными хитами 0, у чародея 1 из 4 и 2 из 3); без `filled` — 0. Старые ключи `level-N-slot-K { isChecked }` и `spell-N-K { isReady }` встречаются рядом.
- `customModifier` у навыка или спасброска — **своё итоговое значение** (рядом есть отдельное `bonus` — прибавка); `customPassive` — своё пассивное. `vitality.initiative` — своя инициатива. `spellsInfo.mod.customModifier` / `save.customModifier` — свои бонус атаки и СЛ заклинаний.
- `vitality.shield { value, mod }` — кнопка щита: при `value: true` к КД прибавляется `mod` (без него +2; чародей поставил `"0"` и записал щит поправкой `bonuses` с `target: "ac"`).
- `weaponsList[].mod` — `"+0"` (не задано), `modBonus.value` — итог атаки, если задан (жрец: 8 и заметка «д20 + 8»); урон бывает «1к4 +2 колющий», «1d4+4 рубящий», «1к8 (1к10) +5».
- Тексты бывают документом редактора, HTML-строкой (`<p>…</p>`) или просто строкой (`{ value: { data: "…" } }`); `text.appearance` — внешность. Умения встречаются и простыми абзацами «Название. Текст», и жирным названием с описанием следующим абзацем, и курсивом «1-й уровень, умение домена» под названием.
- `info.charClass` бывает со строчной буквы («чародей»), `subInfo` — строками или числами, `coins.total` может не совпадать с монетами (тогда монеты главнее).

Первые три образца собраны по конвертеру Foundry → LSS (у него `mod` — итог атаки). Ещё не сверено с настоящим файлом: экспертиза в `skills` (вероятно `isProf: 2`), непустые `resources`, мультикласс и ячейки договора с сайта.
