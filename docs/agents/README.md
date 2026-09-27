# Role notes — AI Recruiter Pipeline

> **Как пользоваться этим файлом:** Это справочник по роль-заметкам: какая заметка
> покрывает какую область и как устроен контекст. Читать его перед каждой задачей не
> нужно.

> **Статус файлов.** `docs/agents/*.md` — обычные текстовые заметки о ролях (правила
> домена и чеклисты), единые для всех инструментов. Это не определения агентов и не
> настройки конкретного CLI/IDE. Общие правила — в [`AGENTS.md`](../../AGENTS.md),
> карта адаптеров — в [`docs/agent-tools.md`](../agent-tools.md).

---

## Обзор

These notes support development work on the **AI Recruiter** pipeline — a
personal job-hunting system that scrapes IT job boards daily, evaluates postings with
a local LLM, and writes matching roles to Notion while alerting via Telegram.

```
GitHub Actions (Playwright scraper)
    → POST /webhook/jobs/ingest
    → n8n: normalize → split → dedup (Notion) → Ollama (llama3.1:8b)
        → IF match: true → Notion Create Page + Telegram alert
```

There are **9 role notes** at `docs/agents/<name>.md`. Each holds the domain rules and
checklists for one area. The agent working on a task reads the note(s) for the areas the
task touches and does the work itself; notes do not coordinate, delegate, or hand off
work, and a clear request needs no Task Brief or task ID.

---

## Состав команды

| Role | File | Covers | Read when |
|---|---|---|---|
| **Planning / Roadmap** | `orchestrator.md` | Goal decomposition, roadmap status, task IDs | When deciding what to work on next, breaking down a multi-area goal, or updating roadmap status |
| **Architect** | `architect.md` | Architecture decisions, ADRs, code review against architecture | When designing a new module, changing interfaces, or reviewing structure |
| **TypeScript Developer** | `developer.md` | All TypeScript / Node.js / Playwright code | When writing or fixing any scraper, sender, or utility code |
| **QA Engineer** | `qa-engineer.md` | Jest + Playwright tests, edge cases, coverage | When writing tests or investigating a bug |
| **n8n Specialist** | `n8n-specialist.md` | n8n workflows, Ollama integration, JSON export | When building or modifying any n8n workflow |
| **DevOps Engineer** | `devops.md` | GitHub Actions, secrets, CI/CD pipelines | When touching `.github/workflows/` or managing secrets |
| **Business Analyst** | `business-analyst.md` | Feature value from recruiter's perspective, prioritization | When deciding whether to build a feature or defining acceptance criteria |
| **Prompt Engineer** | `prompt-engineer.md` | All prompts: Ollama evaluator, agent prompts, n8n Code nodes | When writing, fixing, or reviewing any prompt in the project |
| **Product Manager** | `product-manager.md` | Feature evaluation, staging, roadmap tasks generation | When analyzing a new idea, defining MVP, or updating roadmap.yaml |

---

## Система YAML-контекста

> **Critical.** Read this section before your first session.

### Что это такое

The `context/` directory contains compact YAML manifest files that describe the
project state — interfaces, environment variables, module exports, roadmap status,
and architecture decisions. They are maintained in sync with the source code.

Read these YAML files to orient before opening raw source files. They may be stale:
verify important claims against the relevant code or configuration (see `AGENTS.md`).

### Почему это важно

| Approach | Example | Token cost |
|---|---|---|
| Reading source file | `scraper/src/types.ts` (80 lines) | ~600 tokens |
| Reading YAML manifest | `context/interfaces.yaml` (same info) | ~120 tokens |

Ratio: **3–5x fewer tokens** per lookup. Over a full session with multiple file
references, this difference is the gap between staying within context and losing
earlier instructions.

### Карта файлов контекста

| File | Contents |
|---|---|
| `context/project.yaml` | Project overview, tech stack, current phase, repository layout |
| `context/interfaces.yaml` | All TypeScript interfaces: `JobOffer`, `WebhookPayload`, `EvaluationResult` |
| `context/env.yaml` | All environment variables, their type, whether required, default values |
| `context/roadmap.yaml` | Phase and task status — what's done, in progress, or blocked |
| `context/decisions.yaml` | Architecture Decision Records (ADRs) |
| `context/modules/scraper.yaml` | Scraper module: exported functions, patterns, known gaps |
| `context/modules/n8n.yaml` | n8n workflows, Ollama config, Notion field mapping |
| `context/modules/ci.yaml` | GitHub Actions workflows, job names, secrets used |

### Когда читать контекст

> There is no mandatory session-start load. Read the module YAML relevant to the task
> (scraper / n8n / ci) or `context/project.yaml` only when it answers a question the
> task needs, then inspect the relevant source.

---

## Как работать с задачей

1. **State the goal in plain language.** Example: *"I want to add a LinkedIn scraper."*
   or *"The Ollama evaluator is returning match: true for Junior roles, fix it."* No role
   name, task ID, or brief is needed.
2. **The agent reads `AGENTS.md`, then only what the task needs:** the matching role
   note, a relevant `context/` file, and the actual source/configuration.
3. **The agent does and verifies the work.** For a roadmap planning question it checks
   `context/roadmap.yaml` (see `orchestrator.md`).
4. **After code changes, update the relevant YAML files.** See the Sync Protocol
   section below.

---

## Протокол синхронизации

Full rules: [`context/SYNC_PROTOCOL.md`](../../context/SYNC_PROTOCOL.md)

**Core rule:**
> If you change code → update YAML.
> If you change YAML → it cascades to every agent that references it.

The SYNC_PROTOCOL defines exactly which YAML files to update for each type of change
(new TypeScript interface, new env variable, new n8n workflow, new ADR, roadmap
task completed). CI only partly checks this: `context-check.yml` warns (does not block) when
some source files change without their YAML note. See the CI section of `SYNC_PROTOCOL.md`.

---

## Быстрая маршрутизация задач

| Task | Role note |
|---|---|
| Write or fix TypeScript / Playwright code | **Developer** |
| Design module boundary, review architecture, new interface | **Architect** |
| Write or run tests (unit, integration, E2E) | **QA Engineer** |
| Build or modify an n8n workflow | **n8n Specialist** |
| GitHub Actions workflow, CI/CD, secrets | **DevOps** |
| "Is this feature worth building?" / user stories | **Business Analyst** |
| Improve or fix any prompt (Ollama evaluator, agent, Code node) | **Prompt Engineer** |
| "What should I work on next?" / task decomposition | **Planning / Roadmap** |
| Evaluate a new feature idea / create roadmap tasks | **Product Manager** |
| Cross-cutting concern touching multiple areas | **Architect** first, then the note for each affected area |

---

## Синхронизация при эволюции архитектуры

When the project architecture evolves, the following update sequence keeps the notes
consistent (the role note in brackets holds the relevant checklist; whoever makes the
change does the step):

1. Write an ADR and append it to `context/decisions.yaml` (architect)
2. Update `context/roadmap.yaml` with new or modified task IDs (planning / roadmap)
3. Update the relevant module YAML (`context/modules/scraper.yaml` or
   `context/modules/n8n.yaml`) to reflect the code changes (developer / n8n specialist)
4. Check whether any role note references stale information and make surgical edits if
   needed (prompt engineer)
5. The **context CI check** (`context-check.yml`) runs on pull requests: it warns, without
   failing, when some source files changed but their YAML note did not; the blocking
   `scripts/check-agent-surfaces.sh` job fails on missing paths in current notes

This sequence keeps the notes consistent with the code, but they can still drift; the
checked-in code and configuration remain the source of truth.

---

## Структура файлов агентов

Each file in `docs/agents/` is a human-readable role note. Sections usually follow this
template (not every note has every section):

```
1. Роль                   — one paragraph: the area and perspective this note covers
2. Контекст проекта       — pipeline architecture, tech stack, context/ YAML pointers
3. Scope                  — what the area covers (bullets, domain-specific)
4. Key rules / patterns   — hard constraints, canonical patterns with examples
5. Output format          — suggested structure for this kind of result
6. Anti-patterns          — what to refuse or flag
7. Example                — one worked example
```

Shared conventions:
- Notes are read on demand, not loaded at session start.
- A task that spans areas uses each relevant note; it is not split between agents.
