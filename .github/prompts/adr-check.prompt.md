---
name: adr-check
description: Проверка необходимости ADR перед изменением интерфейсов
agent: architect
---
Проверь, требуется ли ADR для текущего изменения.

Критерий обязательного ADR:
- Любое изменение JobOffer, WebhookPayload или EvaluationResult.

Ответ:
1. Verdict: ADR required / ADR not required.
2. Почему.
3. Если required — черновик ADR в формате:
   - Context
   - Decision
   - Rationale
   - Consequences
4. Какие context/*.yaml нужно обновить после внедрения.

Пиши по-русски, названия интерфейсов и путей — на английском.
