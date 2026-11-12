# ADR-025: HITL Telegram Review Filter and Hot Match Promotion Flow (Slice 2)

**Status:** accepted  
**Date:** 2026-11-12  
**Deciders:** Core Team  
**Consulted:** AGENTS.md, hitl-recruiter-plan.md, ADR-014, ADR-018, ADR-024  

## Context

In Human-in-the-Loop (HITL) job processing:
1. Vacancies scoring 50–79 (Review) were previously logged to Notion without interactive triage in Telegram, causing high-potential vacancies to sit unreviewed.
2. The user requested a streamlined two-stage Telegram screening experience:
   - **Topic 3 («На ревью»)**: Quick-triage topic where vacancies get interactive buttons `[ 👍 Берём в Hot Match ]` and `[ 👎 В архив ]`.
   - **Topic 2 («Горячий мэтч»)**: Operational command post with complete company dossier and action triggers (`[ 🚀 Подготовить отклик ]`).
3. Telegram `callback_data` has a strict hard limit of 64 bytes. Notion Page IDs are 32 hexadecimal characters (or 36 characters with hyphens). An unformatted or UUID-hyphenated callback string like `promote_candidate_to_hot_match:<uuid>` risks truncation or protocol failure.

## Decision

1. **Callback Data Protocol (Strictly <= 64 bytes)**:
   - `prm:<page_id_32>` — Promote from Review to Hot Match (length: 36 bytes).
   - `dsc:<page_id_32>` — Discard from Review without detailed rejection sub-menu (length: 36 bytes).
   - `app:<page_id_32>` — Trigger Application generation in Topic 2 (length: 36 bytes, Slice 3).
   - `rej:<page_id_32>` — Open rejection reasons menu in Topic 2 (length: 36 bytes, Slice 4).
   - `rfb:<code_3>:<page_id_32>` — Save rejection tag (length: 40 bytes, Slice 4).
   - Strip all hyphens from Notion Page UUIDs to ensure a 32-character compact string.

2. **Topic 3 Inline Keyboard**:
   - Row 1:
     - `[ 👍 Берём в Hot Match ]` (`callback_data: prm:<page_id>`)
     - `[ 👎 В архив ]` (`callback_data: dsc:<page_id>`)
   - Row 2:
     - `[ 🔗 Вакансия ]` (`url: job.url`)

3. **Telegram Callback Handler Behavior**:
   - **On `dsc:<page_id>`**:
     1. Update Notion page: `Status = "Rejected"`.
     2. Call Telegram `answerCallbackQuery(callback_query_id, text="❌ Вакансия отклонена")`.
     3. Call Telegram `editMessageReplyMarkup` (or `editMessageText`): replace keyboard with single inline status tag `❌ Отклонено пользователем`.
   - **On `prm:<page_id>`**:
     1. Update Notion page: `Status = "Hot Match"`.
     2. Call Telegram `answerCallbackQuery(callback_query_id, text="✅ Вакансия перенесена в Горячий мэтч")`.
     3. Replace Topic 3 keyboard with `✅ Перенесено в Горячий мэтч`.
     4. Format and post full vacancy card into **Topic 2 («Горячий мэтч»)** with `message_thread_id: 2`, company dossier block, and Topic 2 keyboard (`[ 🚀 Подготовить отклик ]`, `[ 🔗 Вакансия ]`, `[ 👎 В архив ]`).

4. **Shared Tested Implementation**:
   - Implement formatting, validation, and keyboard generation in `scraper/src/utils/telegram.ts`.
   - Provide unit tests in `scraper/tests/telegram-hitl.unit.test.ts`.
   - Provide an idempotent n8n workflow patch script `scripts/patch-n8n-hitl-review.py`.

## Consequences

### Positive
- Candidate can triage mid-score vacancies in seconds directly within Telegram Topic 3.
- Instant promotion physically moves the card to Topic 2 with one tap, updating Notion in real time.
- Strict <= 64 byte protocol prevents Telegram API errors.
- Fully backwards compatible and works offline in unit tests with zero paid services.

### Negative / Trade-offs
- Requires n8n `telegramTrigger` or webhook router to process `callback_query` updates.
- Updating Notion via API adds ~200–400ms latency to the callback response (mitigated by immediate `answerCallbackQuery`).
