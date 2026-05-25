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
| `Match Reason` | Text | LLM explanation (1 sentence from Ollama) |
| `Salary` | Text | Salary range string (e.g. "15,000–20,000 PLN B2B") |
| `Status` | Select | `New`, `Review`, `Applied`, `Rejected` |
| `Location` | Text | City or "Remote" |
| `Scraped At` | Date | ISO timestamp when scraped |

## Kanban Columns (Status Values)

| Status | Meaning |
|---|---|
| `New` | Just added by the pipeline — not yet reviewed |
| `Review` | Marked for closer look |
| `Applied` | Application submitted |
| `Rejected` | Decided not to apply |

## Deduplication Strategy

Before creating a new page, n8n queries Notion:
```
filter: {
  property: "URL",
  url: { equals: <incoming_url> }
}
```
If any result is returned -> skip (already exists).

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
| `URL` | URL | Direct link to job posting |
| `Source` | Select | `justjoin`, `nofluffjobs`, `linkedin`, `manual` |
| `Match` | Checkbox | LLM decision: true = match, false = reject |
| `Reason` | Text | LLM reason (verbatim, 1 sentence) |
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

The Notion Create Page node for Evaluation Log is placed in `evaluate.json`:
- **After**: `Code: Parse Ollama Response`
- **Before**: `IF: Match?`
- Logs every item regardless of match/reject outcome

