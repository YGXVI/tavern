# Tasks

## 1. Ввод хитов

- [x] 1.1 `parseHpInput` в `dist/js/rules/hp.js`; проверка: `tests/hp.test.js`
- [x] 1.2 `setHp` (точная запись с «без сознания», концентрацией, журналом, отменой) и `commitHpInput` в `p-token.js`; проверка: Playwright — 9, −4, +30, 0, Esc, мусор
- [x] 1.3 Поле хитов в токен-баре вместо кнопок «−/+», выделение числа при фокусе, Enter/Esc; панель не перерисовывается под полем (`chrome.js`, `table.css`); проверка: снимок токен-бара
- [x] 1.4 Поле «Осталось хитов» в редакторе хитов; проверка: Playwright — «Записать» 11 из 0 снимает «без сознания»

## 2. Проверки

- [x] 2.1 `npm test`, `npm run spec:validate`, `npm run spec:validate:archive`, `node --check` изменённых JS
