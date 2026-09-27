# SYNC PROTOCOL — Протокол синхронизации контекста

> **Правило #1**: Если изменяется код → обновляется YAML.  
> **Правило #2**: Если изменяется YAML → агенты автоматически видят актуальный контекст.  
> **Правило #3**: PR без обновления YAML (при изменении кода) не мержится. Это правило
> процесса: CI его не блокирует, а только предупреждает (см. «CI-проверка»).

---

## Таблица зависимостей

| Что изменилось | Что обновить | Кто отвечает |
|---|---|---|
| `scraper/src/types.ts` | `context/interfaces.yaml` | Developer |
| `scraper/src/config.ts` | `context/modules/scraper.yaml` (key_values) | Developer |
| Новый scraper добавлен | `context/modules/scraper.yaml` (files section) + `context/project.yaml` | Developer |
| `scraper/package.json` (версии) | `context/project.yaml` (tech_stack) + `context/modules/scraper.yaml` (dependencies) | Developer |
| Задача выполнена (P1-X done) | `context/roadmap.yaml` (status: done) + `README.md` checkbox | Orchestrator |
| Новый ADR принят | `context/decisions.yaml` | Architect |
| Архитектура изменилась | `docs/architecture.md` + `context/decisions.yaml` + `context/project.yaml` (architecture.data_flow) | Architect |
| n8n workflow создан | `context/modules/n8n.yaml` (status: created) + локальный экспорт JSON в `n8n/workflows/` (в `.gitignore`, не коммитится) | n8n Specialist |
| n8n workflow изменён | Локальный реэкспорт JSON + обновить `context/modules/n8n.yaml` (и `context/ingest-workflow.yaml` для ingest) | n8n Specialist |
| Ollama промпт изменён | `context/modules/n8n.yaml` (evaluator_prompt notes) | Prompt Engineer |
| Новая переменная окружения | `context/env.yaml` + `.env.example` | Developer / DevOps |
| GitHub Actions workflow изменён | `context/modules/ci.yaml` | DevOps |
| Новый агент добавлен | `docs/agents/README.md` (roster table) + `context/SYNC_PROTOCOL.md` (эта таблица) | Orchestrator |
| Агентский промпт изменён | `docs/agents/README.md` если изменилась роль | Prompt Engineer |
| Notion schema изменилась | `docs/notion-schema.md` + `context/modules/n8n.yaml` (notion_field_mapping) | Architect |

---

## Процедура обновления контекста

### При завершении задачи (конец каждой сессии)

```
1. Определить, что изменилось (код, конфиг, воркфлоу, решение)
2. Открыть таблицу выше → найти строку с изменением
3. Обновить все файлы из колонки "Что обновить"
4. Коммит формат: "context: update {filename} — {what changed}"
   Пример: "context: update roadmap.yaml — P1-6 done, P1-7 in_progress"
```

### При смене фазы

```
1. context/roadmap.yaml → обновить все задачи фазы, установить status: done
2. context/project.yaml → обновить current_phase
3. README.md → отметить чекбоксы фазы
4. Оповестить команду: "Phase N complete. Starting Phase N+1."
```

### При изменении архитектуры

```
1. Architect пишет ADR → context/decisions.yaml
2. Обновить docs/architecture.md (ASCII diagram если нужно)
3. Обновить context/project.yaml (architecture.data_flow если изменился)
4. Prompt Engineer проверяет: нужно ли обновлять агентские промпты?
5. Orchestrator обновляет context/roadmap.yaml (новые/изменённые задачи)
```

---

## Формат коммитов для изменений контекста

```
context: <action> <file> — <description>

Примеры:
  context: update roadmap.yaml — P1-8 done, added location filter to JustJoin
  context: update interfaces.yaml — added ScrapedJobDetail interface
  context: update decisions.yaml — ADR-006 added (pagination strategy)
  context: update modules/n8n.yaml — ingest.json created (P2 complete)
  context: update env.yaml — added SCRAPER_PAGES_LIMIT var
```

---

## Проверка актуальности перед началом сессии

Перед тем как начать работу, агент должен спросить себя:

```
1. Загружен ли context/project.yaml? → текущая фаза, tech stack
2. Загружен ли context/roadmap.yaml? → что сделано, что в процессе
3. Загружен ли нужный context/modules/*.yaml? → детали модуля
4. Есть ли незакрытые known_gaps в модуле? → учесть в работе
```

**YAML — заметки, а не источник истины.** Если утверждение важно для задачи, сверь его с
кодом или конфигурацией (`AGENTS.md` → Source of truth).

---

## CI-проверка (автоматическая)

Файл `.github/workflows/context-check.yml` запускается на каждый PR в `main` и вручную
(`workflow_dispatch`). В нём два job:

**`check-agent-surfaces` — блокирующий.** Запускает `scripts/check-agent-surfaces.sh`; любой
`FAIL` роняет job. Проверяет в том числе:

- пути в `AGENTS.md`, таблицах `docs/agent-tools.md`, текущих заметках `context/` и `docs/`
  существуют в git (или в `.gitignore` как локальные, или перечислены как planned в
  скрипте); история и планы (`context/roadmap.yaml`, `context/decisions.yaml`, `docs/adr/`,
  `docs/benchmarks/`, post-mortem, PE-лог) не проверяются;
- текущие заметки не называют локальные экспорты `n8n/workflows/*.json` частью репозитория;
- адаптеры, skills, нет `${{ }}` внутри `run:`.

**`check-context-sync` — рекомендательный (advisory).** Сравнивает изменённые файлы PR и
выдаёт `::warning` (аннотация в Checks, не PR comment), job не падает:

- `scraper/src/types.ts` → `context/interfaces.yaml`
- `scraper/src/config.ts` → `context/modules/scraper.yaml`
- `n8n/prompts/evaluator.md` → `context/modules/n8n.yaml`
- `.github/workflows/*` → `context/modules/ci.yaml`
- `.env.example` → `context/env.yaml`

Экспорты n8n (`n8n/workflows/*.json`) в `.gitignore`, в diff PR не попадают и CI не
проверяются. Остальные строки таблицы выше CI не проверяет.

---

## Золотое правило для агентов

> **Начинай с YAML, а не со всего исходного кода, но проверяй важное по коду.**  
> YAML экономит токены, но может устареть; то, что реально работает, определяют код и
> конфигурация.
