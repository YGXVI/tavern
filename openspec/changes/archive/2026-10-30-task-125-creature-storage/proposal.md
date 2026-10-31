# Proposal
## Why
Личная библиотека TASK-097 должна подтверждать сохранение и держать пользовательские статблоки вне общего каталога. Модель TASK-122 уже подготовлена в PR #124; этой порцией добавляются хранение и клиент.

TASK-125 / #125, L2; YGXVI/Codex, сессия бестиария. Review/integrator sol0139 (+ Claude), не автор. План TASK-097 `16f5111f0da2054e19ab61fb8a74b6b3a389979f` подтверждён Ярой, передача `task-097-split-1`. Ветка codex/library, база main `bf3b426b8a05bab35bac655488fb6439c70fa419`, зависимость #122/#124. Снимок этой порции после интеграции модели. Хозяин направления не назначен.

## What Changes
- Приватные creatures, campaign_creatures, bucket library; серверный лимит записей без гонки.
- Независимый клиент CRUD/копирования SRD и картинок, без realtime кампании.
- Песочница использует необязательный creatures в прежнем rasputye-v2-db.

## Capabilities
### New Capabilities
Нет.
### Modified Capabilities
- `bestiary`: личное хранение, копии кампании и API библиотеки.

## Impact
Новые core/library.js, server/library.js, миграция и tests; собственные разделы docs/data.md и rls.sql. Без tokens/guard_token/place_creature, sync/model/store/campaign и UI. Родительский change не менять. На рабочий Supabase миграция не применяется.
