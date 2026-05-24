# Local Operations Plan (Free, Local-First)

## Goal

Build a fully local operational mode with:
- stable local execution,
- Telegram manual trigger (/run-now),
- catch-up flow after downtime,
- minimal operational overhead and zero paid services.

## Scope and constraints

- No paid services.
- Ollama stays local only.
- Notion remains the single database.
- GitHub Actions is optional and not required for day-to-day local operation.

## Milestones

1. M1: Stable local runtime baseline.
2. M2: Telegram Run Now command.
3. M3: Catch-up after downtime.
4. M4: Operations hardening.

## Task backlog

| ID | Task | Agent | Skill / Command | Estimate | Depends on | Acceptance Criteria |
|---|---|---|---|---|---|---|
| L1 | Formalize local run entrypoint | developer | /run-local | 0.5d | - | dry/full mode both executable |
| L2 | Lock local env profile and CI override | devops | /release-readiness | 0.5d | L1 | Local runs require no tunnel |
| L3 | Add regression test for local webhook path | qa | /weekly-health-check | 0.5d | L2 | Test fails on wrong localhost webhook |
| L4 | Define /run-now contract and failure modes | architect | /adr-check | 0.5d | L3 | ADR accepted, command contract frozen |
| L5 | Implement /run-now branch in n8n | n8n-specialist | n8n workflow editing | 1d | L4 | /run-now returns success/failure summary |
| L6 | Add idempotency for concurrent /run-now | qa | /scraper-bugfix | 0.5d | L5 | second /run-now is rejected gracefully |
| L7 | Persist last_successful_run_at cursor | n8n-specialist | Notion state persistence | 1d | L6 | Cursor saved on successful cycle |
| L8 | Implement catch-up execution mode | developer | TypeScript runtime orchestration | 1d | L7 | explicit and auto time windows supported |
| L9 | Integrate /run-catchup command in Telegram | n8n-specialist | n8n command routing | 0.5d | L8 | Summary includes time window and count |
| L10 | Add local healthcheck workflow + alert | devops | /weekly-health-check | 0.5d | L9 | Alert sent if any service is down |
| L11 | Write offline recovery runbook | business-analyst | Operational SOP writing | 0.5d | L10 | Recovery executable in <10 minutes |
| L12 | Create operator prompt pack | prompt-engineer | agent-customization | 0.5d | L11 | Deterministic slash-command outcomes |

## Agent allocation summary

- architect: L4
- business-analyst: L11
- developer: L1, L8
- devops: L2, L10
- n8n-specialist: L5, L7, L9
- prompt-engineer: L12
- qa: L3, L6
- orchestrator: coordination, priority, status updates for L1-L12

## Skill allocation summary

Workspace prompt skills:
- /run-local: L1
- /release-readiness: L2
- /weekly-health-check: L3, L10
- /adr-check: L4
- /scraper-bugfix: L6

Customization / platform skills:
- agent-customization: L12

## Execution order

1. L1 -> L2 -> L3
2. L4 -> L5 -> L6
3. L7 -> L8 -> L9
4. L10 -> L11 -> L12

## Definition of done

- Local scheduled runs are stable for 7 days.
- /run-now works end-to-end and returns a clear status message.
- Catch-up command processes missed window without duplicates.
- One offline recovery drill is completed successfully.

## Additional plan: disable GitHub Actions

Related plan ID: `GHA-OFF-01`.

- Full checklist and toggle steps: `docs/github-actions-disable-plan.md`.
- Recommended mode now: `SOFT_OFF` (disable cron, keep manual workflow_dispatch).
- Owner agents: architect (decision), devops (apply), qa (validation), business-analyst (runbook), prompt-engineer (ops prompts).
