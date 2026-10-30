# Proposal

## Why
Исправления технического review [PR #150](https://github.com/YGXVI/tavern/pull/150#issuecomment-6527503509), TASK-125 / #125, L2. Архив первой реализации сохраняет исторический результат; этот follow-up исправляет найденные дефекты. Исполнитель Яра / Codex, постоянная codex/library. Проверяющий результата sol0139, интегратор Claude, не автор.

План TASK-097 16f5111f0da2054e19ab61fb8a74b6b3a389979f и передача task-097-split-1 сохраняют силу. Яра прямо поручил исправить review и выбрал в чате 100 МиБ / 200 файлов. [Уточнение реализации](https://github.com/YGXVI/tavern/pull/150#issuecomment-6528015491). Координатор [согласовал версию 20261030130000](https://github.com/YGXVI/tavern/issues/153#issuecomment-6527979100), подтвердил, что новая миграция ещё не применялась. База PR до исправлений 42f051ec19f9fc584aa113ec1f3185a662b48692; проверенный origin/main fbf1dc4059eeaed284b173c16d6e50f2fc0c6c1f. Новые ветки и production SQL не входят.

## What Changes
- Составной PK владельца/ID и соответствующий upsert; совместимые составные ключи песочницы.
- Учёт всех файлов library: 100 МиБ / 200, до 5 МиБ каждый; защита используемых изображений и явная очистка через Storage API.
- Уникальная версия НЕприменённой миграции, клиентские/SQL/concurrency регрессии и описание ограничений.

## Capabilities
### New Capabilities
Нет.
### Modified Capabilities
- `bestiary`: изоляция ID и файловые квоты/очистка личной библиотеки.

## Impact
Только собственные library clients, новая ещё не применённая миграция, tests и раздел Creature docs/data. Guard/count triggers на managed storage.objects — явное расширение, нуждающееся в проверке реального Storage API до подключения uploads. Самостоятельных операций записи metadata нет. Runtime TASK-129, UI, token RPC, store/sync/model не меняются. При последующей интеграции #126 сохраняются обе группы RLS/документации.
