# Notion Database Schema: AI Recruiter Board

## Database Name
`AI Recruiter Board`

## View
Kanban view grouped by `Status`

## Properties

| Property | Type | Options / Notes |
|---|---|---|
| `Title` | Title | Job title (e.g. "Senior Node.js Developer") |
| `Company` | Text | Company name |
| `URL` | URL | Direct link to job posting — **used for deduplication** |
| `Source` | Select | `justjoin`, `nofluffjobs`, `linkedin`, `manual` |
| `Match Reason` | Text | LLM explanation (reason breakdown from Ollama) |
| `Salary` | Text | Salary range string (e.g. "15,000–20,000 PLN B2B") |
| `Status` | Select | `Hot Match`, `Review`, `Applied`, `Rejected` |
| `Location` | Text | City or "Remote" |
| `Score` | Number | Composite weighted score (0-100) from LLM |
| `Tech Stack Match` | Number | Sub-score (0-100) for tech stack matching |
| `Seniority Match` | Number | Sub-score (0-100) for seniority levels |
| `Red Flags` | Multi-select | List of reasons for point deductions |
| `Scraped At` | Date | ISO timestamp when scraped |

## Kanban Columns (Status Values)

| Status | Meaning |
|---|---|
| `Hot Match` | Strongly matched vacancy (score >= 80) — alerts sent to Telegram |
| `Review` | Marginally matched vacancy (score 50-79) — review list in Notion |
| `Applied` | Application submitted |
| `Rejected` | Decided not to apply |

## Deduplication Strategy

Deduplication happens at **three levels** in the `Ingest Jobs` workflow (local-only export
`n8n/workflows/ingest.json`, gitignored; map: `context/ingest-workflow.yaml`):

### Level 1 — Within-batch (Code: Dedup Batch)
Before processing, all jobs in the same webhook payload are deduplicated by `fingerprint` and `urlNorm` using in-memory Sets. Prevents wasting Ollama compute on duplicates inside a single scrape run.

### Level 2 — Cross-batch, cross-platform (HTTP: Query Notion API)
Before each job is sent to Ollama, n8n calls Notion API directly with a 3-condition OR filter:
```json
{
  "filter": {
    "or": [
      { "property": "Fingerprint", "rich_text": { "equals": "<fingerprint>" } },
      { "property": "URL", "url": { "equals": "<urlNorm>" } },
      { "property": "URL", "url": { "equals": "<originalUrl>" } }
    ]
  },
  "page_size": 1
}
```
- `Fingerprint` match: catches the same job from different platforms (JustJoin vs NoFluffJobs) or reposted jobs with new URLs.
- `URL` (normalized) match: catches same-platform reposts with tracking params stripped.
- `URL` (original) match: backward compatibility for records created before normalization was added.

### Fingerprint Generation
```
normalizeCompany(company)  →  lowercase, strip legal forms (Sp. z o.o., LLC, GmbH, etc.)
normalizeTitle(title)      →  lowercase, strip seniority (Senior/Junior/Lead/etc.), normalize Full-Stack/Frontend/etc.
fingerprint = FNV1a64(normalizedCompany + "::" + normalizedTitle).slice(16 hex chars)
```
Implemented in `Code: Normalize Jobs` using pure JavaScript (no external modules — n8n sandbox restriction).

## Integration Setup

1. Go to https://www.notion.so/my-integrations
2. Create new integration: "AI Recruiter"
3. Copy the `Internal Integration Token` -> save as `NOTION_TOKEN`
4. Open your database in Notion -> Share -> Invite your integration
5. Copy the database ID from the URL:
   `https://notion.so/Your-DB-Name-{DATABASE_ID}?v=...`
   -> save as `NOTION_DB_ID`

---

## Database 2: Evaluation Log (ADR-012, Phase 8)

> **Status:** Planned — created in Phase 8, Level 1 (EVAL-1)
>
> **Purpose:** Log EVERY LLM evaluation decision (both match:true AND match:false)
> to enable accuracy measurement, false-negative detection, and data-driven prompt tuning.
> This is separate from the main AI Recruiter Board — it stores raw evaluation data,
> not curated job matches.

### Database Name
`Evaluation Log`

### View
Table view, sorted by `Evaluated At` descending

### Properties

| Property | Type | Options / Notes |
|---|---|---|
| `Title` | Title | Job title |
| `Company` | Text | Company name |
| `Fingerprint` | Text | FNV-1a 64-bit hash of `normalized_company::normalized_title` — primary dedup key, cross-platform |
| `URL` | URL | Direct link to job posting |
| `Source` | Select | `justjoin`, `nofluffjobs`, `linkedin`, `manual` |
| `Match` | Checkbox | true = match (overall_score >= 50), false = reject (overall_score < 50) |
| `Reason` | Text | LLM reason (verbatim, 1 sentence) |
| `Score` | Number | Composite weighted score (0-100) from LLM |
| `Tech Stack Match` | Number | Sub-score (0-100) for tech stack matching |
| `Seniority Match` | Number | Sub-score (0-100) for seniority levels |
| `Red Flags` | Multi-select | List of reasons for point deductions |
| `Model` | Text | Model used: `llama3.1`, `groq-llama3`, `gemini-flash` |
| `Batch ID` | Text | ISO timestamp of the batch run (groups items from same run) |
| `Evaluated At` | Date | When evaluation happened |
| `Human Verdict` | Select | `Correct`, `Wrong – Should Match`, `Wrong – Should Reject`, `Pending` |
| `Tags` | Multi-select | Tech stack tags from vacancy |

### Human Verdict Values

| Value | Meaning |
|---|---|
| `Pending` | Not yet reviewed by human (default) |
| `Correct` | LLM decision was right |
| `Wrong – Should Match` | LLM rejected, but vacancy was actually relevant (false negative) |
| `Wrong – Should Reject` | LLM matched, but vacancy was not relevant (false positive) |

### Recommended Notion Views

| View Name | Filter | Purpose |
|---|---|---|
| `All Evaluations` | None | Full log, sorted by date |
| `Wrong Decisions` | `Human Verdict` contains "Wrong" | Find patterns in errors |
| `Rejected` | `Match` = unchecked | Review rejected vacancies |
| `This Week` | `Evaluated At` is within past week | Weekly review scope |

### Integration Setup

Same Notion Integration as AI Recruiter Board (share the database with the existing integration).
Save database ID as `NOTION_EVAL_LOG_DB_ID` in `.env` and n8n credentials.

### n8n Workflow Integration

The Notion Create Page node for Evaluation Log (`Notion: Log to Eval Log`) is placed in the
`Ingest Jobs` workflow (`ingest.json`; `evaluate.json` is deprecated):
- **After**: `Code: Parse Ollama Response`
- **Before**: `IF: Match?`
- Logs every item regardless of match/reject outcome

