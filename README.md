# Automated AI Recruiter Pipeline

Персональный AI-рекрутер: автоматизированная система поиска и первичного скрининга IT-вакансий на базе n8n + Playwright + Ollama.

**Цель:** Найти вакансии Senior / Tech Lead / Solution Architect (JS/TS/Node/React/Postgres) в Гданьске или remote, без ручного скроллинга.

---

## Архитектура (целевая)

```
GitHub Actions (Playwright) → POST /webhook → n8n → Ollama (local LLM)
                                                    ↓ match: true
Telegram (ручная ссылка)  ──────────────────→ n8n → Notion (Kanban) + Telegram Alert
```

---

## Roadmap

- [x] **PHASE 0** — Project bootstrap ✅
- [x] **PHASE 1** — Scraper (GitHub Actions + Playwright) ✅
- [x] **PHASE 2** — n8n Webhook pipeline ✅
- [x] **PHASE 3** — Ollama evaluation integration ✅
- [x] **PHASE 4** — Notion database integration ✅
- [ ] **PHASE 5** — Telegram bot trigger 🔄
- [ ] **PHASE 6** — E2E hardening & monitoring

---

## Подробный план задач

### PHASE 0 — Project Bootstrap ✅
> Цель: зафиксировать структуру репозитория и соглашения.

- [x] `P0-1` Создать репозиторий и базовый `README.md`
- [x] `P0-2` Описать архитектуру и фазы (этот документ)
- [x] `P0-3` Создать структуру директорий (`/scraper`, `/n8n`, `/docs`)
- [x] `P0-4` Добавить `.gitignore` (node_modules, .env, playwright state)
- [x] `P0-5` Создать `.env.example` с переменными окружения

---

### PHASE 1 — Scraper: GitHub Actions + Playwright
> Цель: обойти Cloudflare и получить чистый массив вакансий с агрегаторов.  
> Выход: POST на n8n Webhook с `[{ id, title, company, url, body, source, salary? }]`  
> **Статус: DONE — dry-run 2026-05-22: 210 офферов (JJ 199 + NFJ 11), unit-тесты 31/31 ✅**

#### 1.1 — Инфраструктура скрапера
- [x] `P1-1` Инициализировать TypeScript-проект в `/scraper` (`tsconfig.json`, `package.json`)
- [x] `P1-2` Установить зависимости: `playwright`, `typescript`, `dotenv`, `axios`
- [x] `P1-3` Создать `src/config.ts` — хранение параметров (webhook URL, фильтры стека, города)
- [x] `P1-4` Создать `src/types.ts` — интерфейс `JobOffer { id, title, company, url, body, source, salary, scrapedAt }`
- [x] `P1-5` Создать `src/utils/browser.ts` — хелпер запуска Playwright с реалистичными fingerprints

#### 1.2 — Скрапер JustJoin.it
- [x] `P1-6` Исследовать XHR/Fetch-трафик JustJoin.it DevTools → найти эндпоинт отдачи JSON
- [x] `P1-7` Написать `src/scrapers/justjoin.ts` — перехват API-ответа через `page.on('response', ...)`
- [x] `P1-8` Добавить параметры фильтрации в URL запроса (city: Gdańsk, category: JavaScript)
- [x] `P1-9` Написать unit-тест: `tests/justjoin.unit.test.ts` — 19 тестов без сети (extractSalary, extractLocation, matchesPreFilter, normalizeOffer)
- [x] `P1-10` Обработать edge-case: пустой `employmentTypes[]`, отсутствие `requiredSkills`, unknown/expert `experienceLevel`

#### 1.3 — Скрапер NoFluffJobs
- [x] `P1-11` Исследовать структуру ответа NoFluffJobs → **NFJ переехал на Angular SSR** (2026-05); реализован SSR-экстрактор из `<script id="serverApp-state">`
- [x] `P1-12` Написать `src/scrapers/nofluffjobs.ts` — SSR-based, не XHR
- [x] `P1-13` Добавить фильтрацию по локации (remote/Gdańsk) и seniority — `matchesPreFilter()`
- [x] `P1-14` Пагинация — SSR кумулятивная: переход на последнюю страницу = все результаты за 2 запроса
- [x] `P1-15` Унифицировать выход: привести к общему интерфейсу `JobOffer` (company из `posting.name`)

#### 1.4 — Оркестратор и отправка
- [x] `P1-16` Создать `src/index.ts` — запускает оба скрапера параллельно (`Promise.allSettled`)
- [x] `P1-17` Дедупликация на уровне скрапера: убрать дубли по `id` перед отправкой
- [x] `P1-18` Написать `src/sender.ts` — POST на Webhook с retry (3 попытки, exponential backoff)
- [x] `P1-19` Добавить логирование: сколько вакансий собрано / отправлено / упало с ошибкой
- [x] `P1-20` Протестировать отправку на mock-сервер: `tests/sender.test.ts` — 4 теста с `jest.mock(axios)`

#### 1.5 — GitHub Actions Workflow
- [x] `P1-21` Создать `.github/workflows/scraper.yml` — триггер `schedule: cron('0 8 * * *')`
- [x] `P1-22` Добавить шаги: checkout → `npm ci` → `npx playwright install chromium` → `npm run scrape`
- [x] `P1-23` Пробросить Secrets: `WEBHOOK_URL` через `env` из GitHub Secrets
- [x] `P1-24` Добавить ручной запуск: `workflow_dispatch` для дебага
- [x] `P1-25` Проверить, что GitHub Actions runner имеет нужные системные зависимости для Playwright
- [x] `P1-26` Добавить шаг загрузки артефакта (`upload-artifact`): сохранить scraped JSON для дебага

---

### PHASE 2 — n8n Webhook Pipeline
> Цель: принять массив от скрапера, подготовить к оценке LLM.

#### 2.1 — Туннель и доступность
- [x] `P2-1` Запустить n8n с туннелем: `npx localtunnel --port 5678 --subdomain ai-recruiter` → `https://ai-recruiter.loca.lt`
- [ ] `P2-2` Зафиксировать Webhook URL в GitHub Secret (`WEBHOOK_URL` = `https://ai-recruiter.loca.lt/webhook/jobs/ingest`)
- [x] `P2-3` Проверить доступность туннеля: `curl -X POST https://ai-recruiter.loca.lt/` → 404 (n8n жив); `Bypass-Tunnel-Reminder: true` добавлен в `sender.ts`

#### 2.2 — Webhook Node
- [x] `P2-4` Создать Webhook-узел в n8n: метод POST, путь `/jobs/ingest`
- [x] `P2-5` Добавить Respond to Webhook → `200 OK` сразу (не ждать обработки)
- [x] `P2-6` Проверить, что тело `[{...}, {...}]` корректно приходит в `$json.body`

#### 2.3 — Препроцессинг
- [x] `P2-7` Добавить узел Code (JS): нормализовать массив → `$json.body.map(...)`, обеспечить наличие полей `url`, `body`, `source`
- [x] `P2-8` Добавить узел Switch: роутинг по `source` (justjoin / nofluffjobs / linkedin / manual)
- [x] `P2-9` Добавить fallback-ветку для неизвестных источников (логировать, не падать)
- [x] `P2-10` Экспортировать JSON-конфиг воркфлоу в `/n8n/workflows/ingest.json`

---

### PHASE 3 — Ollama Evaluation Integration
> Цель: прогнать каждую вакансию через LLM, получить `{ match, reason, url }`.

#### 3.1 — Промпт и формат
- [ ] `P3-1` Написать и зафиксировать system-промпт в `/n8n/prompts/evaluator.md`
- [ ] `P3-2` Протестировать промпт вручную через Ollama CLI: 3 вакансии (2 плохих, 1 хорошая)
- [ ] `P3-3` Убедиться, что LLM всегда возвращает валидный JSON (`match`, `reason`, `url`)
- [ ] `P3-4` Задокументировать edge-cases промпта (нет стека в описании, смешанный стек)

#### 3.2 — n8n Loop + HTTP Request к Ollama
- [ ] `P3-5` Добавить узел Split In Batches (batch size: 1) после Webhook-препроцессинга
- [ ] `P3-6` Настроить HTTP Request к `http://localhost:11434/api/chat`: model, messages, stream: false
- [ ] `P3-7` Добавить `"keep_alive": 0` в тело запроса для освобождения VRAM после каждой вакансии
- [ ] `P3-8` Прописать фоллбэк для тела вакансии: `$json.body || $json.jobText || $json.description || ""`
- [ ] `P3-9` Установить `On Error: Continue (using error output)` на HTTP Request узле
- [ ] `P3-10` Добавить узел Code: распарсить JSON-ответ Ollama, извлечь `match` и `reason`
- [ ] `P3-11` Добавить узел IF: `match === true` → следующий шаг / `match === false` → discard
- [ ] `P3-12` Экспортировать конфиг в `/n8n/workflows/evaluate.json`

---

### PHASE 4 — Notion Database Integration
> Цель: сохранять валидные вакансии в Notion и дедуплицировать по URL.

#### 4.1 — Структура базы в Notion
- [ ] `P4-1` Создать Notion Database: `AI Recruiter Board` (канбан-вид)
- [ ] `P4-2` Описать схему в `/docs/notion-schema.md`: поля, типы, возможные статусы
- [ ] `P4-3` Задать поля: `Title` (title), `Company` (text), `URL` (url), `Source` (select), `Match Reason` (text), `Salary` (text), `Status` (select: New / Review / Applied / Rejected), `Scraped At` (date)
- [ ] `P4-4` Создать Notion Integration Token, добавить в `.env` и GitHub Secrets

#### 4.2 — Дедупликация
- [ ] `P4-5` Добавить узел Notion (Query): найти запись с `URL == $json.url`
- [ ] `P4-6` Добавить узел IF: запись существует → skip / не существует → create
- [ ] `P4-7` Протестировать дедупликацию: отправить одну вакансию дважды → в Notion одна запись

#### 4.3 — Запись в Notion
- [ ] `P4-8` Добавить узел Notion (Create Page): заполнить все поля из `$json`
- [ ] `P4-9` Обработать ошибку 400/401 от Notion API (логировать, не падать)
- [ ] `P4-10` Экспортировать конфиг в `/n8n/workflows/notion.json`

---

### PHASE 5 — Telegram Bot
> Цель: получать алерты о новых вакансиях и поддерживать ручной ввод ссылок.

#### 5.1 — Алерты о новых вакансиях
- [ ] `P5-1` Создать Telegram Bot через @BotFather, сохранить токен в `.env`
- [ ] `P5-2` Добавить узел Telegram (Send Message) после записи в Notion
- [ ] `P5-3` Оформить сообщение: `🟢 *{title}* @ {company}\n💰 {salary}\n📍 {source}\n🔗 {url}\n\n_{reason}_`
- [ ] `P5-4` Протестировать: отправить тестовую вакансию → получить сообщение в Telegram

#### 5.2 — Ручной триггер из Telegram
- [ ] `P5-5` Добавить Telegram Trigger узел в n8n (отдельный воркфлоу)
- [ ] `P5-6` Написать парсер команды: `/check https://...` → извлечь URL
- [ ] `P5-7` Добавить HTTP Request: загрузить страницу вакансии по URL
- [ ] `P5-8` Подключить к тому же evaluation-потоку (Ollama → IF → Notion)
- [ ] `P5-9` Отправить ответ в Telegram: `✅ match: true — добавлено` или `❌ match: false — {reason}`
- [ ] `P5-10` Экспортировать конфиг в `/n8n/workflows/telegram-trigger.json`

---

### PHASE 6 — E2E Hardening & Monitoring
> Цель: система работает без ручного вмешательства ≥ 30 дней.

- [ ] `P6-1` Написать E2E-тест: запустить скрапер → Webhook → Ollama mock → проверить Notion
- [ ] `P6-2` Добавить GitHub Actions job: `scraper-health-check` — тестовый прогон без отправки в Notion
- [ ] `P6-3` Добавить алерт в Telegram при падении GitHub Actions workflow (через webhook уведомление)
- [ ] `P6-4` Добавить алерт при 0 вакансий в ответе скрапера (возможно, структура сайта изменилась)
- [ ] `P6-5` Добавить ротацию User-Agent и viewport в Playwright (защита от детектирования)
- [ ] `P6-6` Описать процедуру обновления скрапера при изменении API агрегатора
- [ ] `P6-7` Провести итоговое review: 7 дней мониторинга → зафиксировать результат в `/docs/post-mortem.md`

---

## Структура репозитория

```
recruiter/
├── .github/
│   └── workflows/
│       └── scraper.yml          # GitHub Actions: ежедневный запуск
├── scraper/
│   ├── src/
│   │   ├── config.ts
│   │   ├── types.ts
│   │   ├── index.ts             # Точка входа
│   │   ├── sender.ts            # POST на webhook
│   │   ├── scrapers/
│   │   │   ├── justjoin.ts
│   │   │   └── nofluffjobs.ts
│   │   └── utils/
│   │       └── browser.ts       # Playwright хелпер
│   ├── tests/
│   │   ├── justjoin.test.ts          # live integration
│   │   ├── justjoin.unit.test.ts     # unit, no network
│   │   ├── nofluffjobs.test.ts       # live integration
│   │   ├── nofluffjobs.unit.test.ts  # unit, no network
│   │   └── sender.test.ts            # unit, jest.mock(axios)
│   ├── package.json
│   ├── tsconfig.json
│   └── .env.example
├── n8n/
│   ├── workflows/
│   │   ├── ingest.json          # Webhook + препроцессинг
│   │   ├── evaluate.json        # Ollama evaluation loop
│   │   ├── notion.json          # Дедупликация + запись
│   │   └── telegram-trigger.json
│   └── prompts/
│       └── evaluator.md         # System-промпт для LLM
├── docs/
│   ├── architecture.md
│   ├── notion-schema.md
│   └── post-mortem.md
├── .gitignore
├── .env.example
└── README.md
```

---

## Переменные окружения

| Переменная | Где используется | Описание |
|---|---|---|
| `WEBHOOK_URL` | GitHub Actions, scraper | URL n8n Webhook (туннель) |
| `NOTION_TOKEN` | n8n | Notion Integration Secret |
| `NOTION_DB_ID` | n8n | ID базы данных в Notion |
| `TELEGRAM_BOT_TOKEN` | n8n | Токен Telegram Bot |
| `TELEGRAM_CHAT_ID` | n8n | ID чата для алертов |
| `OLLAMA_HOST` | n8n | URL Ollama (default: localhost:11434) |

---

## Известные проблемы и решения

| Проблема | Симптом | Решение |
|---|---|---|
| Cloudflare WAF | 403 / 0 bytes | Playwright с browser fingerprint, перехват XHR вместо прямых запросов |
| Email false positives | Системные письма в ветке рассылок | Негативная lookahead-regex в Switch node |
| LinkedIn anti-scraping | Редирект на auth | Парсинг текста прямо из email-тела |
| Cloud LLM rate limits | 429 Too Many Requests | Локальная Ollama без лимитов + `keep_alive: 0` |
| VRAM утечка | Ollama не освобождает память | `"keep_alive": 0` в каждом запросе |
