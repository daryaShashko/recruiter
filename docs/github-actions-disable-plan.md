# GitHub Actions Disable Plan (Local-Only Mode)

## Purpose

Disable GitHub Actions automated runs so the project operates fully locally.

## Modes

1. SOFT_OFF
- Keep manual trigger (`workflow_dispatch`).
- Remove/disable cron schedules.
- Use when you still want manual backup runs from GitHub UI.

2. HARD_OFF
- Disable workflow from GitHub UI (`Disable workflow`).
- No cron and no manual run until re-enabled.
- Use when GitHub Actions must be fully inactive.

## Decision matrix

| Criterion | SOFT_OFF | HARD_OFF |
|---|---|---|
| No automatic cron runs | Yes | Yes |
| Manual run from GitHub UI | Yes | No |
| Operational simplicity | Medium | High |
| Recovery speed | Fast | Fast |

## Execution tasks (GHA-OFF-01)

| ID | Task | Agent | Skill |
|---|---|---|---|
| G1 | Choose off mode and record decision | architect | /adr-check |
| G2 | Apply YAML changes in workflow | devops | /release-readiness |
| G3 | Disable workflow in GitHub UI (HARD_OFF only) | devops | GitHub Actions operations |
| G4 | Verify trigger behavior after change | qa | /weekly-health-check |
| G5 | Update operator runbook | business-analyst | Operational SOP writing |
| G6 | Add prompt commands for off/on checks | prompt-engineer | agent-customization |

## Step-by-step (SOFT_OFF)

1. Edit `.github/workflows/scraper.yml`:
- Remove `on.schedule` block, keep `workflow_dispatch`.
- Keep jobs unchanged.

2. Commit and push.

3. Validate in GitHub Actions UI:
- There are no future cron-triggered runs.
- Manual run button is available.

## Step-by-step (HARD_OFF)

1. Optional but recommended: apply SOFT_OFF first.
2. Open GitHub repository -> Actions -> AI Recruiter Scraper.
3. Click `...` menu -> `Disable workflow`.
4. Validate:
- Workflow state shows `Disabled`.
- `Run workflow` button is not available.

## Rollback

1. For SOFT_OFF rollback:
- Restore `on.schedule` in `.github/workflows/scraper.yml`.

2. For HARD_OFF rollback:
- Actions -> workflow -> `Enable workflow`.
- If needed, restore schedule block in YAML.

## Verification checklist

- No unexpected cron execution in the next scheduled window.
- Local run still works via `./scripts/run-local.sh`.
- Local dry-run still works via `./scripts/run-local.sh --dry-run`.
- Local webhook remains `http://localhost:5678/webhook/jobs/ingest`.

## Recommended current mode

Use SOFT_OFF now:
- fully local day-to-day operation,
- manual GitHub fallback remains available.
