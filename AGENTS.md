# Instructions for AI work in this repository

Use Russian with the user. Keep explanations short and concrete. Keep code, paths,
commands, and identifiers in English.

## Source of truth

- Treat the checked-in code and current configuration as the source of truth for what
  currently runs.
- `context/` and `docs/` are supporting notes. They may be stale; verify important
  claims against the relevant source before relying on them.
- Do not report a roadmap phase or task as current without checking its status and
  relevant files. Do not load the full roadmap for an unrelated small change.
- `docs/agents/` and `.github/agents/` describe role prompts for other tools. They do
  not, by themselves, start or delegate work to those agents in Codex.
- In Codex, use the repository skill at `.agents/skills/create-skill/` for requests to
  create or improve reusable skills. It consults `docs/agent-learning/LESSONS.md`
  selectively; do not load that lesson index for ordinary tasks. Codex custom subagent
  definitions are a separate surface under `.codex/agents/*.toml` and should be added
  only for an intentional, demonstrated need.

## Workflow: task-centered, staged RPI

The detailed working draft is [`docs/ai-workflow.md`](docs/ai-workflow.md). It defines
the proposed task lifecycle and quick/feature/high-assurance modes. The user is refining
this process stage by stage, so treat it as a draft, keep the active stage visible, and
do not silently present proposed gates as settled policy. Keep each stage proportionate
to risk and uncertainty; a clear, isolated fix does not need a feature dossier.

Use the draft's lifecycle as the shared vocabulary: Intake → Problem & Value Check
(challenge pass for feature ideas) → Research when needed → Feature Spec → Solution
Plan → Test Design → Implement → Verify → Ready to Merge → Merge/Follow-up. Explain the
active stage and next gate when the user is working on the process itself. Do not imply
that stage labels or the full sequence create autonomous agents or authorize merge.

## Idea assessment

Use Stage 1 in [`docs/ai-workflow.md`](docs/ai-workflow.md) for the Problem & Value
Check. Keep facts separate from hypotheses, mark unknowns instead of inventing values,
and use a bounded challenge pass only under the triggers described there. Recommendations
do not authorize external costs, data sharing, production writes, permission changes, or
merge.

## Context and scope

- Start with this file and the user's request. Read a concise project note only when it
  answers a question needed for the task; then inspect relevant source/configuration.
- Avoid loading every agent prompt or the entire roadmap into context.
- Do not create new agents, frameworks, MCP servers, services, or external/opaque
  memory stores unless they solve a demonstrated need and their ongoing cost is
  explained. `docs/agent-learning/LESSONS.md` is a curated repository index of
  verified rules, not a raw conversation archive.
- Avoid copying the same project rules into multiple files. When changing a canonical
  rule, update its pointer or remove stale copies when that is within the task scope.

## Verification and reporting

- Make only claims supported by inspected files or completed checks.
- State the change, why it was made, how it was reviewed, and any material limitation.
- Keep the explanation transparent: say which workflow stage is active and what the
  next stage means when the user is learning or changing the workflow itself.
