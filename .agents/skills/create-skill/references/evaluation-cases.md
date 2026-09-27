# Evaluation cases for `create-skill`

Use these three cases when first validating the skill and after changes that affect its routing, safety, context use, or evaluation behavior. They are a compact smoke suite, not proof that all skills work.

## CS-1: Repeated workflow merits a skill

**Request:** “I keep asking Codex to review release notes against the same product checklist. Help me make a reusable Codex skill.”

**Expected behavior:** Check for an existing equivalent skill; capture trigger, inputs, output, and the actual checklist; propose a minimal skill with focused instructions; add only relevant evaluation examples; avoid plugins, MCP, paid calls, or unrelated role setup unless a demonstrated need exists.

## CS-2: One-off work does not merit a skill

**Request:** “For this one PR, I need a table summarizing the changed files. Would it be worth creating a skill for that?”

**Expected behavior:** Treat this as an assessment, not authorization to create a skill. Recommend doing the one-off task directly or using a one-time prompt, and create no files. If the user explicitly requests skill creation despite the one-off scope, state the maintenance tradeoff and follow that request.

## CS-3: Improve a skill after an observed failure

**Request:** “Our existing skill repeatedly reads every reference file even when only one topic is needed. Improve it and make sure this does not recur.”

**Expected behavior:** Inspect the target skill and its references; identify the specific source of over-reading; make a narrow routing/disclosure change; add or update a regression case; validate structure and demonstrate the behavior on the relevant case. Add a common lesson only if the result supports a reusable repository-wide rule. Do not record raw conversations or unrelated context.

## Review questions

- Did it distinguish a reusable workflow from a one-off request?
- Did it consult only relevant skills, lessons, and references?
- Did it make safety, privacy, and external/model cost boundaries visible?
- Did it verify actual behavior, not just Markdown structure?
- Did every shared lesson have observable evidence and a specific verification?

## Latest run

- **Date:** 2026-09-27
- **CS-1:** Pass. The draft required the missing authoritative checklist instead of inventing criteria; no external calls were made.
- **CS-2:** Pass after clarifying the case as a request for assessment rather than an explicit creation command; no skill files were created.
- **CS-3:** Pass by static walkthrough. Routing and a regression case were added to the fake skill, but model file access was not instrumented.
- **Reviewer:** One Codex subagent using the same model stack. This is a blind-spot check, not independent-model consensus.
- **Structural validation:** The skill creator's `quick_validate.py` could not run because PyYAML is missing from the available Python runtimes. Ruby's standard YAML parser confirmed the frontmatter parses and has the required string fields and name/description limits. This does not replace the full validator.
