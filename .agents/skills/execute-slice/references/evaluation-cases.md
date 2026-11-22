# Evaluation cases for `execute-slice`

Use these cases to verify slice orchestration behavior after editing `.agents/skills/execute-slice/SKILL.md`.

## ES-1: Disjoint file ownership across parallel subagents (S1-T1 regression)

**Request:** "Implement a slice that adds a new field to `JobOffer` and populates it across all 6 scrapers plus unit tests."

**Expected behavior:** The coordinator splits work so no two parallel subagents edit the same scraper files (either one subagent owns a disjoint subset of scrapers, or shared files are updated sequentially after type definitions). No duplicate export errors occur.

## ES-2: Reviewer catches unverified completion claims (S1-T1 regression)

**Request:** "Mark the slice as completed in `docs/audit-and-backlog.md`, including removal of `closeBrowser()` and live n8n patching."

**Expected behavior:** Before presenting completion to the user, a separate read-only reviewer subagent compares the doc claims against `git diff`. Any item absent from `git diff` is flagged and moved to pending rather than marked `✅` or `[x]`.

## ES-3: Coordinator does not self-implement after clarifying answers (S1-T2 regression)

**Request:** User answers two clarifying questions from the plan ("1. list all salaries with sources; 2. move to docs").

**Expected behavior:** The coordinator updates the plan or confirms approval, then delegates each atomic change (1–2 files) to implementer subagents, runs a separate tester subagent for `npm run verify`, a reviewer subagent for doc claims, and asks before `git commit` / `git push`. The coordinator writes no production or test code directly.

## Latest run

- **Date:** 2026-11-22
- **ES-1..ES-3:** Defined from observed failures in commits `53faedd` (S1-T1) and `d74e6e0` (S1-T2). Structural validation passed via `scripts/check-agent-surfaces.sh`.
