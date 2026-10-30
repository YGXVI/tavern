# Proposal

## Задача и участники

- TASK-ID: TASK-037 · Issue [#64](https://github.com/YGXVI/tavern/issues/64).
- Автор: sol0139 + Claude Code (облачная сессия sol0139). Проверяющий: Яра — при слиянии пачки в `main`. Интегратор: Claude по DEC-013.
- Ветка `claude/dev` (DEC-013), база `main` `a9c92e6`.

## Why

sol0139 (30.10 09:26 +05:00): «сделай привязку при кручении токена, на каждые 45 градусов».

## What Changes

- Ручка поворота липнет к 0/45/90…°, когда угол ближе 9° к ним; Shift — по 15°, Alt — без привязки.
- Подсказка ручки рассказывает об этом.

## Capabilities

### Modified Capabilities
- `maps`: поворот токена липнет к 45°.

## Impact

- `dist/js/views/table/gizmo.js` (`snapAngle`, ручка поворота). Данные не меняются (`rot` в градусах). Откат — revert commit.
