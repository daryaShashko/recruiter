# ADR-012: Evaluator Observability — Evaluation Log + Feedback Loop

─────────────────────────────────────────────────────────
**ADR-012:** Add full evaluation tracing and human feedback loop for LLM evaluator
**Date:** 2026-05-25
**Status:** Proposed
─────────────────────────────────────────────────────────

## CONTEXT

The current evaluate workflow (`n8n/workflows/evaluate.json`) has a **blind spot**:
rejected vacancies go to `NoOp: Discard Non-Match` — a dead end with zero observability.

Out of ~200 daily vacancies, approximately 180 are rejected by the LLM. There is currently
**no way to know**:
- How many rejections were correct (true negatives)
- How many good vacancies were wrongly rejected (false negatives)
- How many bad vacancies slipped through (false positives)
- Whether evaluator accuracy drifts over time (especially after model/prompt changes)
- What patterns of vacancies consistently break the evaluation

This makes prompt tuning impossible — you can't improve what you can't measure.

The problem becomes more critical with ADR-011 (Cloud LLM migration): changing the model
from local Ollama to Groq/Gemini may shift evaluation behavior in unpredictable ways.
Without a baseline measurement, there's no way to detect regression.

## DECISION

Implement a 4-level observability system, deployed incrementally:

### Level 1: Evaluation Log (Notion Database) — IMMEDIATE

Create a second Notion database `Evaluation Log` that records **every** LLM decision
(both match:true and match:false). A new Notion Create Page node is added in the
evaluate workflow **before** the `IF: Match?` node, so all decisions are logged
regardless of outcome.

Schema:

| Property       | Type         | Description                                    |
|----------------|--------------|------------------------------------------------|
| Title          | Title        | Job title                                      |
| Company        | Text         | Company name                                   |
| URL            | URL          | Job posting URL                                |
| Source         | Select       | justjoin / nofluffjobs / manual                |
| Match          | Checkbox     | LLM decision: true/false                       |
| Reason         | Text         | LLM reason (verbatim from response)            |
| Model          | Text         | Model used (llama3.1 / groq-llama3 / gemini)   |
| Batch ID       | Text         | ISO timestamp of the batch run                 |
| Evaluated At   | Date         | When evaluation happened                       |
| Human Verdict  | Select       | Correct / Wrong–Should Match / Wrong–Should Reject / Pending |
| Tags           | Multi-select | Tech stack extracted from vacancy              |

### Level 2: Telegram Feedback — NEXT SPRINT

Extend Telegram alerts with inline keyboard buttons (👍 Correct / 👎 Wrong) on matched
vacancies. Add new bot commands for reviewing rejected vacancies:
- `/rejected` — show last 10 rejected (title + reason)
- `/rejected 20` — show last 20
- `/wrong <url>` — mark a rejected vacancy as "Should Match" in Evaluation Log

A new n8n workflow `Feedback Handler` processes Telegram callback_query events and
updates the `Human Verdict` field in the Evaluation Log Notion database.

### Level 3: Weekly Accuracy Report — AFTER 2 WEEKS OF DATA

A cron-triggered n8n workflow (weekly) queries the Evaluation Log for entries with
`Human Verdict != Pending`, calculates accuracy metrics, and sends a summary to Telegram:
- Total evaluated / matched / rejected
- Human-verified: correct / wrong
- Accuracy percentage
- Common patterns in wrong decisions

### Level 4: Dynamic Profile Tuning — FUTURE (NestJS stage)

Store evaluator profile (target stack, seniority, location) in a Notion page as key-value
config. n8n reads this config before each evaluation and injects into the system prompt.
Telegram commands (`/profile add-stack python`, `/profile remove-stack react`) modify
the config in real time.

**Level 4 is explicitly deferred** — it requires dynamic prompt generation and config
management that is better suited for a NestJS backend.

## RATIONALE

- **Can't improve what you can't measure**: prompt tuning without data is guesswork
- **Model migration safety net**: ADR-011 changes the LLM — the log provides a before/after
  comparison baseline
- **Notion is already integrated**: adding a second DB is one extra node, not a new service
- **Incremental deployment**: each level builds on the previous one; Level 1 alone provides
  80% of the value
- **Telegram feedback is fast**: inline buttons = 1-tap feedback, no context switching

## CONSEQUENCES

### Positive
- Full visibility into evaluator behavior (matches AND rejections)
- Ability to detect false negatives (missed good vacancies)
- Data-driven prompt improvements instead of guessing
- Regression detection when changing models (Ollama → Groq → Gemini)
- Notion provides free UI for filtering, sorting, and reviewing evaluations

### Negative / Trade-offs
- **Extra Notion API calls**: +1 API call per vacancy for logging
  (200 vacancies/day = 200 extra calls; within 3 req/s limit with throttled queue)
- **Notion storage growth**: ~200 records/day = ~6000/month; Notion free tier handles this
- **Manual review effort**: someone must periodically mark `Human Verdict` — not automated
- **Telegram inline keyboards**: require callback_query handling — a separate workflow

### Interface changes
- New Notion Database: `Evaluation Log` (separate from `AI Recruiter Board`)
- New n8n workflow: `Feedback Handler` (Level 2)
- New n8n workflow: `Weekly Report` (Level 3)
- New env var: `NOTION_EVAL_LOG_DB_ID`
- `EvaluationResult`: **no change** to the interface itself
- `evaluate.json`: one new node added before `IF: Match?`

### Follow-up tasks
- `EVAL-1` through `EVAL-12` (see roadmap.yaml Phase 8)
- Update `notion-schema.md` with Evaluation Log schema
- Update `env.yaml` with `NOTION_EVAL_LOG_DB_ID`
- Update `architect.md` with observability requirements

─────────────────────────────────────────────────────────
