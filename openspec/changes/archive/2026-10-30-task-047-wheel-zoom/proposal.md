# Proposal

## Задача и участники

- TASK-ID: TASK-047 · Issue [#76](https://github.com/YGXVI/tavern/issues/76) — исправление TASK-036 (#63) по замечанию автора.
- Автор: sol0139 + Claude Code (облачная сессия sol0139). Проверяющий: Яра — при слиянии пачки в `main`. Интегратор: Claude по DEC-013.
- Ветка `claude/dev` (DEC-013), база `main` `ecc3cac`.

## Why

sol0139 (30.10 10:51 +05:00) о TASK-036: «наоборот, чтоб колесо приближение было, перемещение через пробел».

## What Changes

- Колесо мыши — снова масштаб к курсору; Ctrl/Cmd + колесо и щипок — тоже масштаб.
- Двигать карту — пробел + перетаскивание, правая или средняя кнопка, на тачпаде — два пальца. Shift + колесо больше ничего особого не делает.
- Справка обновлена.

## Capabilities

### Modified Capabilities
- `maps`: колесо — масштаб, перемещение — пробелом.

## Impact

- `dist/js/views/table/input.js` (колесо), `dist/js/views/table/p-dialogs.js` (справка). Откат — revert commit.
