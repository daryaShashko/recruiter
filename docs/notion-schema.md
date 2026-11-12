# Notion Database Schema: AI Recruiter Board

The source options below describe the required local schema. They are not
automatically applied to the live Notion database; provision new Select options
before enabling the corresponding scraper sources in production.

`greenhouse`, `lever`, and `ashby` are emitted by the local public-board scraper
alongside the Workable, Recruitee, and Personio feeds. This documentation does
not update the production Notion Select options or n8n source routing.

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
| `Source` | Select | `justjoin`, `nofluffjobs`, `linkedin`, `manual`, `thehub`, `swissdevjobs`, `greenhouse`, `lever`, `ashby`, `adzuna`, `workable`, `recruitee`, `personio` |
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
| `Applied` | Application submitted via Channel 1 (Email Apply; bundles ATS CV PDF + Cover Letter + email_package.json) or subsequent ATS web-form channels (Greenhouse, Lever, Workable, JustJoin IT) |
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
| `Source` | Select | `justjoin`, `nofluffjobs`, `linkedin`, `manual`, `thehub`, `swissdevjobs`, `greenhouse`, `lever`, `ashby`, `adzuna`, `workable`, `recruitee`, `personio` |
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

---

## Databases 3 & 4: Notion Live Control Plane (CV & Matching Criteria)

> **Module:** [`n8n/evaluator/notion-profile.ts`](../n8n/evaluator/notion-profile.ts) + CLI [`n8n/evaluator/notion-cli.ts`](../n8n/evaluator/notion-cli.ts)
>
> **Architectural Status:** Notion (`Candidate CV & Experience` database) is the **sole source of truth** for candidate profile, experience bullets, and skills across the entire recruiter workspace (evaluator, matching, and application generator).
>
> **Strict Prohibition:** No manual offline CV duplicate files (eliminating master-cv.yaml and hardcoded resumes; Notion is sole source of truth). All generator modules (scraper/src/generator/) and evaluation scripts must source candidate data directly from Notion via notion-loader.ts / [`n8n/evaluator/notion-profile.ts`](../n8n/evaluator/notion-profile.ts), or through the local snapshot `n8n/prompts/.notion-snapshot.json` in offline mode.

---

### Database 3: Candidate CV & Experience (Master CV)

> **Icon:** `📄`  
> **Purpose:** Authoritative repository for candidate experience bullets, achievements, skills, and background.  
> Each bullet has a unique identifier and stack tags to support zero-hallucination verbatim injection and deterministic pre-ranking.

#### Properties

| Property | Type | Options / Notes |
|---|---|---|
| `Title` | Title | Job title, role summary, or achievement headline (e.g. "Senior Full-Stack / Senior Frontend Engineer...") |
| `Section` | Select | `Role & Summary`, `Recent Experience (Last 6m)`, `Primary Stack`, `Secondary Stack`, `AI & Tools`, `Languages`, `Target Role & Leadership`, `Key Achievement` |
| `Highlight / Summary` | Text (rich_text) | Exact bullet text or summary statement. Used for zero-hallucination verbatim injection into ATS CV and prompt compilation |
| `Tech Tags` | Multi-select | Associated technologies/skills used by Pre-Ranker tag matching (e.g. `TypeScript`, `React`, `Node.js`, `Architecture`) |
| `Period` | Text (rich_text) | Date range or tenure descriptor (e.g. "2019–2021", "2026 (Last 6 mos)", "Daily Production") |
| `Order` | Number | Sort sequence (ascending) for profile and CV ordering |
| `Active` | Checkbox | Toggle active status (`true` = included in compiled profile and ATS CV generation; `false` = archived) |

#### Child Blocks (Details)
Optional paragraph blocks on each page store extended technical context, architecture decisions, and metrics for LLM matching prompts without cluttering tabular view.

---

### Database 4: Matching Criteria & Guardrails

> **Icon:** `⚖️`  
> **Purpose:** Real-time candidate evaluation preferences, salary floors, location boundaries, and red flag keywords.

#### Properties

| Property | Type | Options / Notes |
|---|---|---|
| `Rule Name` | Title | Rule name (e.g. "Hard Salary Floor", "NO Crypto / Web3") |
| `Category` | Select | `Salary & Contract`, `Location & Work Style`, `Hard Reject (Red Flag)`, `Scoring Guideline`, `Target Domain` |
| `Enforcement` | Select | `Hard Gate (Code + Prompt)`, `Prompt Rule (LLM Only)` |
| `Rule Type` | Select | `Force Reject (Score = 0)`, `Discard (Score < 50)`, `Review Cap (Score 50-79)`, `Hot Match Boost (Score >= 80)`, `Target / Preference` |
| `Value / Keywords` | Text (rich_text) | Numeric values or pipe-separated keywords for deterministic code checks |
| `Rule Description (For Prompt)` | Text (rich_text) | Verbatim prompt instruction compiled into candidate profile prompt |
| `Order` | Number | Sort sequence (ascending) |
| `Active` | Checkbox | Toggle active status (`true` = enforced; `false` = ignored) |

---

### Offline Snapshot & Caching Strategy

To support 100% offline generation, CI testing, and dry-run flows without network access:
1. **Live Synchronization**: `npm run notion:sync` fetches active rows from Notion and writes:
   - `n8n/prompts/candidate_profile.md` (rendered Markdown profile for LLM prompt)
   - `n8n/prompts/.notion-snapshot.json` (exact JSON dump of active CV and Criteria entries)
2. **Offline Fallback Hierarchy**:
   - Generator module notion-loader.ts (scraper/src/generator/) checks:
     1. Live Notion API (if `NOTION_TOKEN`, `NOTION_CV_DB_ID` are set and `offlineOnly` is false)
     2. Local snapshot file `n8n/prompts/.notion-snapshot.json`
     3. Built-in seed data `DEFAULT_CV_ENTRIES` in `n8n/evaluator/notion-profile.ts`
   - This ensures 0 network calls during offline tests while strictly maintaining Notion as the sole authoring origin.

### Commands (run from `n8n/`)

- `npm run notion:provision` — creates the `🎛️ AI Recruiter — CV & Criteria Control Plane` page and both databases in Notion, seeding all 12 CV rows and 13 Criteria rows.
- `npm run notion:sync` — fetches active rows from Notion and updates `n8n/prompts/candidate_profile.md` + local snapshot `n8n/prompts/.notion-snapshot.json`.
- `npm run notion:preview` — prints the compiled Markdown profile and `DynamicScoringConfig` offline.
