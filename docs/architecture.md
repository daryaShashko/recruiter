# Architecture Overview

## Current Data Flow (Local POC)

> **Status:** Active — Phases 0–5 done, Phase 6 in progress
>
> **Diagram last updated 2026-05-25, before P12 and EVAL-1.** The running ingest workflow is described in
> [`context/ingest-workflow.yaml`](../context/ingest-workflow.yaml): single `Ingest Jobs`
> workflow, `Code: LLM Router` (ollama | gemini | anthropic), Evaluation Log for every
> decision, score routing (>= 80 Board + Telegram, 50–79 Board, < 50 log only). The
> workflow export itself is local-only (`n8n/workflows/*.json` is gitignored).

```
+----------------------------------+
|     GitHub Actions Runner        |
|  (Ubuntu, runs daily at 08:00)   |
|                                  |
|  +-------------+ +-----------+   |
|  | JustJoin    | |NoFluffJobs|   |
|  |  Scraper    | |  Scraper  |   |
|  | (Playwright)| |(Playwright)|  |
|  +------+------+ +-----+-----+   |
|         +------+--------+        |
|           +----+----+            |
|           | Sender  |            |
|           | (axios) |            |
|           +----+----+            |
+----------------+-----------------+
                 | POST /webhook/jobs/ingest
                 v
+------------------------------------+
|           n8n (local)              |
|    exposed via --tunnel            |
|                                    |
|  Webhook -> Normalize -> Split     |
|       |                            |
|  Dedup check (Notion Query)        |
|       | new only                   |
|  Ollama (Llama 3.1 8B)            |
|  keep_alive: 0                     |
|       | match: true                |
|  Notion Create Page                |
|       |                            |
|  Telegram Alert                    |
+------------------------------------+
         ^
         | /check <url>
+---------+---------+
| Telegram Bot      |
| (manual input)    |
+-------------------+
```

---

## Planned Data Flow (Cloud — Phase 7 + Phase 8)

> **Status:** Proposed — ADR-010, ADR-011, ADR-012
>
> Key changes:
> - n8n moves to Oracle Cloud Always Free (ARM, 24 GB RAM)
> - Ollama replaced with Cloud LLM API (Groq/Gemini free tier)
> - PostgreSQL added for n8n internal state
> - Caddy reverse proxy for automatic HTTPS
> - Evaluation Log DB captures ALL decisions (match + reject)

```
+----------------------------------+
|     GitHub Actions Runner        |
|  (Ubuntu, runs daily at 08:00)   |
|                                  |
|  +-------------+ +-----------+   |
|  | JustJoin    | |NoFluffJobs|   |
|  |  Scraper    | |  Scraper  |   |
|  | (Playwright)| |(Playwright)|  |
|  +------+------+ +-----+-----+   |
|         +------+--------+        |
|           +----+----+            |
|           | Sender  |            |
|           | (axios) |            |
|           +----+----+            |
+----------------+-----------------+
                 | POST https://n8n.your-domain.com/webhook/jobs/ingest
                 v
+======================================================+
|  Oracle Cloud Always Free (ARM A1, 4 CPU, 24 GB RAM)  |
|                                                        |
|  +----------+   +--------+   +-------+                |
|  | Caddy    |-->|  n8n   |-->|Postgres|               |
|  | (TLS)    |   |        |   |(n8n DB)|               |
|  +----------+   +---+----+   +--------+               |
|                     |                                  |
|     Webhook -> Normalize -> Split In Batches           |
|         |                                              |
|     Dedup check (Notion Query)                         |
|         | new only                                     |
|     Cloud LLM API (Groq primary / Gemini fallback)     |
|     + Wait node (4s) = ≤15 RPM                         |
|         |                                              |
|     ┌───┴─────────────────┐                            |
|     │ Notion: Log to      │ ← ADR-012                  |
|     │ Evaluation Log DB   │   (ALL decisions logged)   |
|     └───┬─────────────────┘                            |
|         |                                              |
|     IF match === true                                  |
|         |              |                               |
|     Notion Board    NoOp: Discard                      |
|     + Telegram         (but logged above)              |
|     (+ inline 👍/👎)                                    |
+======================================================+
         ^
         | /check <url>  /rejected  /wrong <url>
+---------+---------+
| Telegram Bot      |
| (manual + feedback|
|  + inline kbd)    |
+-------------------+
```

---

## Component Responsibilities

### GitHub Actions Scraper
- Runs on Ubuntu runner (free tier)
- Playwright + Chromium to bypass Cloudflare
- Intercepts XHR API responses (no DOM parsing needed)
- Sends clean JSON array to n8n webhook
- Saves debug artifact with raw scraped data

### n8n Pipeline
- Receives webhook payload
- Normalizes data structure
- Deduplicates against Notion database
- Evaluates each job with LLM (`Code: LLM Router`: Ollama, Gemini, or Anthropic)
- **Logs every evaluation to Evaluation Log DB** (ADR-012; EVAL-1 and EVAL-4 done)
- Routes by `overall_score`: >= 80 Notion Board + Telegram, 50–79 Notion Board, < 50 log only

### LLM Evaluator
- **Current:** inline code in the n8n `Code: LLM Router` node (ADR-016), not
  `n8n/providers/`. Two generator scripts exist: `scripts/p12_6_llm_router.py`
  (`$env.LLM_PROVIDER`, default Ollama) and the later `scripts/patch_llm_router.py`
  (CLOUD-11-A: Gemini `gemini-2.0-flash` hardcoded). Which one runs is known only from the
  local export or n8n.
- **Planned (ADR-011):** Groq (primary) + Gemini 1.5 Flash (fallback); throttled queue
  (Wait node 4s → ≤15 RPM). P15 (pending) plans Gemini 2.0 Flash primary + OpenRouter fallback.
- Returns strict JSON: `{ overall_score, tech_stack_match, seniority_match, red_flags, reason, url }`

### Notion Databases
- **AI Recruiter Board** — persistent storage for matched jobs + Kanban board
  - Deduplication source (query by URL before insert)
  - Manual review workflow (New → Review → Applied → Rejected)
- **Evaluation Log** (planned, ADR-012) — logs ALL LLM decisions
  - Human Verdict field for accuracy tracking
  - Enables false-negative detection and prompt tuning

### Telegram
- Alerts channel for new matching jobs (with inline 👍/👎 buttons — planned)
- Manual /check <url> command for on-demand evaluation
- /rejected, /wrong commands for reviewing rejected vacancies (planned)

---

## Deployment Modes

### Current: Local + Tunnel
```bash
# Start n8n with public webhook tunnel
npx n8n start --tunnel

# The tunnel URL looks like:
# https://abc123.hooks.n8n.cloud
#
# Add to GitHub Secrets as WEBHOOK_URL:
# https://abc123.hooks.n8n.cloud/webhook/jobs/ingest
```

### Planned: Oracle Cloud (ADR-010)
```bash
# On Oracle Cloud server:
cd /opt/n8n
docker compose up -d

# Stable HTTPS URL via Caddy auto-TLS:
# https://n8n.your-domain.com
#
# Set once in GitHub Secrets as WEBHOOK_URL:
# https://n8n.your-domain.com/webhook/jobs/ingest
```

---

## ADR References

| ADR | Title | Status |
|-----|-------|--------|
| ADR-010 | [Cloud Migration — Oracle Always Free](adr/ADR-010-cloud-migration-oracle.md) | Proposed |
| ADR-011 | [Cloud LLM — Groq/Gemini](adr/ADR-011-cloud-llm-migration.md) | Proposed |
| ADR-012 | [Evaluator Observability](adr/ADR-012-evaluator-observability.md) | Proposed |
