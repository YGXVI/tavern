# Proposal

## Задача и участники

- TASK-ID: TASK-096 · Issue [#96](https://github.com/YGXVI/tavern/issues/96) · уровень L1 (интерфейс, без общих контрактов и формата данных).
- Автор: sol0139 + Claude Code (облачная сессия sol0139). Хозяин интерфейса и одобряющий — sol0139 (DEC-016).
- Пачка-снимок `claude/dev-review-task-093` от `main` `a39e940`; `claude/dev` ведёт другая сессия, правка попадёт туда обычным merge main.

## Why

sol0139 (30.10 12:21 +05:00): «добавь вкладку „мои персонажи“ и там будет список всех персонажей».

## What Changes

- На главной вкладки «Кампании» / «Мои персонажи».
- Список героев по кампаниям, карточка открывает лист.
- Конструктор существ на главной — в плане L2 TASK-097 (нужна библиотека существ в данных).

## Capabilities

### Modified Capabilities
- `characters`: вкладка «Мои персонажи».

## Impact

`dist/js/views/screens.js`, `dist/css/screens.css`; формат данных и `main.js` не менялись. Откат — revert merge commit.
