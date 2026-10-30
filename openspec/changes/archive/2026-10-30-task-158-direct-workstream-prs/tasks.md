## Планирование
- [x] Получить подтверждение sol0139 конкретного плана; зарегистрировать Issue #158.
## Реализация
- [x] Обновить AGENTS, реестр, руководство, сообщение команде, шаблон PR и OpenSpec-контекст.
- [x] Добавить DEC-017 и синхронизировать требования team-workflow, сохранив историю.
## Проверка
- [x] Строгая проверка OpenSpec, ссылки и diff.
- [x] npm ci и npm test по обязательным проверкам проекта.

Результаты на базе main 69e49b31f2a8ee72e44661e270cd1225561e95d2: npm ci offline PASS; npm test 50/50; OpenSpec current 19/19, archive 65/65; относительные Markdown-ссылки и git diff --check PASS. Runtime/UI/SQL не меняются; браузер и live Supabase неприменимы. Human review, merge и deploy остаются отдельными этапами Issue/PR.

После архивации и синхронизации: OpenSpec current 18/18, archive 66/66 PASS; архив завершённой документальной реализации не означает человеческое review результата.
