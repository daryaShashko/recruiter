# Architecture Overview

## Data Flow

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
- Evaluates each job with Ollama LLM
- Routes match:true jobs to Notion + Telegram

### Ollama (Local LLM)
- Model: Llama 3.1 8B
- No rate limits, no API costs
- keep_alive: 0 to free VRAM after each request
- Returns strict JSON: {match, reason, url}

### Notion Database
- Acts as persistent storage + Kanban board
- Deduplication source (query by URL before insert)
- Manual review workflow

### Telegram
- Alerts channel for new matching jobs
- Manual /check <url> command for on-demand evaluation

## n8n Tunnel Setup

```bash
# Start n8n with public webhook tunnel
npx n8n start --tunnel

# The tunnel URL looks like:
# https://abc123.hooks.n8n.cloud
#
# Add to GitHub Secrets as WEBHOOK_URL:
# https://abc123.hooks.n8n.cloud/webhook/jobs/ingest
```
