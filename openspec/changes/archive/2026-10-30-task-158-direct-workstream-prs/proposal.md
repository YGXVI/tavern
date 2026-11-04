## Why
TASK-158 / Issue #158, L2: действующие инструкции требуют review-снимки вопреки прямому запрету Яры. Нужен согласованный переход к PR из постоянных направлений.

## What Changes
Удалить требование task/plan/review-веток из действующих инструкций, шаблона PR и OpenSpec-контекста; обновить AGENTS, реестр, руководство и сообщение команде, добавить DEC-017. Зарегистрировать существующее codex/library без назначения хозяина. Сохранить уровни и человеческое review, безопасную проверку старых refs.

## Capabilities
### Modified Capabilities
- `team-workflow`: постоянные направления и проверяемый объём PR без снимков.

## Impact
Только документы процесса, OpenSpec и Markdown-шаблон PR; runtime, CI-логика и доступы не меняются. Исполнитель Яра/Codex «Центр», ветка codex/process; проверяющий sol0139; интегратор другая сторона после human review. База реализации 69e49b31f2a8ee72e44661e270cd1225561e95d2.

## Approval
План https://github.com/YGXVI/tavern/issues/153#issuecomment-6527775134 подтверждён sol0139 https://github.com/YGXVI/tavern/issues/153#issuecomment-6527978710 . Первоначальная база fbf1dc4059eeaed284b173c16d6e50f2fc0c6c1f. Это согласие на план, не review результата. Server/localStorage и удаление веток не входят.
