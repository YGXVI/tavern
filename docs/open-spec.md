# Работа с OpenSpec

Канонические правила уровней, review, таймаутов, TASK-ID, снимков и статусов — только в [AGENTS.md](../AGENTS.md). [Реестр](workstreams.md) содержит направления и хозяев. Этот документ описывает инструмент change, не вводит дополнительное согласование.

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

Change нужен для L1/L2; отсутствие change у L0 обосновывается в PR. Наличие proposal само по себе не требует подтвердить план L1 до реализации — применять уровни AGENTS.

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

Сначала получить номер новой Issue; NNN — её номер с ведущими нулями минимум до трёх цифр. Историческое имя существующего change сохраняется по AGENTS. CLI создаёт каркас; документы заполняет исполнитель. Validate проверяет структуру, не истинность требований, согласие людей или достаточность тестов.

## Проверка и архив

Сопоставить сценарии с реализацией/проверками и назвать непроверенное. Синхронизировать delta specs и архивировать завершённый change перед финальным review. Архив в снимке PR ещё не main. После замечаний повторно открыть change либо оформить последующий, сохранив историю. Незавершённые планы не выдавать за готовую функцию. Review, merge и статусы задаются AGENTS, не командой archive.

Инструмент: [OpenSpec](https://github.com/Fission-AI/OpenSpec), [team workflow](https://github.com/Fission-AI/OpenSpec/blob/main/docs/team-workflow.md).
