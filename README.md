# Automated AI Recruiter Pipeline

Персональный AI-рекрутер: автоматизированная система поиска и первичного скрининга IT-вакансий на базе n8n + Playwright + LLM (Ollama / Groq / Gemini).

**Цель:** Найти вакансии Senior / Tech Lead / Solution Architect (JS/TS/Node/React/Postgres) в Гданьске или remote, без ручного скроллинга.

---

## Архитектура

```
GitHub Actions (Playwright) → POST /webhook → n8n → LLM (Ollama / Groq / Gemini)
                                                    ↓
                                               Evaluation Log (all decisions)
                                                    ↓ match: true
Telegram (ручная ссылка)  ──────────────────→ n8n → Notion (Kanban) + Telegram Alert (👍/👎)
```

> **Текущий режим:** n8n локально + Ollama локально + tunnel
>
> **Планируется (P7):** Oracle Cloud Always Free (ARM, 24 GB RAM) + Cloud LLM (Groq/Gemini)
>
> Подробности: [docs/architecture.md](docs/architecture.md) | [ADR-010](docs/adr/ADR-010-cloud-migration-oracle.md) | [ADR-011](docs/adr/ADR-011-cloud-llm-migration.md)

---

## Roadmap

- [x] **PHASE 0** — Project bootstrap ✅
- [x] **PHASE 1** — Scraper (GitHub Actions + Playwright) ✅
- [x] **PHASE 2** — n8n Webhook pipeline ✅
- [x] **PHASE 3** — Ollama evaluation integration ✅
- [x] **PHASE 4** — Notion database integration ✅
- [x] **PHASE 5** — Telegram bot ✅
- [ ] **PHASE 6** — E2E hardening & monitoring 🔄 (6/7 done)
- [ ] **PHASE 7** — Cloud Migration: Oracle Cloud + Cloud LLM 📋 [ADR-010](docs/adr/ADR-010-cloud-migration-oracle.md), [ADR-011](docs/adr/ADR-011-cloud-llm-migration.md) *(Может выполняться параллельно с P8)*
- [ ] **PHASE 8** — Evaluator Observability & Feedback Loop 📋 [ADR-012](docs/adr/ADR-012-evaluator-observability.md) *(Может выполняться параллельно с P7)*
- [ ] **PHASE 9** — Incremental Improvements & POC Backlog 📋
- [ ] **PHASE 10** — Lightweight Prompt Evaluation & CI/CD Pipeline (Promptfoo) 🔄 [ADR-013](docs/adr/ADR-013-prompt-evaluation-pipeline.md) *(4/13 done)*

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

### PHASE 1 — Scraper: GitHub Actions + Playwright ✅
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

### PHASE 2 — n8n Webhook Pipeline ✅
> Цель: принять массив от скрапера, подготовить к оценке LLM.

#### 2.1 — Туннель и доступность
- [x] `P2-1` Запустить n8n с туннелем: `npx localtunnel --port 5678 --subdomain ai-recruiter` → `https://ai-recruiter.loca.lt`
- [ ] `P2-2` Зафиксировать Webhook URL в GitHub Secret (`WEBHOOK_URL` = `https://ai-recruiter.loca.lt/webhook/jobs/ingest`) *(требует ручного обновления при перезапуске туннеля)*
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

### PHASE 3 — Ollama Evaluation Integration ✅
> Цель: прогнать каждую вакансию через LLM, получить `{ match, reason, url }`.

#### 3.1 — Промпт и формат
- [x] `P3-1` Написать и зафиксировать system-промпт в `/n8n/prompts/evaluator.md`
- [x] `P3-2` Протестировать промпт вручную через Ollama CLI: 3 вакансии (Senior Node.js Remote → true, Junior Java Warsaw → false, Tech Lead mixed → edge case)
- [x] `P3-3` Убедиться, что LLM всегда возвращает валидный JSON (`match`, `reason`, `url`)
- [x] `P3-4` Задокументировать edge-cases промпта (Node.js + Java legacy → match:true если Node.js первичный)

#### 3.2 — n8n Loop + HTTP Request к Ollama
- [x] `P3-5` Добавить узел Split In Batches (batch size: 1) после Webhook-препроцессинга
- [x] `P3-6` Настроить HTTP Request к `http://localhost:11434/api/chat`: model, messages, stream: false
- [x] `P3-7` Добавить `"keep_alive": 0` в тело запроса для освобождения VRAM после каждой вакансии
- [x] `P3-8` Прописать фоллбэк для тела вакансии: `$json.body || $json.jobText || $json.description || "No description"`
- [x] `P3-9` Установить `On Error: Continue (using error output)` на HTTP Request узле
- [x] `P3-10` Добавить узел Code: распарсить JSON-ответ Ollama, извлечь `match` и `reason`; поддерживает markdown-fences, сохраняет все поля вакансии
- [x] `P3-11` Добавить узел IF: `match === true` → Notion+Telegram / `match === false` → Discard
- [x] `P3-12` Экспортировать конфиг в `/n8n/workflows/evaluate.json`

---

### PHASE 4 — Notion Database Integration ✅
> Цель: сохранять валидные вакансии в Notion и дедуплицировать по URL.

#### 4.1 — Структура базы в Notion
- [x] `P4-1` Создать Notion Database: `AI Recruiter Board` (канбан-вид)
- [x] `P4-2` Описать схему в `/docs/notion-schema.md`: поля, типы, возможные статусы
- [x] `P4-3` Задать поля: `Title`, `Company`, `URL` (dedup), `Source`, `Match Reason`, `Salary`, `Status`, `Location`, `Scraped At`
- [x] `P4-4` Создать Notion Integration Token, добавить в `.env` и GitHub Secrets

#### 4.2 — Дедупликация
- [x] `P4-5` Добавить узел Notion (Query): найти запись с `URL == $json.url`
- [x] `P4-6` Добавить узел IF: запись существует → skip / не существует → create
- [x] `P4-7` Протестировать дедупликацию: отправить одну вакансию дважды → в Notion одна запись

#### 4.3 — Запись в Notion
- [x] `P4-8` Добавить узел Notion (Create Page): заполнить все поля из `$json`
- [x] `P4-9` Обработать ошибку 400/401 от Notion API (логировать, не падать)
- [x] `P4-10` Экспортировать конфиг → Notion-логика вошла в `/n8n/workflows/notify.json`

---

### PHASE 5 — Telegram Bot ✅
> Цель: получать алерты о новых вакансиях и поддерживать ручной ввод ссылок.

#### 5.1 — Алерты о новых вакансиях
- [x] `P5-1` Создать Telegram Bot через @BotFather, сохранить токен в `.env`
- [x] `P5-2` Добавить узел Telegram (Send Message) после записи в Notion
- [x] `P5-3` Оформить сообщение: `🟢 *{title}* @ {company}\n💰 {salary}\n📍 {source}\n🔗 {url}\n\n_{reason}_`
- [x] `P5-4` Протестировать: сообщение пришло, Notion запись создана, дедуп работает ✅

#### 5.2 — Ручной триггер из Telegram
- [x] `P5-5` Добавить Telegram Trigger узел в n8n (отдельный воркфлоу)
- [x] `P5-6` Написать парсер команды: `/check https://...` → извлечь URL
- [x] `P5-7` Добавить HTTP Request: загрузить страницу вакансии по URL
- [x] `P5-8` Подключить к тому же evaluation-потоку (Ollama → IF → Notion)
- [x] `P5-9` Отправить ответ в Telegram: `✅ match: true — добавлено` или `❌ match: false — {reason}`
- [x] `P5-10` Экспортировать конфиг в `/n8n/workflows/telegram-trigger.json`

---

### PHASE 6 — E2E Hardening & Monitoring 🔄
> Цель: система работает без ручного вмешательства ≥ 30 дней.

- [x] `P6-1` E2E-тест: `scraper/tests/e2e.test.ts` — mock HTTP-сервер на случайном порту, POST `/webhook/jobs/ingest`, проверка payload ✅
- [x] `P6-2` GitHub Actions job `scraper-health-check`: каждый понедельник 09:00 UTC, `npm test` с `DRY_RUN=true` ✅
- [x] `P6-3` Telegram-алерт при падении GitHub Actions: `if: failure()` → `curl api.telegram.org/sendMessage` ✅
- [x] `P6-4` Алерт при 0 вакансий: `process.exit(1)` + `closeBrowser()` + `stderr` → GH Actions видит failure → Telegram ✅
- [x] `P6-5` Ротация User-Agent + viewport: `pickRandom(USER_AGENTS/VIEWPORTS)` в `browser.ts`, consistent `Sec-Ch-Ua` ✅
- [x] `P6-6` Документация: `docs/scraper-update-guide.md` — диагностика, JustJoin API, NFJ SSR, чеклист деплоя ✅
- [ ] `P6-7` Шаблон `docs/post-mortem.md` создан с dry-run данными; финальные данные — после 7 дней production 🕐

---

### PHASE 7 — Cloud Migration: Oracle Cloud + Cloud LLM 📋
> Цель: стабильный 24/7 сервер без зависимости от ноутбука и tunnel.
> ADR: [ADR-010](docs/adr/ADR-010-cloud-migration-oracle.md), [ADR-011](docs/adr/ADR-011-cloud-llm-migration.md)

#### 7.1 — Cloud Infrastructure Provisioning
- [ ] `CLOUD-1` Регистрация Oracle Cloud аккаунта
- [ ] `CLOUD-2` Создание VM.Standard.A1.Flex (4 OCPU, 24 GB RAM)
- [ ] `CLOUD-3` Настройка VCN Security List (порты 80, 443, 22)
- [ ] `CLOUD-4` SSH, обновление системы, настройка swap (4-8 GB)
- [ ] `CLOUD-5` Установка Docker Engine + Docker Compose

#### 7.2 — n8n + Reverse Proxy
- [ ] `CLOUD-6` Настройка бесплатного домена (DuckDNS или свой)
- [ ] `CLOUD-7` Написание `docker-compose.yml` (postgres + n8n + caddy)
- [ ] `CLOUD-8` Деплой стека, проверка HTTPS-доступности n8n

#### 7.3 — Миграция пайплайна + замена LLM
- [ ] `CLOUD-9` Экспорт воркфлоу из локального n8n
- [ ] `CLOUD-10` Импорт воркфлоу + восстановление credentials на облачном n8n
- [ ] `CLOUD-11` Замена Ollama на Cloud LLM API (Groq/Gemini) + Wait node (4s)

#### 7.4 — GitHub Actions
- [ ] `CLOUD-12` Обновление `WEBHOOK_URL` в GitHub Secrets
- [ ] `CLOUD-13` E2E-тест: dispatch → scrape → cloud n8n → Notion + Telegram

#### 7.5 — Operational Hardening
- [ ] `CLOUD-14` Автоматические бэкапы (pg_dump + n8n data → GitHub repo)
- [ ] `CLOUD-15` Мониторинг uptime (UptimeRobot → Telegram)
- [ ] `CLOUD-16` Документация процедуры обновления Docker-образов

---

### PHASE 8 — Evaluator Observability & Feedback Loop 📋
> Цель: видеть ВСЕ решения LLM-оценщика, давать фидбек, тюнить промпт на данных.
> ADR: [ADR-012](docs/adr/ADR-012-evaluator-observability.md)
> Проблема: сейчас ~180 отклонённых вакансий/день уходят в чёрную дыру (`NoOp: Discard`).

#### 8.1 — Evaluation Log (Level 1 — приоритет)
- [ ] `EVAL-1` Создание Notion DB `Evaluation Log` (схема: [notion-schema.md](docs/notion-schema.md))
- [ ] `EVAL-2` Добавление узла Notion Log в evaluate.json (перед `IF: Match?`)
- [ ] `EVAL-3` Обновление docs/notion-schema.md
- [ ] `EVAL-4` Добавление `NOTION_EVAL_LOG_DB_ID` в env vars

#### 8.2 — Telegram Feedback (Level 2)
- [ ] `EVAL-5` Inline-кнопки 👍/👎 на Telegram-алертах
- [ ] `EVAL-6` Воркфлоу Feedback Handler (callback_query → Notion update)
- [ ] `EVAL-7` Команды `/rejected`, `/wrong <url>`
- [ ] `EVAL-8` Экспорт нового воркфлоу

#### 8.3 — Accuracy Reporting (Level 3 — после 2 недель данных)
- [ ] `EVAL-9` Weekly Report воркфлоу (cron → accuracy stats → Telegram)
- [ ] `EVAL-10` Notion views для аналитики

#### 8.4 — Dynamic Profile Tuning (Level 4 — отложено до NestJS)
- [ ] `EVAL-11` Хранение профиля оценщика в Notion key-value
- [ ] `EVAL-12` Telegram-команды `/profile add-stack`, `/profile remove-stack`

---

### PHASE 9 — Incremental Improvements & POC Backlog 📋
> Цель: дополнительные фичи и UX-улучшения после запуска основного функционала.
> Задачи не блокируют запуск и могут выполняться по мере необходимости.

#### 9.1 — Incremental Ingestion
- [ ] `POC-1` Incremental ingestion by date cursor: хранить дату последней обработки в Notion
- [ ] `POC-2` Внедрить фильтр-пропуск старых вакансий до отправки в n8n/Ollama
- [ ] `POC-3` Защита от дублей с overlap window (-2 часа от курсора)

#### 9.2 — Telegram & UX Улучшения
- [ ] `IMP-1` Убрать n8n-брендинг: заменить узел Telegram на HTTP Request к api.telegram.org
- [ ] `IMP-2` Улучшить формат сообщения (HTML parse_mode, красивые секции зарплаты/локации)
- [ ] `IMP-3` Telegram Run Now + Catch-up: кнопка ручного запуска и догоняющего сбора после простоя

#### 9.3 — Глубокий анализ компаний
- [ ] `IMP-4` Ollama-оценка компании: второй вызов LLM (после успешного матча) для анализа типа (аутсорс/продукт)
- [ ] `IMP-5` Scrape-анализ компании: парсинг `company-domain/about` и суммаризация через LLM

#### 9.4 — Универсальный ручной ввод
- [ ] `IMP-6` Поддержка входящих сообщений: текст или URL отправляются боту
- [ ] `IMP-7` Извлечение текста с HTTP-страниц для присланных ссылок
- [ ] `IMP-8` Оценка ручных вакансий и отправка результата обратно в Telegram

---

### PHASE 10 — Lightweight Prompt Evaluation & CI/CD Pipeline (Promptfoo) 📋
> Цель: автоматизированная оценка системных промптов через Promptfoo с GitOps-деплоем через Telegram.
> ADR: [ADR-013](docs/adr/ADR-013-prompt-evaluation-pipeline.md)

#### 10.1 — Gold Dataset & Promptfoo Config
- [x] `P10-1` Установить `promptfoo` как devDependency в корне проекта ✅ (`^0.93.0` в scraper/package.json)
- [x] `P10-2` Создать `promptfooconfig.yaml` с настройками промптов, локального провайдера Ollama и резервного Gemini Flash ✅ (`n8n/prompts/promptfooconfig.yaml`)
- [x] `P10-3` Сформировать базовый `gold_dataset.yaml` на 15–30 эталонных вакансий ✅ (20 тест-кейсов: 8 true, 7 false, 5 edge)

#### 10.2 — Hybrid Assertions & Local Verification
- [x] `P10-4` Внедрить детерминированные JavaScript-ассерты для быстрой и бесплатной проверки поля `match` (true/false) ✅ (3 default + per-test assertions)
- [ ] `P10-5` Настроить проверки `llm-rubric` через бесплатный лимит Gemini 1.5 Flash для валидации текстового поля `reason`
- [ ] `P10-6` Прогнать локальные тесты: `npx promptfoo eval` и убедиться в успешной генерации отчетов в CLI/HTML

#### 10.3 — GitHub Actions Workflow
- [ ] `P10-7` Создать workflow `.github/workflows/prompt-eval.yml`, запускающийся на Pull Request при изменении промптов
- [ ] `P10-8` Настроить в GHA шаги установки окружения, запуска promptfoo-тестов и экспорта результатов в JSON

#### 10.4 — Telegram GitOps Merge Hook
- [ ] `P10-9` Разработать воркфлоу n8n для отправки сводки тестов (F1-score, diff промпта) и кнопок аппрува в Telegram
- [ ] `P10-10` Реализовать webhook в n8n для автоматического слияния Pull Request через GitHub REST API при нажатии `[ ✅ Merge PR ]`
- [ ] `P10-11` Настроить триггер автодеплоя на сервере: автоматический pull ветки `main` после успешного мержа PR

#### 10.5 — Downstream Generalization
- [ ] `P10-12` Обобщить конфигурацию `promptfooconfig.yaml` для оценки промптов `company_analyzer` и `entity_extractor`
- [ ] `P10-13` Создать специализированные золотые датасеты и ассерты для анализа компаний и извлечения данных

---

## Структура репозитория

```
recruiter/
├── .github/
│   └── workflows/
│       └── scraper.yml          # GitHub Actions: ежедневный запуск в 08:00 UTC
├── scraper/
│   ├── src/
│   │   ├── config.ts
│   │   ├── types.ts
│   │   ├── index.ts             # Точка входа
│   │   ├── sender.ts            # POST на webhook с retry
│   │   ├── scrapers/
│   │   │   ├── justjoin.ts      # XHR-перехват API
│   │   │   └── nofluffjobs.ts   # SSR-экстрактор (Angular, 2026-05)
│   │   └── utils/
│   │       └── browser.ts       # Playwright хелпер с fingerprints
│   ├── tests/
│   │   ├── justjoin.unit.test.ts     # unit, без сети (19 тестов)
│   │   ├── nofluffjobs.unit.test.ts  # unit, без сети
│   │   ├── justjoin.test.ts          # live integration
│   │   ├── nofluffjobs.test.ts       # live integration
│   │   └── sender.test.ts            # unit, jest.mock(axios) (4 теста)
│   ├── package.json
│   ├── tsconfig.json
│   └── .env.example
├── n8n/
│   ├── workflows/
│   │   ├── ingest.json          # Webhook + нормализация + роутинг по source
│   │   ├── evaluate.json        # Split → LLM → IF match → [Notion/Telegram]
│   │   └── notify.json          # Notion Create Page + Telegram Alert
│   └── prompts/
│       ├── evaluator.md             # System-промпт для LLM-оценщика
│       ├── evaluator-template.json  # Chat-формат промпта для Promptfoo
│       ├── promptfooconfig.yaml     # Конфиг Promptfoo (P10-2)
│       └── gold_dataset.yaml        # Эталонный датасет (P10-3)
├── docs/
│   ├── architecture.md          # Текущая + планируемая архитектура
│   ├── notion-schema.md         # Схемы: AI Recruiter Board + Evaluation Log
│   ├── adr/                     # Architecture Decision Records
│   │   ├── ADR-010-*.md         # Cloud Migration (Oracle)
│   │   ├── ADR-011-*.md         # Cloud LLM (Groq/Gemini)
│   │   └── ADR-012-*.md         # Evaluator Observability
│   └── agents/                  # Промпты AI-агентов
├── context/                     # Контекстные манифесты для агентов
│   ├── project.yaml
│   ├── roadmap.yaml
│   ├── decisions.yaml           # Все ADR в YAML-формате
│   ├── interfaces.yaml
│   ├── env.yaml
│   └── modules/
├── .gitignore
├── .env.example
└── README.md
```

---

## Переменные окружения

| Переменная | Где используется | Описание |
|---|---|---|
| `WEBHOOK_URL` | scraper, GitHub Actions | URL n8n Webhook: локально `http://localhost:5678/webhook/jobs/ingest`; для GitHub Actions — публичный tunnel/hosted URL |
| `WEBHOOK_BATCH_SIZE` | scraper | Размер батча вакансий в одном POST на webhook (по умолчанию `25`, для локальной Ollama можно `10`) |
| `NOTION_TOKEN` | n8n | Notion Integration Secret *(P4)* |
| `NOTION_DB_ID` | n8n | ID базы данных в Notion *(P4)* |
| `TELEGRAM_BOT_TOKEN` | n8n | Токен Telegram Bot *(P5)* |
| `TELEGRAM_CHAT_ID` | n8n | ID чата для алертов *(P5)* |
| `OLLAMA_HOST` | n8n | URL Ollama (default: `http://localhost:11434`) |

**Планируемые (P7/P8):**

| Переменная | Где используется | Описание |
|---|---|---|
| `LLM_PROVIDER` | n8n | Провайдер LLM: `ollama` / `groq` / `gemini` (default: `ollama`) |
| `LLM_API_KEY` | n8n | API-ключ для Groq или Gemini *(только при LLM_PROVIDER != ollama)* |
| `LLM_MODEL` | n8n | Модель LLM (зависит от провайдера) |
| `NOTION_EVAL_LOG_DB_ID` | n8n | ID Notion DB Evaluation Log *(P8)* |
| `N8N_DB_TYPE` | n8n docker | `sqlite` или `postgresdb` *(P7, Oracle Cloud)* |

---

## Известные проблемы и решения

| Проблема | Симптом | Решение |
|---|---|---|
| Cloudflare WAF | 403 / 0 bytes | Playwright с browser fingerprint, перехват XHR вместо прямых запросов |
| NoFluffJobs SSR (2026-05) | Нет XHR с данными | SSR-экстрактор из `<script id="serverApp-state">` |
| Tunnel недоступен | `503 Tunnel Unavailable` / `404` от публичного webhook | Для локального запуска использовать `WEBHOOK_URL=http://localhost:5678/webhook/jobs/ingest`; P7 решит эту проблему полностью (Oracle Cloud) |
| localtunnel subdomain занят | `--subdomain ai-recruiter` недоступен | Запустить без `--subdomain`, обновить `WEBHOOK_URL` в GitHub Secrets |
| Cloud LLM rate limits | 429 Too Many Requests | Throttled Queue: Wait node 4s в n8n → ≤15 RPM. Fallback: переключение на второй провайдер |
| VRAM утечка в Ollama | Память не освобождается | `"keep_alive": 0` в каждом запросе к `/api/chat` |
| Слепая зона оценщика | Нет данных об отклонённых вакансиях | Evaluation Log (P8, ADR-012): логировать ВСЕ решения LLM в отдельную Notion DB |

---

## Полностью локальный запуск

Базовый режим без GitHub Actions и без туннеля:

1. Убедиться, что запущены `n8n` (`http://localhost:5678`) и `ollama` (`http://localhost:11434`).
2. В `.env` указать:
    `WEBHOOK_URL=http://localhost:5678/webhook/jobs/ingest`
   При необходимости добавить:
    `WEBHOOK_BATCH_SIZE=10`
3. Запуск одной командой:

```bash
./scripts/run-local.sh
```

Скрипт перед запуском скрапера делает preflight (`webhook`, `n8n`, `ollama`) и печатает health summary в конце запуска даже при ошибке (через `EXIT trap`): статус проверок, длительность preflight и общее время выполнения.

Dry-run без отправки в webhook:

```bash
./scripts/run-local.sh --dry-run
```

Кнопка запуска в VS Code:

- `Terminal` → `Run Task...` → `AI Recruiter: Run Local`
- или `AI Recruiter: Run Local (dry)`

Slash-команда Copilot Chat:

- `/run-local`

План отключения GitHub Actions (для полного local-only режима):

- `docs/github-actions-disable-plan.md`
