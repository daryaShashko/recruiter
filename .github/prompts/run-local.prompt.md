---
name: run-local
description: Полностью локальный запуск (проверки + scrape)
agent: developer
---
Выполни полностью локальный запуск проекта.

Шаги:
1. Проверь, что в `.env` `WEBHOOK_URL` указывает на локальный n8n endpoint (`http://localhost:5678/webhook/jobs/ingest`).
2. Проверь доступность `http://localhost:5678` и `http://localhost:11434/api/tags`.
3. Запусти `scripts/run-local.sh --dry-run`.
4. Если dry-run успешен, спроси подтверждение и запусти `scripts/run-local.sh`.
5. Кратко отчитайся: сколько вакансий собрано, был ли webhook 200, есть ли ошибки.

Если любой шаг падает, сначала локализуй причину и предложи конкретный фикс с минимальными изменениями.
