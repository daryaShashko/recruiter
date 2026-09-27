---
name: create-skill
description: Create or improve a reusable Codex skill in this repository. Use when asked to make a new skill, revise a skill after observed behavior, or evaluate whether a repeated workflow deserves a skill.
---

# Create or improve a Codex skill

Use this workflow only for Codex skill creation, improvement, or evaluation. Do not use it to execute ordinary repository tasks or to turn `docs/agents/*.md` into Codex agents. If the user asks whether a one-off workflow deserves a skill, recommend handling it directly. If the user explicitly asks to create a skill despite the one-off scope, state the maintenance tradeoff briefly and honor that request with the smallest useful skill.

## Workflow

1. **Check the need.** Identify the repeated user goal, evidence that the workflow recurs, and the smallest alternative. Reuse the repository's Problem & Value Check in `docs/ai-workflow.md` when the value is uncertain. If this is a one-off or duplicates an existing skill, state the smaller alternative and its maintenance tradeoff. If the user explicitly requested a skill, preserve that choice unless they asked only for an assessment.
2. **Inspect only relevant context.** Read repository `AGENTS.md`, check `.agents/skills/` for similar skills, and search `docs/agent-learning/LESSONS.md` for matching terms. Read only matching lesson entries. Do not load the full agent catalog, roadmap, or lesson history without a concrete need.
3. **Define the skill contract.** State its user goal, when it should and should not trigger, required inputs, expected output, decision boundaries, and checks. Keep known facts separate from assumptions. Assess material privacy, security, side-effect, maintenance, and API/model cost concerns. Do not add external calls or paid evaluation services by default.
4. **Create the smallest useful skill.** Prefer the repository location `.agents/skills/<skill-name>/SKILL.md`. Use the built-in `$skill-creator` when available to scaffold or shape the skill, then review its output. Keep `SKILL.md` focused; add references or scripts only when they save context or make a repeated check more reliable. Put mode-specific detail in directly linked references and load it only when needed.
5. **Evaluate behavior.** Use the cases in [references/evaluation-cases.md](references/evaluation-cases.md). For a new skill, test the proposed behavior against the no-skill baseline where feasible; for an update, compare against the prior version. Run the skill creator's `quick_validate.py` on the finished skill. This validates structure, not usefulness. Inspect the actual outputs for scope, safety, context use, and correct routing; record the latest result and material limitations in the evaluation file.
6. **Use a bounded cross-check when requested or warranted.** For a repository-wide or high-impact skill, one blind subagent pass can test realistic requests or identify gaps. Give it the skill and minimum necessary materials, not the intended answer. Report that same-stack Codex review is a blind-spot check, not independent-model consensus. Avoid parallel reviewers whose work overlaps.
7. **Promote only verified lessons.** Add a repository-wide lesson to `docs/agent-learning/LESSONS.md` only when an observed result supports a reusable change to skill behavior or validation. Record concise evidence, the specific rule or test change, and verification. Keep raw chats, secrets, personal data, and unverified suggestions out of the registry. If an observation is local to one skill, keep it with that skill's evaluation cases instead.
8. **Report the result.** Summarize the need decision, files changed, checks and their limits, lessons added or rejected, and any remaining uncertainty. Do not claim that a lesson was accepted or a skill is effective just because its Markdown validates.

## Boundaries

- A skill is a reusable workflow. `AGENTS.md` holds short repository-wide rules; custom Codex subagents are configured separately under `.codex/agents/*.toml`. Do not create or change those surfaces unless the user asks or the demonstrated need requires it.
- A skill's presence does not authorize external data sharing, paid model calls, production changes, installation outside the repository, or merging.
- Keep discovery descriptions discriminating. Automatic invocation remains enabled unless the user asks otherwise.
- Avoid duplicating rules already maintained in `AGENTS.md` or `docs/ai-workflow.md`; link to the source and load only the relevant section.
