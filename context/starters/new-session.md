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

Ты — Orchestrator. Прочитай контекст и скажи:
1. Текущая фаза и открытые задачи
2. Что логично делать следующим
```

---

### 💻 Пишем TypeScript / Playwright код

```
Прочитай: docs/agents/developer.md, context/interfaces.yaml, context/modules/scraper.yaml

Ты — TypeScript Developer. Задача: [ОПИСАНИЕ]
```

---

### 🏗️ Архитектурное решение / review кода

```
Прочитай: docs/agents/architect.md, context/interfaces.yaml, context/decisions.yaml

Ты — Architect. Вопрос: [ОПИСАНИЕ]
```

---

### ⚙️ GitHub Actions / CI/CD

```
Прочитай: docs/agents/devops.md, context/modules/ci.yaml, context/env.yaml

Ты — DevOps Engineer. Задача: [ОПИСАНИЕ]
```

---

### 🔄 Настройка n8n воркфлоу / Ollama

```
Прочитай: docs/agents/n8n-specialist.md, context/modules/n8n.yaml, context/interfaces.yaml

Ты — n8n Specialist. Задача: [ОПИСАНИЕ]
```

---

### 🧪 Тесты / отладка

```
Прочитай: docs/agents/qa-engineer.md, context/modules/scraper.yaml, context/interfaces.yaml

Ты — QA Engineer. Задача: [ОПИСАНИЕ]
```

---

### ✍️ Промпт для Ollama / улучшение промптов агентов

```
Прочитай: docs/agents/prompt-engineer.md, n8n/prompts/evaluator.md

Ты — Prompt Engineer. Задача: [ОПИСАНИЕ]
```

---

## Текущий статус проекта

- **Фаза:** P13 (Prompt Engineering — ADR-017) — в процессе
- **Готово:** P0–P5 (Scraper→CI), P12 (LLM Provider Adapters, ADR-016)
- **In progress:** P6 (Sources), P7 (Cloud/Oracle), P10 (Scraper v2), P13 (Prompt Eng)
- **Открытые задачи P13:** P13-4 (few-shot), P13-5 (n8n schema), P13-6÷P13-12 — см. context/roadmap.yaml
- **Следующая фаза:** P14 — Gemini Primary + OpenRouter Fallback

## Правило одной строки

> Назови задачу; при необходимости добавь «прочитай `docs/agents/<роль>.md` и `context/modules/<модуль>.yaml`».
