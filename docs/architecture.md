# Architecture Overview

## Current Data Flow (Local POC)

> **Status:** Active — Phases 0–5 done, Phase 6 in progress

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
- Evaluates each job with LLM (local Ollama or cloud Groq/Gemini)
- **Logs every evaluation to Evaluation Log DB** (ADR-012, planned)
- Routes match:true jobs to Notion Board + Telegram

### LLM Evaluator
- **Current:** Ollama Llama 3.1 8B (local, no rate limits, keep_alive: 0)
- **Planned (ADR-011):** Groq (primary) + Gemini 1.5 Flash (fallback)
- Throttled Queue pattern: Wait node 4s → ≤15 RPM
- Returns strict JSON: {match, reason, url}

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
