# Tasks

## 1. Тесты

- [x] 1.1 Вернуть `tests/dice3d.test.js` из `8532d50` и обновить к4 под кристалл (TASK-136)
- [x] 1.2 Проверка `lowest()`: куб на дне — 0, поднятый на 0,5 — 0,5
- [x] 1.3 Проверка `hitVoice` на подменённом Web Audio: срез верхов, низкий тон, частоты ≤ 1,5 кГц для ударов о куб, борт и дно
- [x] 1.4 TASK-171: `fileURLToPath` вместо `.pathname` в тесте генератора

## 2. Проверки

- [x] 2.1 `npm test` — 72/72; `node --test tests/dice3d.test.js` — 6/6 за ~1,4 с; spec-проверки
- [x] 2.2 Windows-путь: `fileURLToPath(new URL('file:///C:/…'), { windows: true })` даёт `C:\…`, а `.pathname` — `/C:/…`. Живой прогон на Windows — у Codex sol0139 после merge
