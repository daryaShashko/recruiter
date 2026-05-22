# Multi-Agent System — AI Recruiter Pipeline

> **Как пользоваться этим файлом:** Это справочник по команде агентов. Читай перед
> началом сессии, чтобы понять, кому делегировать задачу и как устроен контекст.

---

## Обзор

The agent team automates all development work on the **AI Recruiter** pipeline — a
personal job-hunting system that scrapes IT job boards daily, evaluates postings with
a local LLM, and writes matching roles to Notion while alerting via Telegram.

```
GitHub Actions (Playwright scraper)
    → POST /webhook/jobs/ingest
    → n8n: normalize → split → dedup (Notion) → Ollama (llama3.1:8b)
        → IF match: true → Notion Create Page + Telegram alert
```

The team has **8 specialist agents**. Each agent has a skill file at `docs/agents/<name>.md`
that serves as its system prompt. No agent does everything — each has a strict domain.
The Orchestrator coordinates the team and routes tasks using Task Briefs.

---

## Состав команды

| Agent | File | Primary Role | When to Use |
|---|---|---|---|
| **Orchestrator** | `orchestrator.md` | Coordinates the team, decomposes goals, tracks the Roadmap | When you don't know what to work on next, or need a task broken down |
| **Architect** | `architect.md` | Architecture decisions, ADRs, code review against architecture | When designing a new module, changing interfaces, or reviewing structure |
| **TypeScript Developer** | `developer.md` | All TypeScript / Node.js / Playwright code | When writing or fixing any scraper, sender, or utility code |
| **QA Engineer** | `qa-engineer.md` | Jest + Playwright tests, edge cases, coverage | When writing tests or investigating a bug |
| **n8n Specialist** | `n8n-specialist.md` | n8n workflows, Ollama integration, JSON export | When building or modifying any n8n workflow |
| **DevOps Engineer** | `devops.md` | GitHub Actions, secrets, CI/CD pipelines | When touching `.github/workflows/` or managing secrets |
| **Business Analyst** | `business-analyst.md` | Feature value from recruiter's perspective, prioritization | When deciding whether to build a feature or defining acceptance criteria |
| **Prompt Engineer** | `prompt-engineer.md` | All prompts: Ollama evaluator, agent prompts, n8n Code nodes | When writing, fixing, or reviewing any prompt in the project |

---

## Система YAML-контекста

> **Critical.** Read this section before your first session.

### Что это такое

The `context/` directory contains compact YAML manifest files that describe the
project state — interfaces, environment variables, module exports, roadmap status,
and architecture decisions. They are maintained in sync with the source code.

Agents read these YAML files **instead of** reading raw source files, except when
they need a specific implementation detail.

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

### Правило сессии

> **At the start of EVERY session:**
> 1. Load `context/project.yaml` — project overview, tech stack, current phase
> 2. Load the module YAML relevant to the task (scraper / n8n / ci)
> 3. Only read actual source files if the YAML context is insufficient for the task

---

## Начало сессии

Follow these steps every time you open a new conversation with an agent:

**Step 1 — State your goal to the Orchestrator in plain language.**
Example: *"I want to add a LinkedIn scraper."* or *"The Ollama evaluator is returning
match: true for Junior roles, fix it."*

**Step 2 — The Orchestrator loads `context/roadmap.yaml`** to check the current
phase, identify open tasks, and find any blockers.

**Step 3 — The Orchestrator produces a Task Brief and routes it to the right agent.**
The Task Brief is a structured document (see `orchestrator.md`) that specifies goal,
inputs, expected outputs, acceptance criteria, and blockers.

**Step 4 — The assigned agent loads the relevant context YAML, then works.**
The agent does NOT read all source files. It reads `context/project.yaml` + the
relevant module YAML, then fetches specific source files only if needed.

**Step 5 — After the work is done, update the relevant YAML files.**
See the Sync Protocol section below.

---

## Протокол синхронизации

Full rules: [`context/SYNC_PROTOCOL.md`](../../context/SYNC_PROTOCOL.md)

**Core rule:**
> If you change code → update YAML.
> If you change YAML → it cascades to every agent that references it.

The SYNC_PROTOCOL defines exactly which YAML files to update for each type of change
(new TypeScript interface, new env variable, new n8n workflow, new ADR, roadmap
task completed). A CI check enforces that no YAML file is stale after a commit.

---

## Быстрая маршрутизация задач

| Task | Route to |
|---|---|
| Write or fix TypeScript / Playwright code | **Developer** |
| Design module boundary, review architecture, new interface | **Architect** |
| Write or run tests (unit, integration, E2E) | **QA Engineer** |
| Build or modify an n8n workflow | **n8n Specialist** |
| GitHub Actions workflow, CI/CD, secrets | **DevOps** |
| "Is this feature worth building?" / user stories | **Business Analyst** |
| Improve or fix any prompt (Ollama evaluator, agent, Code node) | **Prompt Engineer** |
| "What should I work on next?" / task decomposition | **Orchestrator** |
| Cross-cutting concern touching multiple agents | **Architect** first, then delegate |

---

## Синхронизация при эволюции архитектуры

When the project architecture evolves, the following update sequence keeps all agents
aligned:

1. **Architect** writes an ADR and appends it to `context/decisions.yaml`
2. **Orchestrator** updates `context/roadmap.yaml` with new or modified task IDs
3. **Developer** or **n8n Specialist** updates the relevant module YAML
   (`context/modules/scraper.yaml` or `context/modules/n8n.yaml`) to reflect the
   code changes
4. **Prompt Engineer** reviews whether any agent skill prompts reference stale
   information and makes surgical edits if needed
5. The **SYNC_PROTOCOL CI check** runs on every push and catches any missed updates —
   if a source file changed but its corresponding YAML was not updated, the check fails

This sequence ensures that agents always see a consistent project state at session
start, regardless of when they were last used.

---

## Структура файлов агентов

Each file in `docs/agents/` is both a human-readable reference document and a
copy-paste system prompt. The sections inside each file follow this template:

```
1. Системный промпт       — core identity paragraph (paste this into "system" field)
2. Контекст проекта       — pipeline architecture, tech stack, context/ YAML pointers
3. Responsibilities       — what this agent owns (bullets, domain-specific)
4. Key rules / patterns   — hard constraints, canonical patterns with examples
5. Output format          — required response structure for every answer
6. Anti-patterns          — what the agent must refuse or flag immediately
7. Example session        — one worked example showing correct agent behavior
```

All agents share two universal rules:
- **Always load `context/project.yaml` first** at the start of each session
- **Never do work outside their domain** — route to the correct specialist instead
