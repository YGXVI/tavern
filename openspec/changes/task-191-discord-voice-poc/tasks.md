# Tasks

## 1. Оформление

- [x] 1.1 Запись решения Яры об отмене плана A в #121; Issue #191 (TASK-191, L2).
- [x] 1.2 Постоянная ветка `bots` от main `c4c3974`; направление «Боты» в `docs/workstreams.md`.
- [x] 1.3 Proposal, design, delta spec `discord-voice-recording`, tasks.
- [ ] 1.4 Подтверждение Ярой конкретной ревизии плана L2 в #191 (SHA — в PR). Галочка не подтверждает согласие.

## 2. Реализация PoC в `bots/discord`

- [x] 2.1 Каркас подсистемы: package.json/lockfile, `.env.example`, `.gitignore`, README, конфиг.
- [x] 2.2 Состояние записи и согласия (`recorder/session.js`), манифест JSONL (`recorder/manifest.js`).
- [x] 2.3 Приём Opus → Ogg по фрагментам с таймкодами (`recorder/tracks.js`).
- [x] 2.4 Подключение, переподключение, команда `/rec` и кнопки согласия, права мастера.
- [x] 2.5 Экспорт: `segments.json` и WAV 16 кГц mono.
- [x] 2.6 Юнит-тесты без сети.

## 3. Проверки

- [x] 3.1 `npm ci`, `spec:validate`, `spec:validate:archive`, `npm test` в корне; `npm ci`, `npm test`, `node --check` в `bots/discord`. Результаты — в PR.
- [ ] 3.2 Живая проверка на тестовом сервере: 2–3 человека × 60 мин.
- [ ] 3.3 6–8 участников; прогон 3–4 ч; разрыв сети; экспорт.
- [ ] 3.4 Человеческий review Яры; merge — интегратор, не автор.

Review, merge и deploy фиксируются в #191 и PR, не галочками.
