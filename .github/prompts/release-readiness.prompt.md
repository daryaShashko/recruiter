---
name: release-readiness
description: Проверка готовности изменений к выкладке без регрессий
agent: qa
---
Проведи release-readiness check перед внедрением изменений.

Нужно:
1. Определить затронутые модули и контракты.
2. Проверить покрытие критичных сценариев тестами.
3. Найти потенциальные регрессии и несовместимости.
4. Дать решение: GO / NO-GO с обоснованием.

Критерии проверки:
- Контракты JobOffer/WebhookPayload/EvaluationResult не сломаны или есть ADR.
- Edge cases покрыты (empty, timeout, invalid JSON, structure drift).
- Для CI есть workflow_dispatch и отладочные артефакты.
- Риски и rollback шаги явно описаны.

Формат ответа:
- Verdict: GO / NO-GO
- Blocking issues
- Non-blocking issues
- Required fixes
- Verification checklist

Пиши по-русски. Имена файлов, интерфейсов и команд — по-английски.
