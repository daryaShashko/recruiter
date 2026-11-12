# ADR-026: Telegram In-Thread Application Delivery (HITL Slice 3)

**Status:** accepted  
**Date:** 2026-11-12  
**Deciders:** Core Team  
**Consulted:** AGENTS.md, hitl-recruiter-plan.md, ADR-024, ADR-025  

## Context

When a candidate promotes a vacancy or finds a hot match in Telegram Topic 2 («Горячий мэтч»), applying to the role typically requires:
1. Opening their laptop or file system to locate the latest resume PDF.
2. Drafting a personalized outreach message for LinkedIn recruiters or founders.
3. Formulating a tailored cover letter for application web forms.
4. Manually updating the Kanban card status in Notion to "Applied".

This manual overhead introduces friction and delays response time. The goal of Slice 3 is 1-tap in-thread fulfillment:
- Pressing `[ 🚀 Подготовить отклик ]` (`app:<page_id>`) in Topic 2 triggers instant delivery of all assets directly into the Telegram topic thread.
- Zero-token execution ($0.00 cost): generated via deterministic template compilation based on the authoritative Notion Master CV data (`Candidate CV & Experience`).
- Response latency < 1–2 seconds: serving a cached/pre-compiled gold standard `cv.pdf` without launching Chromium per request, accompanied by a 60–80 word LinkedIn pitch and tailored Cover Letter in monospaced copy-ready blocks.
- Automatic Notion status transition to `Applied`.

## Decision

1. **LinkedIn Outreach Pitch Generator (`scraper/src/generator/cover-letter.ts`)**:
   - Add `generateLinkedInPitch(cvData, options)` generating a concise 60–80 word pitch (English default, Polish if JD is Polish).
   - Content: JD hook, top 2 quantified achievements (-15% cloud cost, high concurrency), EU/Poland B2B/UoP availability, CTA for 10-minute intro call.
   - Enforce clean text without forbidden clichés or stop words.

2. **Fast Base Gold `cv.pdf` Caching (`scraper/src/generator/cv-renderer.ts`)**:
   - Provide `getBaseCvPdf(cvData, options)` which returns a cached base vector ATS CV PDF in < 0.05 seconds if already generated, or renders and caches it once.
   - Prevents headless browser startup latency during live Telegram bot interactions.

3. **In-Thread Telegram Delivery Service (`scraper/src/generator/telegram-delivery.ts`)**:
   - Process `app:<page_id>`:
     - Generate tailored LinkedIn pitch & Cover Letter.
     - Prepare Telegram `sendDocument` payload with `cv.pdf` (caption: `📄 Резюме (ATS CV)`).
     - Prepare Telegram `sendMessage` payload with pitch and cover letter formatted inside HTML `<code>` / `<pre>` tags for 1-click clipboard copy.
     - Emit Notion status update patch (`Status = "Applied"`).

4. **Synchronize Context and Documentation**:
   - Update `context/ingest-workflow.yaml`, `context/modules/n8n.yaml`, and `context/decisions.yaml`.

## Consequences

### Positive
- Candidate can submit applications via LinkedIn or email in seconds from mobile or desktop.
- 1-click clipboard copying for outreach text.
- 100% offline, deterministic, $0 paid API cost.
- Instant Notion board synchronization.

### Negative / Trade-offs
- The base `cv.pdf` represents candidate's core profile; deep custom per-job re-rendering with new bullets requires Chromium execution (~3-4s).
