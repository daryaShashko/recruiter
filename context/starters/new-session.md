# Как начать новую сессию в Zed AI

## Быстрый старт — скопируй нужный блок

---

### 🎯 Не знаю с чего начать / планирование задач

```
@docs/agents/orchestrator.md @context/project.yaml @context/roadmap.yaml

Ты — Orchestrator. Прочитай контекст и скажи:
1. Текущая фаза и открытые задачи
2. Что логично делать следующим
```

---

### 💻 Пишем TypeScript / Playwright код

```
@docs/agents/developer.md @context/interfaces.yaml @context/modules/scraper.yaml

Ты — TypeScript Developer. Задача: [ОПИСАНИЕ]
```

---

### 🏗️ Архитектурное решение / review кода

```
@docs/agents/architect.md @context/interfaces.yaml @context/decisions.yaml

Ты — Architect. Вопрос: [ОПИСАНИЕ]
```

---

### ⚙️ GitHub Actions / CI/CD

```
@docs/agents/devops.md @context/modules/ci.yaml @context/env.yaml

Ты — DevOps Engineer. Задача: [ОПИСАНИЕ]
```

---

### 🔄 Настройка n8n воркфлоу / Ollama

```
@docs/agents/n8n-specialist.md @context/modules/n8n.yaml @context/interfaces.yaml

Ты — n8n Specialist. Задача: [ОПИСАНИЕ]
```

---

### 🧪 Тесты / отладка

```
@docs/agents/qa-engineer.md @context/modules/scraper.yaml @context/interfaces.yaml

Ты — QA Engineer. Задача: [ОПИСАНИЕ]
```

---

### ✍️ Промпт для Ollama / улучшение промптов агентов

```
@docs/agents/prompt-engineer.md @n8n/prompts/evaluator.md

Ты — Prompt Engineer. Задача: [ОПИСАНИЕ]
```

---

## Текущий статус проекта

- **Фаза:** P1 (Scraper) — в процессе
- **Готово:** P0 полностью, P1 частично (scraper файлы есть)
- **Открытые задачи P1:** P1-5 (browser.ts), P1-9/P1-14 (тесты), P1-20 (mock-тест sender), P1-21–P1-26 (GitHub Actions)
- **Следующая фаза:** P2 — n8n Webhook Pipeline

## Правило одной строки

> Начало сессии = `@agents/[кто нужен]` + `@context/project.yaml` + `@context/modules/[что делаем].yaml`
