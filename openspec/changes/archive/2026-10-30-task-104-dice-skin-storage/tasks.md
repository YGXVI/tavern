# Tasks

## 1. Хранение набора

- [x] 1.1 `mySkin`/`setMySkin` читают и пишут `rasputye-v2-prefs:<userId>` (`{diceSkin}`), try/catch, неизвестное → «Кость», чужие поля сохраняются; проверка: Playwright «набор кубов» — «Золото» после перезагрузки, у игрока «Кость», `{"diceSkin":"ruby","sound":"on"}` после смены, `neon` и не-JSON → «Кость»
- [x] 1.2 `docs/data.md` — ключ в таблицах песочницы и браузера серверного режима; spec `dice`

## 2. Проверки

- [x] 2.1 `npm test`, `spec:validate`, `spec:validate:archive`, `node --check`
