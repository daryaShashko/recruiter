# ADR-013: Lightweight Prompt Evaluation & CI/CD Pipeline (Promptfoo)

─────────────────────────────────────────────────────────
**ADR-013:** Внедрение автоматизированной оценки системных промптов (Prompt Evaluation) через `promptfoo` с GitOps-деплоем через Telegram.
**Date:** 2026-05-26
**Status:** Proposed & Ready for Execution
─────────────────────────────────────────────────────────

## 1. CONTEXT & CRITIQUE OF PREVIOUS APPROACH

По мере усложнения логики AI-рекрутера системные промпты (Phase 3) становятся критической точкой отказа. Ручное тестирование промптов ведет к "слепым" регрессиям (исправление одного edge-case ломает другой).

Изначально предложенный подход (Python-скрипты, тяжелые LLM-Судьи, авто-оптимизаторы и прямая перезапись файлов на сервере через Telegram) имел ряд архитектурных уязвимостей:

1. **Зоопарк технологий:** Внедрение Python в монорепозиторий, где парсер и n8n работают на Node.js/TS, раздувает кодовую базу и ломает переиспользование типов (например, интерфейса `JobOffer`).
2. **Стоимость и лимиты API (Оверинжиниринг):** Использование мощных моделей (Gemini 1.5 Pro / Claude 3.5) для оценки булевых значений (`match: true/false`) — это сжигание ресурсов. Авто-оптимизаторы быстро упрутся в Rate Limits бесплатных API.
3. **Нарушение GitOps:** Перезапись файла `evaluator.md` напрямую на сервере по клику из Telegram ведет к рассинхронизации с Git-репозиторием. История изменений теряется, откат невозможен.

Нам нужен легковесный, бесплатный и индустриально-стандартный пайплайн в экосистеме Node.js.

## 2. DECISION

Интегрировать **Promptfoo** (Open-Source CLI фреймворк для оценки LLM) для локального и CI/CD тестирования промптов. Использовать гибридную стратегию проверок (ассертов) и реализовать деплой исключительно через GitHub PR API.

```text
+---------------------------------------------------------------------------------+
|                          GITOPS PROMPT EVALUATION LOOP                          |
|                                                                                 |
|  1. Dev creates PR with new prompt -> 2. GitHub Actions runs `promptfoo eval`   |
|                                            |                                    |
|                                            v                                    |
|  5. GitHub merges PR & n8n pulls   <- 4. Telegram Webhook: [✅ Merge PR]        |
|     (Safe Production Deployment)      (Diff & F1-score reported to User)        |
+---------------------------------------------------------------------------------+
```

### 2.1. Golden Dataset Schema (YAML/JSON)

Вместо кастомных Python-скриптов используется нативный формат Promptfoo. Мы создаем `n8n/prompts/gold_dataset.yaml` на 30–50 эталонных вакансий.

```yaml
prompts:
  - file://n8n/prompts/evaluator.md

providers:
  - ollama:chat:llama3.1:latest # Оценка проходит локально и бесплатно

tests:
  - description: "Valid Senior Node.js (Remote)"
    vars:
      vacancy_text: "We are looking for a Senior Node.js developer..."
      url: "https://justjoin.it/..."
    assert:
      - type: is-json
      - type: javascript
        value: "JSON.parse(output).match === true" # Детерминированная проверка (0$ cost)
      - type: llm-rubric
        provider: google:gemini-1.5-flash # Дешевый/бесплатный API только для оценки логики
        value: "Reasoning must clearly state that Node.js is the primary stack."
```

### 2.2. Hybrid Evaluation Strategy

Мы отказываемся от "LLM-as-a-Judge" для всего пайплайна.

* **Match (True/False):** Проверяется мгновенно и бесплатно через нативный JavaScript-ассерт Promptfoo.
* **Reasoning (Текст):** Проверяется через `llm-rubric` (используется бесплатный лимит Gemini 1.5 Flash) для проверки адекватности ответа.

### 2.3. Telegram-Driven GitOps (Safe Deployment)

Интерактивность сохраняется, но становится безопасной:

1. При изменении промпта (в новой ветке Git) запускается GitHub Action.
2. Action прогоняет тесты через `promptfoo` и формирует отчет: *(Baseline: 88% -> New: 96%)*.
3. GitHub Action отправляет POST-запрос на Webhook n8n.
4. n8n шлет в Telegram алерт с кнопками: `[ ✅ Merge PR ]` и `[ ❌ Reject ]`.
5. Клик по `[ ✅ Merge ]` вызывает n8n webhook, который через HTTP Request отправляет команду в **GitHub REST API** на мерж этого Pull Request'а в ветку `main`.
6. Сервер подтягивает изменения легитимно, сохраняя историю версий в Git.

## 3. RATIONALE

* **Zero-Cost Scaling:** Использование детерминированных проверок для JSON-структур и логики означает, что прогон 100 вакансий стоит $0 и выполняется за секунды.
* **Stack Homogeneity:** Promptfoo написан на TypeScript/Node.js. Он идеально встраивается в текущий `package.json` проекта.
* **GitOps Compliance:** Промпты — это код. Они должны версионироваться. Telegram-кнопка мержит PR, а не мутирует стейт на сервере. Это исключает рассинхронизацию между сервером и GitHub.

## 4. CONSEQUENCES

### Positive

* Абсолютно бесплатная инфраструктура оценки (не нужны платные токены для Judge-моделей).
* Надежная защита от регрессий: сломанный промпт просто не пройдет CI/CD проверку.
* Сохранение единого JS/TS стека без привлечения Python.
* Элегантный аппрув через Telegram без ущерба для безопасности.

### Negative / Trade-offs

* Создание и поддержка `gold_dataset.yaml` всё ещё требует ручного труда (копирование сложных/спорных вакансий из продакшена в тесты).
* Временно откладывается "Автоматический Оптимизатор Промптов" (EYE), так как на текущем этапе (Phase 3/4) он избыточен. Фокус смещен на тестирование *человеческих* изменений.

## 5. ACTIONABLE TASKS (Backlog)

* **`EVAL-1`**: Установить `promptfoo` как devDependency в репозиторий.
* **`EVAL-2`**: Сформировать базовый `gold_dataset.yaml` из 10 вакансий (5 false-negatives, 5 false-positives, собранных за время тестов Phase 1).
* **`EVAL-3`**: Настроить GitHub Actions workflow (`.github/workflows/prompt-eval.yml`), который запускается при изменениях файлов в `n8n/prompts/`.
* **`EVAL-4`**: Настроить отправку результатов `promptfoo` в n8n Telegram Webhook.
* **`EVAL-5`**: Добавить в n8n логику обращения к GitHub API (`POST /repos/{owner}/{repo}/pulls/{pull_number}/merge`) по нажатию кнопки в Telegram.

─────────────────────────────────────────────────────────
