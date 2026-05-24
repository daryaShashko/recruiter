# AI Recruiter Workspace Instructions

## Language and style

- Отвечай по-русски, если пользователь не просит иначе.
- Для кода, путей, идентификаторов и команд используй английский.
- Пиши практично: сначала результат, затем детали.

## Project context

- Проект: automated AI recruiter pipeline.
- Стек: TypeScript, Node.js, Playwright, n8n, Ollama, Notion, Telegram.
- Ограничения: без платных сервисов, локальный Ollama, Notion как единственная БД.

## Working protocol

- Перед изменениями сначала прочитай релевантные файлы в context/.
- Если меняется интерфейс JobOffer, WebhookPayload или EvaluationResult, сначала опиши архитектурное решение (ADR), затем код.
- После изменения кода обновляй соответствующие YAML-файлы в context/.

## Scraper rules

- Не используй any, только unknown и явное сужение типов.
- Конфиг хранится в scraper/src/config.ts.
- Браузер открывается через scraper/src/utils/browser.ts.
- Скраперы возвращают JobOffer[] и не бросают исключения наружу: логируют с префиксом источника и возвращают [].
- Для JustJoin: парсинг через перехват API/XHR.

## Testing rules

- Для HTTP тестов используй моки (nock/msw), без реальных сетевых вызовов.
- Для Playwright тестов используй page.route() для мока API.
- Проверяй edge-cases: пустой ответ, таймаут, изменение JSON-структуры, invalid JSON, happy path.

## n8n rules

- Webhook должен быстро отвечать 200 до основной обработки.
- Для Ollama используй batch size 1 и keep_alive: 0.
- Перед JSON.parse очищай markdown fences.
- При ошибке парсинга используй безопасный fallback-объект.

## CI rules

- GitHub Actions runner: ubuntu-latest, free tier, 15 min budget, no GPU.
- Минимальные шаги: checkout -> npm ci -> playwright install -> scrape.
- Поддерживай workflow_dispatch и upload-artifact для отладки.
