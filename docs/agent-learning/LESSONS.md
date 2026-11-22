# Agent and skill lessons

This is a small, repository-wide index of verified lessons that can improve Codex skills and agent routing. Search for a relevant term and read only the matching entry; do not load this file for ordinary tasks.

Add an entry only when an observed result supports a reusable instruction or regression check. Record the evidence, the change made or proposed, and how it was verified. Mark uncertainty explicitly. Keep one-skill-only findings with that skill's evaluation cases. Never copy raw chats, secrets, personal data, or unverified advice here.

## Verified lessons

### L-001 — Codex skills and role prompts are different repository surfaces

- **Scope:** Codex skill creation and agent routing.
- **Evidence:** At the initial workflow review, `docs/agents/README.md` described those files as reference prompts for Zed profiles; the repository had no `.agents/skills/` or `.codex/agents/` directories. Current Codex documentation places repository skills under `.agents/skills/` and custom subagent definitions under `.codex/agents/*.toml`.
- **Lesson:** Do not treat `docs/agents/*.md` as discoverable Codex skills or runnable Codex subagents. Use `.agents/skills/` for reusable skill workflows and `.codex/agents/*.toml` only for intentionally configured spawned roles.
- **Verification:** Confirmed by reading the repository README and filesystem, then checking the official [Codex skills](https://developers.openai.com/codex/skills/) and [subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents) documentation on 2026-09-27.

### L-002 — Slice orchestration requires disjoint subagent file ownership and diff-backed doc review

- **Scope:** Multi-file slice execution across subagents (`.agents/skills/execute-slice/SKILL.md`).
- **Evidence:** In `S1-T1` (`53faedd`), parallel subagents edited the same scraper files, causing duplicate exports, and `docs/audit-and-backlog.md` marked `closeBrowser()` removal and n8n patching as done when neither was in `git diff`. In `S1-T2` (`d74e6e0`), the coordinator implemented and verified changes directly instead of delegating to atomic subagents.
- **Lesson:** For backlog slices, the coordinator must not write code or tests; each subagent must own 1–2 disjoint files; testing (`npm run verify`) and doc-claim verification (comparing `[x]` / `✅` lines against `git diff`) must run in separate subagents.
- **Verification:** Encoded in `.agents/skills/execute-slice/SKILL.md` and `AGENTS.md`; validated with `scripts/check-agent-surfaces.sh` on 2026-11-22.
