# Proposal

## Задача и участники

- TASK-ID: TASK-039 · Issue [#66](https://github.com/YGXVI/tavern/issues/66).
- Автор: sol0139 + Claude Code (облачная сессия sol0139). Проверяющий: Яра — при слиянии пачки в `main`. Интегратор: Claude по DEC-013.
- Ветка `claude/dev` (DEC-013), база `main` `a9c92e6`.

## Why

sol0139 (30.10 09:35 +05:00, со снимком блока «Edit Stats»): «давай еще в токенах добавим такую штуку после ПКМ или троеточия внизу».

## What Changes

- Сверху меню токена (ПКМ и «⋮» в рамке) — блок параметров: хиты «сейчас / максимум», временные хиты, КД. Правка на месте: Enter или уход с поля; в хиты можно вписать «−5» (урон) или «+3» (лечение).
- Мастер правит любой токен с хитами, игрок — своего героя; у предметов блока нет. Всё отменяется Ctrl+Z.
- `menu()` в `ui/kit.js` принимает шапку (`header`, `onOpen`).

## Capabilities

### Modified Capabilities
- `maps`: параметры токена в меню.

## Impact

- `dist/js/views/table/p-token.js` (`statsBlock`, `setStat`, `bindStats`), `dist/js/ui/kit.js` (`menu`: шапка), `dist/css/table.css`.
- Поля прежние (`hp`, `hpMax`, `tempHp`, `ac` — у героя в листе, у существа на токене). Откат — revert commit.
