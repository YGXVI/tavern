## Why

Общие правила требуют ветку на задачу и дают владельцу особый статус, хотя команда использует постоянные направления. Отдельное исключение DEC-013 для claude/dev создаёт неравный порядок. Запрос Яры — единый равный процесс и ветки по фронтам работы.

## What Changes

- Убрать привилегию прямого указания владельца и его исключительное назначение интегратора.
- Использовать постоянные ветки направлений с отдельными TASK/Issue/change для задач.
- Установить один активный исполнитель и один открытый PR на ветку, review другим участником, небольшие законченные порции и обычный merge с синхронизацией main.
- Согласовать AGENTS, руководство, onboarding, config, team-workflow, шаблоны Issue/PR и новый реестр. Исторические решения сохраняются, их действующие исключения замещает DEC-015.

## Capabilities

### New Capabilities
Нет.

### Modified Capabilities
- `team-workflow`: равные участники, постоянные ветки и единый порядок review/merge.

## Impact

TASK-036 / https://github.com/YGXVI/tavern/issues/60 / change task-036-equal-workstreams. Исполнитель — Яра + Codex, центральный чат; проверяющий и интегратор не назначены. Ветка направления codex/process; база main a9c92e61e046b73eef647f5af87bd8cebaae3250. Запрос изменения не выдаётся за review другого участника. Это подготовка документов для peer review; самостоятельный merge не выполняется.

Файлы: AGENTS.md, docs/open-spec.md, docs/workstreams.md, docs/open-spec-message.md, docs/decisions.md (DEC-015), только индекс/действующие инструкции docs/status.md, openspec/config.yaml и team-workflow, шаблоны Issue/PR. Runtime, SQL, product specs, секреты и настройки GitHub не меняются. TASK-035 (аудит) и TASK-002 (backend) не перехватываются. Перед публикацией повторно сверить main и решения коллег.
