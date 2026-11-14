# Instructions for AI work in this repository

Use Russian with the user (short, concrete). Keep code, paths, commands, and identifiers in English.

## Source of Truth
- Runtime: checked-in code & current configuration.
- Candidate CV: Notion `Candidate CV & Experience` database only (via `scraper/src/generator/notion-loader.ts` or `n8n/prompts/.notion-snapshot.json` fallback). No `master-cv.yaml` or static duplicates.
- Supporting notes: `context/` and `docs/` may be stale; verify against running code.
- Skills: `.agents/skills/<name>/SKILL.md`. See `docs/agent-tools.md` for adapter pointers.

## Engineering Constraints
- Pipeline: scraper (`scraper/`) → n8n webhook → LLM evaluation → Notion → Telegram, plus Application Generator (`scraper/src/generator/`).
- Scraper: no `any` (use `unknown`); config in `scraper/src/config.ts`; browsers via `scraper/src/utils/browser.ts`.
- Tests: mock HTTP and Playwright responses; no real network calls in unit/contract tests.
- n8n: inline `Code: LLM Router` node; workflow exports in `n8n/workflows/` are gitignored.
- CI: GitHub Actions free tier, 15-minute budget, no GPU. No direct `${{ ... }}` interpolation in `run:` scripts.

## Commands
- Run from `scraper/`:
  - `npm run verify`: runs Oxlint, Knip, TypeScript, and Jest.
  - `npm run typecheck`, `npm test`: offline verification.
  - `npm run scrape:dry`: Playwright run against job sites (no webhook send).
  - `npm run eval`: Promptfoo evaluation (requires LLM API keys).
- Run from root:
  - `scripts/run-local.sh --dry-run`
  - `scripts/check-agent-surfaces.sh`

## Agent Start Protocol
Every task begins with a compact start brief before tool use:

```text
Task: <one observable outcome>
Mode: <quick | feature | high-assurance>
Role: <research | planner | implementer | reviewer | operator>
Scope: <files, components, or environment included>
Out of scope: <explicit exclusions>
Constraints: <repo rules, safety, cost, data, and authorization limits>
Context to inspect: <only files or commands needed to decide the next action>
Acceptance checks: <specific evidence that proves completion>
Stop conditions: <unknowns, failures, or actions requiring the user>
```
