# Боты «Распутья»

Самостоятельная подсистема репозитория: свои зависимости, настройки, тесты и запуск. Сайт (`dist/`), `supabase/` и корневой `package.json` она не использует и не меняет.

| Каталог | Что это | Состояние |
| --- | --- | --- |
| [discord/](discord/README.md) | Один Discord-бот кампании: запись сессий, далее транскрипция, музыка, голоса NPC, звуковые эффекты | PoC записи — TASK-191 / [#191](https://github.com/YGXVI/tavern/issues/191) |

Направление «Боты», постоянная ветка `bots`, хозяин — Dezmondy ([реестр](../docs/workstreams.md)). Правила работы — [AGENTS.md](../AGENTS.md); требования — change `task-191-discord-voice-poc` в `openspec/changes/`.

Новые модули (`transcription/`, `dj/`, `voice/`, `soundboard/`) и другие платформы появляются вместе со своим кодом и отдельными changes.
