# Agent and skill lessons

This is a small, repository-wide index of verified lessons that can improve Codex skills and agent routing. Search for a relevant term and read only the matching entry; do not load this file for ordinary tasks.

Add an entry only when an observed result supports a reusable instruction or regression check. Record the evidence, the change made or proposed, and how it was verified. Mark uncertainty explicitly. Keep one-skill-only findings with that skill's evaluation cases. Never copy raw chats, secrets, personal data, or unverified advice here.

## Verified lessons

### L-001 — Codex skills and role prompts are different repository surfaces

- **Scope:** Codex skill creation and agent routing.
- **Evidence:** At the initial workflow review, `docs/agents/README.md` described those files as reference prompts for Zed profiles; the repository had no `.agents/skills/` or `.codex/agents/` directories. Current Codex documentation places repository skills under `.agents/skills/` and custom subagent definitions under `.codex/agents/*.toml`.
- **Lesson:** Do not treat `docs/agents/*.md` as discoverable Codex skills or runnable Codex subagents. Use `.agents/skills/` for reusable skill workflows and `.codex/agents/*.toml` only for intentionally configured spawned roles.
- **Verification:** Confirmed by reading the repository README and filesystem, then checking the official [Codex skills](https://developers.openai.com/codex/skills/) and [subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents) documentation on 2026-09-27.
