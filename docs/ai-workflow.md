# Task workflow — draft 1

This is a working task-centered process inspired by Microsoft's [HVE Core RPI
lifecycle](https://github.com/microsoft/hve-core/blob/main/docs/rpi/README.md). HVE Core
targets GitHub Copilot; this repository adapts its workflow ideas to Codex. All stages
below were red-teamed by three separate Codex subagents, each reviewing a stage cluster.
The reviewers use the same model stack, so this is a structured blind-spot check, not
independent-model consensus.

The definitions are a draft. We will validate them on real repository tasks and refine
one stage at a time before treating them as settled policy.

## Goals

- Define the problem and decide whether solving it is worth doing before implementation.
- Keep one task moving through clear, ordered stages, with its evidence attached.
- Trace each agreed behavior through a plan, a check, implementation, and review.
- Use only the context, model calls, external services, and documentation needed for
  the decision at hand.
- Make costs, security/privacy risks, assumptions, untested cases, and user approvals
  visible.

## Lifecycle and status

```text
Inbox → Intake → Problem & Value Check → Research (if needed) → Feature Spec
      → Solution Plan → Test Design → Implement → Verify → Review
      → Ready to Merge → Merge / Follow-up
```

At any stage, a task may become `Blocked`, `Deferred`, or `Dropped`. A research request
may enter at Research; a clear low-risk fix may use Quick mode. `Ready to Merge` is an
acceptance result, not permission to merge.

| Stage | Required result before moving on |
|---|---|
| 0. Intake | Request, constraints, scope, and actual authorization captured. |
| 1. Problem & Value Check | Evidence-aware problem card, challenge disposition where needed, and a proportionate next action. |
| 2. Research | Decision-relevant evidence gap answered or explicitly blocked. |
| 3. Feature Spec | Observable behavior, scope, and acceptance scenarios are clear. |
| 4. Solution Plan | Small, ordered implementation slices cover the accepted scope. |
| 5. Test Design | Each acceptance scenario maps to a feasible, trustworthy check. |
| 6. Implement | Approved slices are changed with deviations visible. |
| 7. Verify | Results and remaining gaps are recorded against scenario IDs. |
| 8. Review | Completion and acceptance outcome are reported separately. |
| 9. Merge / Follow-up | Merge is separately authorized; residual work has a destination. |

## Stage definitions

### 0. Intake

**Purpose:** Preserve what the user asked for, its scope, and the authorization boundary.

**Minimum input:** User request and any constraints already given. Classify it as an
idea/evaluation, implementation request, bug, research request, or question.

**Output:** One compact task envelope:

```text
Request: <plain-language outcome>
Type: <idea | implementation | bug | research | question>
Scope/constraints: <only material constraints>
Authorization: <evaluation only | implementation requested | unclear>
```

**Gate:** Continue if the desired outcome is assessable. Ask one narrow question only
when an ambiguity could change the decision, safety boundary, scope, or acceptance
criteria. Do not infer authorization for new external costs, data sharing, production
writes, permission changes, or merge.

**Avoid:** Asking for agent names, roadmap IDs, a technical solution, or a full intake
form before any of those are needed.

### 1. Problem & Value Check

**Purpose:** Decide whether the problem merits more work and select the cheapest useful
next action. Assess the expected effect separately from confidence in the evidence.

**Minimum input:** Affected user/workflow, known observations, and the user's desired
outcome. Unknowns are valid values; do not fill gaps with invented numbers.

**Output:** A short card with:

```text
Problem / affected workflow:
Evidence / hypotheses:
Desired effect / observable signal:
Smallest alternative (including do nothing):
Material costs, risks, and unknowns:
Challenge findings / evidence or hypothesis / disposition:
Recommendation / rationale:
Authorization boundary:
Next: define feature | research one question | defer | drop | blocked
```

Assess only material cost and risk: financial/API/token use, setup and maintenance,
data/access exposure, failure impact, and reversibility. Assess necessity and expected
impact qualitatively unless a real baseline supports numbers.

#### Challenge pass

For a feature idea that enters Feature mode, a separate Codex subagent receives only the
sanitized problem card, without the lead's recommendation. It returns the strongest
unsupported assumption, one decision-relevant missed downside/security/cost risk, and
the cheapest alternative or experiment. It may return `none found`; each point must be
labeled `evidence-backed` or `hypothesis`. The lead accepts or dismisses material
findings with a reason.

This adds one short model run per feature decision. It is not free, independent-model
consensus, a vote, or new evidence. Skip it for clear isolated fixes in Quick mode. For
high-impact decisions, use a stronger domain/security review when available and
authorized; otherwise record that limitation. Do not send private source, real job or
personal data, secrets, or production access to the subagent.

**Next status:**

- `Define feature` when the problem/value are credible enough to specify. This does not
  grant implementation approval.
- `Research one question` when one named unknown could change the decision.
- `Defer` when value is plausible but timing, dependency, risk, or cost is unacceptable
  now.
- `Drop` when expected value is low, an existing simpler solution is sufficient, or
  cost/risk is disproportionate.
- `Blocked` only when an essential answer or authorization is unavailable.

Carry forward the user's original authorization. If the user requested implementation,
continue through specification and planning within that scope; pause if scope, cost,
data exposure, or action type materially changes. If the user asked only to evaluate,
do not implement.

**Gate:** Problem, desired outcome, facts and hypotheses, material challenge findings,
and next action are visible. A decision-changing unknown can pass only to bounded
research that addresses it; otherwise mark `Blocked`. Do not write an implementation
plan here.

### 2. Research readiness and bounded research

**Purpose:** Check whether existing evidence is sufficient; investigate only a gap that
could change the decision, specification, or plan.

**Minimum input:** One research question, the decision it affects, evidence already
checked, allowed source/method, and any cost/privacy boundary.

**Output:** A concise record:

```text
Question / decision affected:
Sources checked / findings:
Source date or quality (if material):
Facts / inference:
Remaining unknown / stop condition:
Result: enough evidence | blocked | decision changed
```

Start with repository files and supplied material. External sources, network/API/model
calls, paid usage, private systems, or transmitting task data require applicable user
authorization. Read-only does not automatically mean cost-free or privacy-safe. Do not
expand into a broad survey; stop once the decision can move forward. If no allowed source
can resolve the question, record the limitation rather than silently widening scope.

**Gate / next status:** `Feature Spec` when evidence is adequate; `Solution Plan` may
follow directly for authorized implementation work that needs no feature spec; another
bounded research question only if justified; otherwise `Blocked`, `Defer`, or `Drop`.

### 3. Feature Spec

**Purpose:** Agree on observable system behavior before choosing implementation details.

**Minimum input:** Problem/value decision, relevant research findings, actors, and
decision-relevant constraints/unknowns.

**Output:** A compact feature specification containing goal, in/out of scope, domain
terms and rules where needed, acceptance criteria, data/security/privacy constraints,
and stable scenario IDs such as `F-1`, `F-2`. Use `Given/When/Then` inline where it
helps describe behavior. Gherkin syntax is optional; this feature spec is not itself a
test file.

**Gate / next status:** Each in-scope behavior has an observable result; terminology and
scope are clear; decision-critical unknowns are resolved or sent back to Research. Mark
`Feature Spec: ready for planning` or `needs research/decision`.

**Avoid:** Choosing code structure, test layers, exhaustive edge cases, or creating a
formal spec for an internal refactor with no behavior change.

### 4. Solution Plan

**Purpose:** Map accepted behavior to the actual repository and choose the smallest
bounded implementation.

**Minimum input:** Ready feature spec/scenario IDs (or a clear bug task), relevant source
and configuration, and applicable repo instructions. Load only the relevant context.

**Output:** Ordered implementation slices mapped to `F-*` scenarios, affected
components, dependencies, consequential decisions, and slice-completion conditions.
Keep behavioral acceptance in the Feature Spec; slice-completion is only about the
implementation slice. Add rollback/recovery only for changes where deployment, data
mutation, migration, or operational failure makes it relevant. Record an ADR only for a
durable architectural decision.

Apply **DDD selectively** to complex or changing business concepts and invariants. Do
not add domain layers, aggregates, or repositories for simple data movement. A separate
plan critique is for high-risk, cross-cutting, or uncertain changes only.

**Gate / next status:** Each scenario is covered by a bounded slice, assumptions are
visible, and consequential uncertainties are resolved or routed back. Mark `Plan: ready
for test design` or `needs research/decision`.

### 5. Test and Benchmark Design

**Purpose:** Choose the least expensive check that gives trustworthy evidence for each
accepted behavior.

**Minimum input:** Feature scenario IDs, solution slices/components, and existing test
conventions. Add a benchmark question only if a measured performance, quality, latency,
or cost result could change a decision.

**Output:** A compact mapping:

```text
F-ID → check / test level / material setup and side effects / expected result
```

Choose one cheapest trustworthy layer: unit/domain; mocked integration/provider; live
contract or workflow integration; browser/UI E2E only when the feature has a relevant
interface. Add a higher layer only when a boundary or contract cannot be credibly
covered lower down. Give every scenario a check or a reason it is not automated.

Use **TDD** for deterministic domain rules and transformations when practical. It is a
technique, not a required ceremony for every change. Define a benchmark only with a
decision-relevant question, representative workload, baseline, metric, justified
acceptance threshold, and known data/usage cost. If no baseline or decision rule exists,
do not run a benchmark yet.

**Gate / next status:** Checks are feasible and reproducible, or the manual/automation
limitation is stated. Mark `Test Design: ready for implementation` or `blocked`.

### 6. Implement

**Purpose:** Realize one approved slice at a time.

**Minimum input:** Approved slice and scenario IDs, current relevant source, and the
decision owner for any scope change.

**Output:** Source/configuration diff and concise notes linking changed behavior to
scenario IDs. Record a material plan deviation and update the plan after its decision,
before implementing affected work.

Use one lead workflow. Invoke specialist roles or parallel agents only for independent
work whose benefit exceeds coordination and token cost. Do not add unrelated cleanup.

**Gate / next status:** A named slice is implemented; no material deviation is
unreviewed. Mark `Implemented: <slice>` → Verify, or `Blocked`/`Deferred` with the
dependency or decision needed. Implementation completion alone does not mean feature
acceptance.

### 7. Verify and trace

**Purpose:** Show what evidence exists for every scenario and expose gaps honestly.

**Minimum input:** Approved requirements/scenario IDs, planned checks, and authorized
test environment/data boundary.

**Output:** A matrix:

```text
Requirement/F-ID | check + level/environment | result | evidence | gap/route
```

Results are `Pass`, `Fail`, `Not run`, or `Not automated`. Link commands, logs, or
artifacts where available. A mocked integration is not a live integration or E2E test.
Use test accounts/sandboxes for external writes; production data or side effects are
out of scope unless explicitly authorized. Name the environment and cleanup plan when
external side effects are part of the authorized check.

**Gate / next status:** Report all planned check results. Fix failures or route them;
record accepted exceptions with the decision maker and scope. Unrun checks remain visible
and cannot be described as passed. Mark `Verified`, `Partial`, or `Blocked` → Review.

### 8. Review

**Purpose:** Compare the work and evidence with the approved outcome, scope, constraints,
and plan.

**Minimum input:** Quick-task statement or feature spec, implementation diff, verification
matrix, deviations, and residual risks.

**Output:** Keep two questions separate:

- **Execution:** `Complete`, `Partial`, or `Blocked`.
- **Acceptance:** `Ready to merge`, `Needs changes`, or `Not accepted`.

Record findings with severity, evidence/location, required action, and destination stage.
Record accepted exceptions with who accepted them and the bounded scope. A permanent
review artifact is only needed for larger tasks; a concise review is enough for small
ones.

**Gate:** `Ready to merge` only when every in-scope requirement has evidence or an
explicitly accepted exception and no blocking findings remain. Otherwise route to
Implement, Verify, Plan, Research, or a new task.

### 9. Merge and follow-up

**Purpose:** Land an accepted change only after authorization and give residual work a
clear destination.

**Minimum input:** Ready review, PR/MR or applicable merge reference, checks, known gaps,
and explicit authorization or established repository merge policy.

**Output:** `Not authorized`, `Authorized`, or `Merged` with reference, plus actionable
follow-up destination. Use a PR/MR where the repository workflow has one; otherwise
identify the applicable merge action/owner. Do not create vague follow-up items without
a next action.

**Gate:** Readiness never implies merge approval. After merge, record the reference and
route defects to Implement, decision gaps to Plan/Research, evidence gaps to Verify, and
residual scope to a separate task.

## Workflow sizes

| Mode | When | Minimum path |
|---|---|---|
| **Quick** | Clear, isolated, reversible, low-risk fix | Compact Intake → brief value/risk check → implement → authorized, proportionate Verify → Review. No durable dossier or challenger call. |
| **Feature** | New meaningful system/user behavior | Stages 0–8 in order; bounded Research and challenge pass where specified. One task dossier may hold the spec, plan, test map, and results to avoid duplicate files. |
| **High assurance** | Sensitive data/secrets, external exposure, permissions, migrations, costly/irreversible actions, or major architecture | Feature path plus explicit data/access/security review, sandbox-first integration plan, recovery/rollback when relevant, and a reviewer with separate ownership if available. A same-model subagent is not an independent reviewer; otherwise record the limitation. |

The mode changes the evidence depth, not the authorization boundary. Do not run tests,
external calls, or side-effecting checks unless the task or applicable repository policy
authorizes them; mark them `Not run` otherwise.

## Cost, privacy, and evidence rules

- This adaptation adds no hosted workflow service or database. HVE Core itself is
  Copilot-oriented; we are not installing it into Codex.
- Each subagent/model call adds usage; the feature challenge is one additional short run,
  not a free or independent vote. The exact Codex usage/cost depends on the user's plan
  and is not visible from this repository.
- Persistent task artifacts cost storage only until their content is sent back as model
  context. Keep one concise dossier per Feature task, and load only the active sections.
- Promptfoo/provider evaluations may use external quotas and send prompt/test data to a
  provider. Assess that before running them.
- Perplexity can be an external research or exploratory-critique source only when its
  access and data policy are acceptable. It is not the deterministic test runner. Never
  send private source, job/personal data, secrets, or production access without explicit
  authorization.
- Never report a hypothesis as measured value, a mock test as E2E, `Ready to Merge` as
  merged, or same-model critique as independent-model confirmation.

## Adoption and next step

- **Draft 1:** stage definitions have been reviewed in three separate subagent passes,
  each covering a different stage cluster, and revised. The model stack was the same;
  this was a blind-spot cross-check, not independent model consensus.
- **Not implemented:** task dossier template/location, status automation, CI gates, and
  merge integration. Do not add them until the manual flow works on real examples.
- **Next:** run the revised Problem & Value Check on the P4-5 dedup example again,
  confirm the stage-1 output, then refine any remaining weaknesses before operationalizing
  the next stage.

## How to start

Describe the problem and desired outcome in ordinary language. The assistant identifies
the task type and active stage, explains what the stage is deciding, shows the compact
result, and names the next gate. The user does not need to choose an agent, roadmap ID,
or implementation technique.
