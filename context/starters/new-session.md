# Как начать новую сессию

Работает одинаково в Claude Code, Codex (CLI/Desktop) и VS Code: агент сам читает
`AGENTS.md`. Ниже — готовые формулировки, которые называют нужные файлы явно.
Пути указаны как обычный текст, чтобы не зависеть от синтаксиса `@file` конкретного
инструмента.

---

## Быстрый старт — скопируй нужный блок

---

### 🎯 Не знаю с чего начать / планирование задач

```
Прочитай: docs/agents/orchestrator.md, context/project.yaml, context/roadmap.yaml

Прочитай контекст и скажи:
1. Текущая фаза и открытые задачи
2. Что логично делать следующим
```

---

### 💻 Пишем TypeScript / Playwright код

```
Прочитай: docs/agents/developer.md, context/interfaces.yaml, context/modules/scraper.yaml

Задача: [ОПИСАНИЕ]
```

---

### 🏗️ Архитектурное решение / review кода

```
Прочитай: docs/agents/architect.md, context/interfaces.yaml, context/decisions.yaml

Вопрос: [ОПИСАНИЕ]
```

---

### ⚙️ GitHub Actions / CI/CD

```
Прочитай: docs/agents/devops.md, context/modules/ci.yaml, context/env.yaml

Задача: [ОПИСАНИЕ]
```

---

### 🔄 Настройка n8n воркфлоу / Ollama

```
Прочитай: docs/agents/n8n-specialist.md, context/modules/n8n.yaml, context/interfaces.yaml

Задача: [ОПИСАНИЕ]
```

---

### 🧪 Тесты / отладка

```
Прочитай: docs/agents/qa-engineer.md, context/modules/scraper.yaml, context/interfaces.yaml

Задача: [ОПИСАНИЕ]
```

---

### ✍️ Промпт для Ollama / улучшение промптов агентов

```
Прочитай: docs/agents/prompt-engineer.md, n8n/prompts/evaluator.md

Задача: [ОПИСАНИЕ]
```

---

## Текущий статус проекта

Снимок статусов из `context/roadmap.yaml` (проверено 2026-09-27; roadmap последний раз
обновлялся 2026-06-02). Перед тем как называть фазу текущей, сверься с roadmap.

- **Фаза (`current_phase`):** P13 (Prompt Engineering Best Practices Stack, ADR-017) — `in_progress`
- **Готово (`done`):** P0–P5 (bootstrap, scraper + GitHub Actions, n8n webhook, Ollama, Notion, Telegram), P12 (LLM Provider Adapter Pattern, ADR-016)
- **In progress:** P6 (E2E Hardening & Monitoring), P7 (Cloud Migration — Oracle Cloud + Cloud LLM), P10 (Promptfoo evaluation & CI/CD), P13
- **Открытые задачи P13:** P13-1÷P13-3 `done`; P13-4 (few-shot) … P13-12 `pending`
- **Pending:** P8, P9, P11, P14 (Manual Job URL Checker), P15 (Gemini 2.0 Flash Primary + OpenRouter Fallback)

## Правило одной строки

> Назови задачу; при необходимости добавь «прочитай `docs/agents/<роль>.md` и `context/modules/<модуль>.yaml`».
