# Proposal

## Задача и участники

- TASK-105 · Issue [#105](https://github.com/YGXVI/tavern/issues/105). Уровень **L1**: новый файл `tests/dice3d.test.js` вне границы интерфейса — нужен независимый review Яры или его Codex (или таймаут 24 ч после явного запроса SHA).
- В той же пачке «тесты» — TASK-171 · [#171](https://github.com/YGXVI/tavern/issues/171), **L0**: тест генератора бестиария на Windows.
- Автор: sol0139 + Claude Code (облачная сессия sol0139), постоянная ветка `claude/dev`, база `main` `e2d5418`.

## Why

sol0139 (31.10 10:58 +05:00): «105 — тестируй», «тест под винду поправь». Тест движка кубов из TASK-092 был вынесен из PR кубов (`d3c8730`), чтобы интерфейсные PR оставались в границе DEC-016; с тех пор у к4 появилась форма кристалла (TASK-136) и глухой звук (TASK-155). У Codex sol0139 на Windows `npm test` падал на тесте генератора: `URL.pathname` → `C:\C:\…`.

## What Changes

- `tests/dice3d.test.js`: число вершин и граней всех кубов (к4 — кристалл: 4 длинные грани с числами и 8 треугольников остриёв); сверху всегда число движка (60 раз на вид, к100 — две к10); кубы ложатся за несколько секунд и не вылетают из лотка; `lowest()` — нижняя вершина на дне ≈ 0; `hitVoice` — срез верхов и низкий тон, частоты не выше 1,5 кГц.
- `tests/bestiary-srd.test.js`: путь к генератору через `fileURLToPath`, а не `.pathname`.
- Поведение приложения не меняется; specs не меняются (`skip_specs`).

## Capabilities

### New Capabilities

Нет.

### Modified Capabilities

Нет — только тесты к уже описанному поведению (`dice`, `bestiary`).

## Impact

`tests/dice3d.test.js` (новый, около 1,4 с в CI), `tests/bestiary-srd.test.js`. Импортирует `_test` и `splitD100` из `dist/js/views/table/dice3d.js` без их изменения. Код `dist/`, данные, SQL и зависимости не меняются.
