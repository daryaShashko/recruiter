---
name: execute-slice
description: Plan and execute a backlog slice or work package via atomic subagents with disjoint file ownership, independent verification, and git-diff review. Use when implementing tasks from docs/audit-and-backlog.md or multi-file feature slices.
---

# Execute a backlog slice via atomic subagents

Use this skill when executing a slice or work package (e.g. from `docs/audit-and-backlog.md`). It is tool-agnostic and works across Antigravity, Claude Code (`Task` subagents via `.claude/skills`), Codex, and Cursor.

## Mandatory rules

1. **Coordinator does not write code or tests.** The coordinating agent only plans, delegates to subagents, compares their output against the plan, updates backlog status after review, and runs `git commit` / `git push` after user approval. Do not bypass delegation for "small" changes.
2. **Atomic sub-tasks with disjoint file ownership.** One subagent = one atomic task touching 1–2 files with one verifiable goal (for example: "normalize fingerprint + unit test", separately "reorder pipeline steps in `scraper/src/index.ts`"). Two subagents running in parallel must never edit the same file. Dependent sub-tasks run sequentially.
3. **Independent testing and review.** Verification (`cd scraper && npm run verify`) and documentation review (comparing every `[x]` or `✅` claim against `git diff`) are always performed by separate subagents, never by the subagents that authored the code.
4. **Explicit plan approval first.** Do not start implementation until the user explicitly approves the slice plan. Answers to clarifying questions are not plan approval unless the user also says to proceed.

## Execution workflow

1. **Start brief & plan.** Output the Agent Start Protocol brief from `AGENTS.md`. Break the slice into atomic sub-tasks (1–2 files each), list the exact file ownership per subagent, check downstream pipeline effects of any reordered step, and ask the user for approval.
2. **Implement (delegated).** After approval, invoke one implementer subagent per atomic sub-task using the subagent brief template below. Run independent file sets in parallel and dependent tasks sequentially.
   - *Model fallback (tool-agnostic):* If a subagent call fails with quota/rate-limit/503 errors, retry once, then fall back to the tool's lighter model tier (for example `flash` or `haiku`) if the host tool supports model selection, or pause and ask the user.
   - *Tools without background subagents:* Execute each atomic sub-task as an isolated sequential step with its own verification check before moving to the next.
3. **Verify (independent tester subagent).** Launch a separate tester subagent to run `cd scraper && npm run verify` (and `scripts/check-agent-surfaces.sh` when docs or agent surfaces changed). If verification fails, launch a focused fixer subagent on the failing file(s), then re-run the tester subagent.
4. **Review (independent read-only reviewer subagent).** Launch a read-only reviewer subagent to compare every proposed `[x]` / `✅` status line in `docs/audit-and-backlog.md` against `git diff` and `git status --short`. Remove or mark as pending any claim not backed by the actual diff.
5. **Live n8n / prompt sync (when applicable).** Follow the `Slice Completion & Deployment Protocol` in `AGENTS.md` if scoring rules, prompts, or Telegram templates changed (`cd n8n && npm run build`, `python3 scripts/patch-n8n-hitl-review.py`, and prompt eval checks).
6. **Commit & push gate.** Report `git status --short` and the verification/review summary to the user. Run `git commit` and `git push origin main` only after explicit user confirmation.

## Subagent brief template

Pass a self-contained brief to each subagent (subagents do not see the parent conversation):

```text
Task: <one observable outcome for 1-2 files>
Role: <implementer | tester | reviewer | fixer>
Owned files (ONLY edit these): <1-2 file paths>
Read-only context: <files the subagent may read>
Constraints: Follow AGENTS.md; no `any` in scraper/; mock HTTP/Playwright in tests;
             never hand-edit n8n/prompts/candidate_profile.md or .notion-snapshot.json.
Acceptance check: <exact test or command output to report back>
```

## Evaluation cases

See [references/evaluation-cases.md](references/evaluation-cases.md) for regression cases derived from `S1-T1` and `S1-T2`.
