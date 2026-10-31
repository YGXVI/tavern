# Tasks

План подтверждён Ярой на `0301f4c` (31.10, #168, запись Codex «Центр» 6540902900); реализация — в `server` после головы #174.

## 1. Реализация

- [x] 1.1 `model.js`: `ownsDeleted(rows, table, row)` — есть ли ключ удалённой строки в кэше кампании
- [x] 1.2 `sync.js`: в `subscribe(cid)` — подписки `DELETE` без фильтра для `characters`, `scenes`, `scene_secrets`, `scene_explored`, `tokens`, `drawings`, `log_entries`, `log_secrets`, `save_requests`, `portal_requests`; обработчик вызывает `onChange` только при `ownsDeleted`
- [x] 1.3 Тест `tests/server-model.test.js`: своё/чужое удаление, ключи `scene_id`

## 2. Проверки

- [x] 2.1 `npm ci`, `npm test`, `spec:validate`, `spec:validate:archive`, `node --check`
- [ ] 2.2 Пробное слияние со свежим `main` и с `codex/rules5e` (общий `sync.js`)
- [ ] 2.3 После деплоя — живая проверка двумя аккаунтами: рисунок, токен, герой

## 3. Выпуск

- [ ] 3.1 Review результата — Яра; интегратор — не автор; синхронизация change со specs и архив перед финальным review
