# Образцы выгрузок Long Story Short (для переноса героя, #203)

Собраны по формату, который пишет конвертер Foundry → LSS ([elfrey-lss-converter](https://github.com/Elfrey/elfrey-lss-converter), `src/module/convert.js`): внешний объект `{ data: "<JSON строкой>", spells: { mode, prepared, book }, jsonType: "character", version: "2" }`, внутри — `info`, `stats`, `saves`, `skills`, `vitality`, `spells` (`slots-N: { value, filled }`), `spellsPact`, `spellsInfo`, `text` (документы редактора: `prof`, `equipment`, `items`, `attacks`, `features`, `traits`, `spells-level-N`, `background`, `personality`, `ideals`, `bonds`, `flaws`), `subInfo`, `coins`, `weaponsList` (`name`, `mod`, `dmg`, `ability`, `isProf`), `resources` (`name`, `current`, `max`, `isShortRest`, `isLongRest`).

- `lira-converter.json` — волшебница 5 ур.: интерактивные атаки (`weaponsList`), ресурс «Магическое восстановление», потраченные ячейки (`filled`), временные хиты, `items` вместе с `equipment`, `subInfo`.
- `torin-multi.json` — мультикласс «Воин (3) / Жрец (2)», кости `multiclass` + `hp-dice-multi`, атаки текстом (`text.attacks`), магия жреца в `spellsInfo`.
- `lira-cards.json` — заклинания карточками (`spells.mode: "cards"`, `book`/`prepared` во внешнем объекте), без `weaponsList` и `resources`.

Это не настоящие выгрузки с сайта LSS: значения `filled`, формат `book` и экспертизы в `skills` нужно сверить с настоящим файлом.
