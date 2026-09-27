# Роль: планирование задач и дорожная карта (Planning / Roadmap)

> **Роль-заметка.** Обычный текстовый файл с правилами и чеклистами для планирования
> работы и ведения дорожной карты. Читай его, когда пользователь спрашивает, что делать
> дальше, просит разбить многосоставную цель на шаги или обновить статус задач. Это не
> определение агента и не системный промпт: он не запускает других агентов, не
> делегирует им задачи и не требует Task Brief или ID задачи для ясного запроса. Общие
> правила — в [`AGENTS.md`](../../AGENTS.md).

---

## Назначение

```
This note covers planning work on the "AI Recruiter" pipeline: mapping a goal to the
roadmap, finding blockers, splitting cross-cutting work by area, and keeping roadmap
status files consistent. The agent that reads it does the work itself; the role notes
listed below are domain checklists to read, not agents to hand work to.
```

---

## Роль и контекст проекта

```
## PROJECT CONTEXT

The project is an automated AI recruiter pipeline with the following architecture:
  GitHub Actions (Playwright scraper) → POST webhook → n8n → Gemini 2.0 Flash (primary) / OpenRouter (fallback)
                                                              ↓ overall_score >= 80
  Telegram alert ←───────────── n8n → Notion (Kanban board + Evaluation Log)
                                        ↓ overall_score 50-79
                                       Notion (silent review queue)

Tech stack: TypeScript, Node.js 20, Playwright, n8n, Gemini 2.0 Flash (primary LLM), OpenRouter (fallback),
Ollama (local dev), Notion API, Telegram Bot API, GitHub Actions.
Prompt evaluation: Promptfoo + Gemini Flash (llm-rubric grading).

Repository layout:
  /scraper        — Playwright-based job scraper (TypeScript)
  /n8n            — n8n workflow exports (JSON) and LLM prompts
                    context/ingest-workflow.yaml — compact node map (read this, not ingest.json directly)
  /docs           — Architecture docs, Notion schema, agent skill files, ADRs
  /.github        — GitHub Actions workflows

Core data types (from scraper/src/types.ts):
  JobOffer        { id, title, company, url, body, source, location?, salary?, tags?, scrapedAt }
  WebhookPayload  { jobs: JobOffer[], meta: { source, count, sentAt } }
  EvaluationResult (multidimensional, from n8n Code: Parse Ollama Response):
    { overall_score: number (0-100), tech_stack_match: number (0-100),
      seniority_match: number (0-100), red_flags: string[],
      reason: string, url: string, match: boolean }
  Routing: overall_score >= 80 → Telegram + Notion Board
           overall_score 50-79 → Notion Board (silent)
           overall_score < 50  → Evaluation Log only (Discard)

Prompt evaluation (Promptfoo, Phase 10):
  n8n/prompts/promptfooconfig.yaml   — eval config, env-driven LLM provider (LLM_PROVIDER env), Gemini grading
  n8n/prompts/gold_dataset.yaml      — 22 gold test cases (8 true, 9 false, 5 edge)
  n8n/prompts/evaluator-template.json — chat template with assistant prefill {
  Run: cd scraper && npm run eval
```

---

## Дорожная карта и ID задач

```
## ROADMAP AND TASK IDS

Status lives in context/roadmap.yaml (with the matching README.md checkboxes). This note
keeps no status snapshot. Check roadmap.yaml before reporting a phase or task as current
(see AGENTS.md); do not load it for an unrelated small change.

Task IDs:
  - When the work matches an existing roadmap task, mention its ID (P1-1, CLOUD-11-A, …).
  - Do not require an ID before doing a clear request, and do not invent one for work
    that is not a roadmap item.
  - For genuinely new roadmap work, use the provisional PX-NEW-<slug> convention and
    flag it for a roadmap update.
```

---

## Какую роль-заметку читать

```
## ROLE NOTE LOOKUP

Read the note for the area the task touches (first match wins). A task that spans areas
reads each relevant note; it is not split between agents.

  1. scraper/ TypeScript / Playwright code             → developer.md
  2. GitHub Actions .yml / CI pipeline                  → devops.md
  3. n8n workflow JSON / nodes / expressions            → n8n-specialist.md
  4. Test files (*.test.ts / E2E)                       → qa-engineer.md
  5. "Does this make sense for a recruiter?"            → business-analyst.md
  6. Module structure / interface design / ADRs         → architect.md
  7. Notion / Telegram / Ollama integration             → n8n-specialist.md (runtime)
                                                          or developer.md (SDK/API client)
  8. Prompts (evaluator, role notes, Code-node parsing) → prompt-engineer.md
  9. New feature idea / roadmap tasks                   → product-manager.md
 10. Cross-cutting concern                              → architect.md first
```

---

## Декомпозиция цели

```
## GOAL DECOMPOSITION CHECKLIST

Use this for planning requests and multi-area goals. A clear, single-area request is
done directly without it.

  1. Map to the roadmap: find the matching phase/task in context/roadmap.yaml, if any.
  2. Identify blockers: unfinished prerequisite tasks or unresolved decisions
     (for example an interface change that needs an ADR first).
  3. Split by area: one step per area, in dependency order.
  4. State each step's goal, expected output, and acceptance check.
  5. Report which steps are ready, blocked, or already in progress.

If the goal is ambiguous in a way that changes the work, follow AGENTS.md: ask one
decision-changing question or state the assumption you proceed with.
```

---

## Шаблон шага плана (по необходимости)

```
## PLAN STEP TEMPLATE

Optional. Use it when the user asks for a written plan, or when a Feature or
high-assurance task (docs/ai-workflow.md) needs each slice recorded. Omit empty fields.

─────────────────────────────────────────────
Area / role note:   <developer.md, n8n-specialist.md, …>
Task ID:            <roadmap ID or PX-NEW-<slug>, if any>
Goal:               <one sentence: what must be built or decided>
Inputs:             <files, interfaces, env vars, data>
Expected output:    <file path, exported type, workflow change, ADR, …>
Acceptance:         <specific, testable conditions>
Constraints:        <no paid services, 15-min GH runner, …>
Blockers:           <task IDs or decisions needed first, or NONE>
─────────────────────────────────────────────
```

---

## Обновление статуса

```
## STATUS UPDATES

  - context/roadmap.yaml and README.md are updated together: change the task status
    (and current_focus when it moves) in roadmap.yaml, and the matching [ ] checkbox and
    phase status line in README.md. Never update one without the other.
  - Mark a task done only after its acceptance check passed and the user accepted the
    result; say which check supports it.
  - context/SYNC_PROTOCOL.md lists the other context/ files to update for each kind of
    change.
```

---

## Анти-паттерны

```
## ANTI-PATTERNS

- Copying roadmap status into this note or other role notes (it goes stale).
- Inventing task IDs; use context/roadmap.yaml, or PX-NEW-<slug> for new roadmap work.
- Discussing implementation details before checking whether a settled design decision
  (ADR in context/decisions.yaml) already covers them.
- Asking the user to confirm roadmap status, pick a role, or supply an ID before doing a
  clear request.
```

---

## Пример

```
## EXAMPLE

User: "Хочу запустить скрапер на GitHub Actions."

Response (in Russian): check context/roadmap.yaml and .github/workflows/ for the
related tasks and current workflow, say which task IDs this touches and whether any
prerequisite is open, then continue with the change using devops.md. Ask only if the
answer changes the work (for example, whether to change the schedule or only add a job).
```
