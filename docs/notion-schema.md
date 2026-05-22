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
| `Tags` | Multi-select | Tech stack tags from job posting |
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
