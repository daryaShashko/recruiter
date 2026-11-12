# ADR-024: Company Metadata Extraction and Alert Company Dossier Block (HITL Slice 1)

**Status:** accepted  
**Date:** 2026-11-12  
**Deciders:** Core Team  
**Consulted:** AGENTS.md, hitl-recruiter-plan.md  

## Context

Candidates reviewing job alerts in Telegram or the Notion Kanban board often need rapid context regarding the hiring employer: company size/scale, direct company website, core product offering, and business model (B2B vs B2C, product vs agency).

Previously:
1. `JobOffer` only contained `company` (name string) and job posting `url`. Hidden metadata provided by job board APIs (such as `companySize` and `companyUrl` on JustJoin.it and NoFluffJobs) was discarded during normalization.
2. Offers without direct company URLs (or from third-party aggregators/sources) required manual searching by candidate/recruiter to research the company.
3. Telegram alerts lacked any employer context or website links, forcing the candidate to open the vacancy and independently search the company on Google.
4. The LLM Evaluator only produced overall fit scoring, tech stack alignment, and rejection flags, with no structured summary of the company.

## Decision

We adopt Slice 1 of the Human-in-the-Loop (HITL) architecture:
1. **Extend `JobOffer` interface** (`scraper/src/types.ts`):
   - Add optional field `companyMeta?: CompanyMetadata`.
   - Define `CompanyMetadata` with `size?: string`, `companyUrl?: string`, `advertiserType?: string`, and `industry?: string`.
2. **Scraper Extraction & Backward Compatibility** (`scraper/src/scrapers/justjoin.ts`, `scraper/src/scrapers/nofluffjobs.ts`):
   - Extract `companySize` (normalized to string `size`) and `companyUrl` from API responses into `JobOffer.companyMeta`.
   - Handle all fields as strictly optional, maintaining full backward compatibility for older payloads or missing fields.
3. **Google Search Fallback Mechanism** (`scraper/src/utils/company.ts`, `scraper/src/types.ts`):
   - Implement `buildCompanySearchUrl(companyName)` generating `https://www.google.com/search?q=${encodeURIComponent(companyName + ' software')}`.
   - When a direct company website is unavailable or when offers originate from sources without company URLs, the system uses this fallback link.
4. **LLM Evaluator Dossier & Anti-Hallucination Rule** (`n8n/prompts/evaluator.md`, `n8n/prompts/evaluator-template.json`, `n8n/evaluator/prompt-builder.ts`, `n8n/evaluator/scoring.ts`):
   - Add `company_dossier` to output schema (1–2 concise sentences in Russian covering product/domain, B2B/B2C business model, and company scale).
   - Require grounding strictly in job description text when the company is unknown to the model's internal knowledge base, preventing hallucinations.
5. **Alert Template Specification** (`context/ingest-workflow.yaml`, `context/modules/n8n.yaml`):
   - Update Telegram alert template with a dedicated «🏢 О компании» block displaying `company_dossier`, along with a direct link to the company website if present or the clickable Google search fallback link.

## Consequences

### Positive
- Rich employer context in Telegram alerts allows instant decision-making on whether to apply.
- Zero manual typing or searching required to find company websites.
- Fully backward compatible: existing workflows and payloads without `companyMeta` continue functioning cleanly.
- Preserves $0/month cost invariant and runs entirely offline/local in scraper runs and tests.

### Negative / Trade-offs
- Slight increase (~30–50 tokens) in LLM completion tokens for evaluating each job due to generating `company_dossier`.
- Job board API metadata (`companySize`, `companyUrl`) may occasionally be omitted by employers, relying on the Google fallback.
