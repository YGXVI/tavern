# Работа с OpenSpec

Правила процесса — только в [AGENTS.md](../AGENTS.md), направления — в [реестре](workstreams.md). OpenSpec используется, когда помогает зафиксировать сложное изменение; обязательного пакета документов для небольшой реализации нет (DEC-018). Этот документ описывает инструмент change и не вводит согласований.

## Установка

Node.js >=20.19.0 (CI — 22), OpenSpec 1.15.0 закреплён в devDependencies/lockfile; глобальная установка не нужна. Сохранить незавершённую работу в собственной копии и обновить её по AGENTS, не переключая checkout коллеги. Затем:

```sh
npm ci
npm run openspec -- --version
npm run spec:validate
npm run spec:validate:archive
npm test
```

Интеграции Codex (.agents/skills/openspec-*) и Claude Code (.claude/skills, .claude/commands/opsx) сохранены в Git. Открыть новую сессию в своей копии. Если файлов нет — npm run spec:setup, проверить diff; не перегенерировать и не обновлять CLI попутно.

## Артефакты

- openspec/specs — требования соответствующей ревизии; невлитая спецификация не описывает main.
- openspec/changes/<change> — proposal, delta specs, design, tasks.
- proposal.md — цель, уровень, TASK/Issue, участники, база, файлы, зависимости, основания согласования по AGENTS.
- Delta specs — ADDED/MODIFIED/REMOVED Requirements, SHALL/MUST и Scenario WHEN/THEN на каждое требование; для MODIFIED переносить требование полностью.
- design.md — контракты, совместимость, миграция/откат, проверка и ограничения.
- tasks.md — проверяемые действия и фактические результаты; галочки не подтверждают согласие или deploy.

Change — по решению исполнителя для сложных изменений; наличие proposal само по себе не требует подтверждения плана.

## Команды

| Действие | Codex | Claude Code |
| --- | --- | --- |
| Исследовать | $openspec-explore | /opsx:explore |
| Подготовить | $openspec-propose task-NNN-slug | /opsx:propose task-NNN-slug |
| Уточнить | $openspec-update-change task-NNN-slug | /opsx:update task-NNN-slug |
| Реализовать | $openspec-apply-change task-NNN-slug | /opsx:apply task-NNN-slug |
| Синхронизировать | $openspec-sync-specs task-NNN-slug | /opsx:sync task-NNN-slug |
| Архивировать | $openspec-archive-change task-NNN-slug | /opsx:archive task-NNN-slug |

В терминале:

```sh
npm run openspec -- list
npm run openspec -- new change task-NNN-slug
npm run openspec -- instructions proposal --change task-NNN-slug
npm run openspec -- status --change task-NNN-slug
npm run spec:validate
npm run spec:validate:archive
npm run openspec -- archive task-NNN-slug
```

Новый change называть `task-NNN-slug`, где NNN — номер Issue направления (с ведущими нулями до трёх цифр), или по смыслу; новую Issue ради change не создавать. Историческое имя существующего change сохраняется. CLI создаёт каркас; документы заполняет исполнитель. Validate проверяет структуру, не истинность требований, согласие людей или достаточность тестов.

## Проверка и архив

Сопоставить сценарии с реализацией/проверками и назвать непроверенное. Синхронизировать delta specs и архивировать завершённый change в рабочей ветке до интеграции в `test`. Новое имя change не основание для новой ветки. После замечаний повторно открыть change либо оформить последующий, сохранив историю. Незавершённые планы не выдавать за готовую функцию.

Инструмент: [OpenSpec](https://github.com/Fission-AI/OpenSpec), [team workflow](https://github.com/Fission-AI/OpenSpec/blob/main/docs/team-workflow.md).
