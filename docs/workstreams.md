# Реестр направлений и веток

Правила — в [AGENTS.md](../AGENTS.md). Здесь — направления, их Issue, рабочие ветки и ответственные (состояние на 04.11.2026). Имя ветки не назначает ни человека, ни инструмент. Путь изменений: рабочая ветка → `test` → `main`.

| Направление | Issue | Рабочие ветки | Ответственный |
| --- | --- | --- | --- |
| Конструктор героя D&D 5e 2014 | [#200](https://github.com/YGXVI/Drop.Dice/issues/200) | `library`, `rules5e` | YGXVI |
| Справочные данные и каталоги | [#201](https://github.com/YGXVI/Drop.Dice/issues/201) | `library`; русский SRD — `codex/srd-ru` | YGXVI; русский SRD и портреты — sol0139 |
| Лист персонажа, правила и эффекты | [#202](https://github.com/YGXVI/Drop.Dice/issues/202) | `rules5e` | YGXVI; план эффектов — sol0139 |
| Игровой стол и интерфейс | [#203](https://github.com/YGXVI/Drop.Dice/issues/203) | `claude/dev` | sol0139 |
| Сервер, база и интеграция | [#204](https://github.com/YGXVI/Drop.Dice/issues/204) | `server`, `network`, `process` | sol0139; сетевой аудит, выпуск в `main` и защита веток — YGXVI |
| Голос и Discord-бот | [#205](https://github.com/YGXVI/Drop.Dice/issues/205) | `bots`, `voice` | Dezmondy; `voice` — YGXVI |

**Общие ветки.** `test` — интеграционная, база на 04.11 — `main` `c4c3974`. `main` — стабильная, выпуск только с разрешения YGXVI.

**Старые имена.** `codex/network` — прежнее имя `network` (тот же SHA), остаётся, пока открыт PR #59. `codex/srd-ru` — голова PR #184; sol0139 согласен на имя `srd-ru` (#195), переименование — штатным «Rename branch», без удаления refs.

**Граница интерфейса** (для предупреждения ответственного, не для согласования): `dist/js/views/**`, `dist/js/ui/**`, `dist/css/table.css`, `dist/css/screens.css`, `dist/js/icons.js`. Общие контракты перечислены в AGENTS.md.

Перенос старых задач в направления — [docs/backlog/2026-11-04-consolidation.md](backlog/2026-11-04-consolidation.md).
