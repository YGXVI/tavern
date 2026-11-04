# Proposal

## Задача и участники

- TASK-ID: TASK-094 · Issue [#94](https://github.com/YGXVI/tavern/issues/94) · уровень L1 (интерфейс, без общих контрактов и формата данных).
- Автор: sol0139 + Claude Code (облачная сессия sol0139). Хозяин интерфейса и одобряющий — sol0139 (DEC-016).
- Пачка-снимок `claude/dev-review-task-093` от `main` `a39e940`; `claude/dev` ведёт другая сессия, правка попадёт туда обычным merge main.

## Why

sol0139 (30.10 12:21 +05:00): «дай возможность открывать страницы в новых страницах, щас не получается»; «вопросик слева снизу у нас будет для справочника, поэтому просто напиши что это справочник».

## What Changes

- Карточки кампаний, «Все кампании», «Лист героя» — ссылки; лист открывается по адресу `#/c/<кампания>/sheet/<герой>`.
- `menu()` умеет пункт-ссылку.
- «?» слева снизу — «Справочник» (заглушка); справка управления — по ссылке в нём, в меню и на клавише «?».

## Capabilities

### Modified Capabilities
- `campaigns`: ссылки и адрес листа.
- `maps`: кнопка «Справочник».

## Impact

`dist/js/views/screens.js`, `dist/js/ui/kit.js`, `dist/js/views/table/index.js`, `chrome.js`, `panels.js`, `p-dialogs.js`, `p-token.js`, `dist/css/screens.css`, `dist/css/table.css`; `main.js` не менялся. Откат — revert merge commit.
