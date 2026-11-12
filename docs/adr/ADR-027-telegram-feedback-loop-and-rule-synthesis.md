# ADR-027: Telegram Feedback Loop and Dynamic Rule Synthesis (HITL Slice 4)

**Status:** accepted  
**Date:** 2026-11-12  
**Deciders:** Core Team  
**Consulted:** AGENTS.md, hitl-recruiter-plan.md, ADR-012, ADR-014, ADR-024, ADR-025, ADR-026  

## Context

In Human-in-the-Loop (HITL) recruiting:
1. When candidates discard or reject vacancies in Telegram Topic 2 («Горячий мэтч»), simply archiving the vacancy loses valuable qualitative feedback on *why* the candidate declined.
2. Opening Notion or a web dashboard to fill out rejection forms creates friction and interrupts the flow.
3. Without systematic pattern aggregation, the LLM Evaluator continues proposing similar unsuitable vacancies (e.g., repeating an unwanted outsourcing agency, legacy tech stack, or out-of-budget compensation).
4. Candidate requirements:
   - 1-tap rejection reason menu directly in Telegram (`[ 💸 Зарплата ]`, `[ 🏢 Аутсорс ]`, `[ 💀 Легаси ]`, `[ 📍 Локация ]`, `[ 📉 Грейд ]`).
   - Logging human feedback into Notion `Evaluation Log` (`Human Verdict = "Wrong – Should Reject"`, `Reject Reason = ...`).
   - Support for optional textual replies to vacancy alerts, recording candidate notes.
   - Lightweight analytics engine: when 3+ rejections accumulate around the same pattern (employer or technology), automatically generate a draft filter rule (`Active: false`) in Notion `Matching Criteria & Guardrails` and send a 1-tap activation prompt in Telegram.

## Decision

1. **Telegram Reject Reasons Menu Protocol (`scraper/src/utils/telegram.ts`)**:
   - When `rej:<page_id>` is received:
     - Replace inline keyboard in Topic 2 with the Reject Reasons menu:
       - Row 1: `[ 💸 Зарплата ]` (`rfb:sal:<page_id>`), `[ 🏢 Аутсорс ]` (`rfb:out:<page_id>`)
       - Row 2: `[ 💀 Легаси ]` (`rfb:leg:<page_id>`), `[ 📍 Локация ]` (`rfb:loc:<page_id>`)
       - Row 3: `[ 📉 Грейд ]` (`rfb:jun:<page_id>`), `[ ❌ Без причины ]` (`dsc:<page_id>`)
   - Callback string `rfb:<code>:<page_id_32>` is strictly 40 bytes (well within Telegram 64-byte limit).
   - On clicking a reason tag:
     - Update Telegram markup to: `❌ Отклонено: ${reasonLabel}`.
     - Patch Notion `AI Recruiter Board`: `Status = "Rejected"`.
     - Patch Notion `Evaluation Log`: `Human Verdict = "Wrong – Should Reject"`, `Reason = reasonLabel`.

2. **Text Reply Feedback Recording**:
   - When a user replies with text to an alert card in Telegram, extract the reply text and record it as `Human Verdict Notes` in Notion `Evaluation Log`.

3. **Pattern Analysis & Rule Synthesis Engine (`scraper/src/feedback/feedback-analyzer.ts`)**:
   - Provide `analyzeFeedbackPatterns(logs, threshold = 3)`:
     - Group negative verdicts by company and by tech tags / rejection codes.
     - When an issue occurs 3+ times, synthesize a draft rule for Notion `Matching Criteria & Guardrails`:
       - `Rule Name`: e.g. `Auto-Guardrail: Block [Company]` or `Auto-Guardrail: Exclude [Tag]`
       - `Category`: `Hard Reject (Red Flag)`
       - `Enforcement`: `Hard Gate (Code + Prompt)`
       - `Rule Type`: `Force Reject (Score = 0)`
       - `Value / Keywords`: Company name or technology keyword
       - `Active`: `false` (requires human activation)
     - Prepare Telegram alert proposal: `💡 Предложение правила: [ ✅ Активировать ]`.

4. **Synchronize Context and Documentation**:
   - Update `context/ingest-workflow.yaml`, `context/modules/n8n.yaml`, and `context/decisions.yaml`.

## Consequences

### Positive
- Zero-friction qualitative feedback capture directly from Telegram chat.
- Continuous prompt & guardrail learning loop without manual database editing.
- Draft rules remain inactive until explicit candidate approval, preventing accidental over-filtering.
- 100% offline determinism, $0 cost, fully covered by unit tests.

### Negative / Trade-offs
- Adds Telegram `rfb:*` callback actions to the webhook router.
