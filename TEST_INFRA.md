# Test Infrastructure & Opaque-Box Methodology

## 1. Test Philosophy

The testing framework for the Personalized Application Generator (`scraper/src/generator/`) adheres to strict **opaque-box (black-box) engineering principles**. Tests are designed independently against user requirements (`ORIGINAL_REQUEST.md`) and interface specifications (`PROJECT.md`), rather than reverse-engineering or adapting to internal implementation nuances.

### Core Principles

1. **Strict Specification Adherence**:
   Every test assertion derives directly from explicit requirements (R1–R4) and interface contracts. Test suites never inspect or mirror implementation code shortcuts.
2. **Zero-Hallucination Verification**:
   The generator must guarantee 100% factual fidelity. Test suites verify that candidate bullets in generated CVs match Master CV data verbatim by ID, and that LLM selection never produces fabricated text.
3. **Progressive Testability & Isolation**:
   Every test case is self-contained. Each test creates its own fixtures, avoids global shared mutable state, executes deterministically, and cleans up temporary files (PDFs, mock artifacts) upon completion.
4. **Offline-First & Network Isolation ($0 Cost)**:
   All unit, component, integration, and E2E dry-run tests execute without external network dependencies. Playwright PDF rendering operates locally via Chromium headless ($0 cloud cost). Dry-run pipelines must never emit external HTTP/SMTP calls.
5. **Authoritative Expected Output Derivation**:
   Expected outputs are established from mathematical bounds (e.g. word count $130 \le n \le 180$, strict 1 or 2 A4 pages), domain specifications (5 canonical skills categories, 10 forbidden stop words), or verifiable structural schemas (Notion snapshot schema, PDF header `%PDF-`).
6. **Adversarial Verification**:
   Beyond happy paths, tests assert boundary conditions (129 vs 130 words, 180 vs 181 words), Unicode and HTML injection sanitization, casing/punctuation variations of stop words, empty/malformed JDs, and resilient offline fallbacks.

---

## 2. Feature Inventory Matrix

The generator spans 16 features across Milestones M1–M5 and requirements R1–R4. The matrix below defines the test coverage across tiers for each feature:

| Feature # | Feature Name | Requirement | Tier | Test Suite File | Verification Scope |
|:---:|---|:---:|:---:|---|---|
| **1** | Notion Source of Truth Documentation | R4 | Tier 4 | `tier4-e2e-dryrun.test.ts` | Verify Notion (`Candidate CV & Experience`) is sole source of truth in `AGENTS.md` and `docs/notion-schema.md`; verify no `master-cv.yaml` exists. |
| **2** | Generator Domain Types | R1, R2, R3 | Tier 2 | `tier2-contracts.test.ts` | Compile-time & runtime schema validation of `CandidateCvData`, `PreRankResult`, `CoverLetterResult`, `EmailPackage`. |
| **3** | Notion Candidate Data Loader | R1, R4 | Tier 2 | `tier2-contracts.test.ts` | Offline fallback returns valid structured CV; schema conforms to contacts, bullets, skills, RODO. |
| **4** | Deterministic TypeScript Pre-Ranker | R1 | Tier 1 | `tier1-algorithmic.test.ts` | Tag overlap scoring, deterministic ranking, tie-breaking, empty tags handling, 100% offline fallback. |
| **5** | Zero-Hallucination Bullet Assembler | R1 | Tier 1 | `tier1-algorithmic.test.ts` | Verbatim bullet injection based strictly on bullet IDs; rejection/filtering of phantom IDs; zero hallucinated facts. |
| **6** | 5-Category Skills Matrix | R1 | Tier 1 | `tier1-algorithmic.test.ts` | Strict mapping to 5 canonical categories; canonical naming (Node.js, TypeScript); zero graphical progress bars or scale graphics. |
| **7** | Single-Column Strict ATS HTML Layout | R1 | Tier 2 | `tier2-contracts.test.ts` | Semantic single-column HTML; absence of `<table>`, icons, graphics; Google XYZ bullets; Tech Stack line; Polish RODO clause. |
| **8** | Playwright Headless PDF Renderer | R1 | Tier 3 | `tier3-rendering.test.ts` | Headless Chromium `page.pdf()`; CSS `@page { size: A4 portrait; margin: 10mm 12mm; }`; strictly 1 or 2 pages A4; vector text; clickable links. |
| **9** | Cover Letter 3-Block Generator | R2 | Tier 2 | `tier2-contracts.test.ts` | 3 distinct blocks: (1) JD hook, (2) 2–3 quantified bullets with metrics/stack/GenAI, (3) logistics (Gdańsk/Remote, B2B/UoP, EU work right) + CTA. |
| **10** | Stop Words & Clichés Filter | R2 | Tier 1 | `tier1-algorithmic.test.ts` | Rejection of 10 forbidden stop words (`delve`, `testament`, etc.) and opening clichés ("I am writing to express..."); clean text passes. |
| **11** | English/Polish Language Selector | R2 | Tier 1 | `tier1-algorithmic.test.ts` | English by default; Polish selected only when JD is strictly Polish (with C1 EN + B1/B2 PL logistics note). |
| **12** | Email Apply Packager | R3 | Tier 2 | `tier2-contracts.test.ts` | Manifest packaging: recipient, subject, body, attachment path; valid `EmailPackage` object. |
| **13** | Channel Status Alignment | R3 | Tier 4 | `tier4-e2e-dryrun.test.ts` | Verification in documentation/roadmap: Email Apply is Channel 1 (active); ATS web-form platforms are planned subsequent stages. |
| **14** | Dry-Run CLI & Repository Scripts | R3 | Tier 4 | `tier4-e2e-dryrun.test.ts` | CLI execution with `--dry-run`; outputs artifacts to `output/applications/`; zero network/email requests dispatched. |
| **15** | Comprehensive E2E Test Suite | All | Tiers 1–4 | `tier1-4` & `run-all` | Full automated regression suite executing all opaque-box checks. |
| **16** | Final Integration & Adversarial Stress | All | Tier 5 | `adversarial.test.ts` | Boundary stress (129, 130, 180, 181 words), XSS/HTML injection escaping, special characters, malformed inputs. |

---

## 3. 4-Tier Testing Methodology

The test architecture divides testing into four progressive tiers, plus an adversarial stress tier:

```
┌────────────────────────────────────────────────────────┐
│   Tier 5: Adversarial Stress & Edge Conditions         │
│   (XSS/injection, boundary words, case variants)       │
├────────────────────────────────────────────────────────┤
│   Tier 4: End-to-End Dry-Run & Source-of-Truth         │
│   (Mock vacancy pipeline, output files, doc audit)     │
├────────────────────────────────────────────────────────┤
│   Tier 3: Integration & Rendering                      │
│   (Playwright headless A4 PDF, page budget, links)     │
├────────────────────────────────────────────────────────┤
│   Tier 2: Contracts, Schemas & Component Assembly      │
│   (Notion loader, ATS HTML structure, 3-block CL)      │
├────────────────────────────────────────────────────────┤
│   Tier 1: Pure Algorithmic & Unit Logic                │
│   (Pre-Ranker, Assembler, Skills Matrix, Filters)      │
└────────────────────────────────────────────────────────┘
```

### Tier 1: Pure Algorithmic & Unit Logic
- **Scope**: In-memory, deterministic, zero I/O functions.
- **Components**:
  - `preRankBullets`: Computes tag overlap, relevance scores, and tie-breaking determinism.
  - `assembleExperienceBullets`: Verbatim ID matching against candidate bullets; filters invalid IDs; ensures no hallucinated text.
  - `skillsMatrix`: Normalizes technology names into strictly 5 canonical categories without graphical scales.
  - `stopWordsFilter`: Scans for 10 forbidden stop words (`delve`, `testament`, `beacon`, `thrilled`, `passionate`, `spearheaded`, `multifaceted`, `synergetic`, `seamlessly`, `robust solutions`) and opening clichés.
  - `wordCounter`: Computes strict word count according to whitespace tokenization.
  - `languageSelector`: Determines `'en'` vs `'pl'` based on JD language markers.

### Tier 2: Contracts, Schemas & Component Assembly
- **Scope**: Module interfaces, data validation, and template structuring.
- **Components**:
  - `notionLoader`: Gracefully falls back to offline snapshot (`.notion-snapshot.json` / seed entries) when Notion API is unreachable. Schema check: contacts, bullets, skills, RODO.
  - `atsHtmlTemplate`: Single-column layout validation. Confirms absence of `<table>`, `<th>`, `<td>`, icons (`<svg>`, `<i>`), and progress bars. Confirms presence of contact header (Name, Gdańsk, Poland, phone, email, LinkedIn, GitHub; no photo, age, street address), Google XYZ bullets, "Environment / Tech Stack:" line, and Polish RODO clause.
  - `coverLetterGenerator`: Validates 3-block structure (Hook, 2-3 Quantified Bullets, Logistics & CTA) and word count compliance ($130 \le \text{words} \le 180$).
  - `emailPackager`: Bundles valid `EmailPackage` with metadata (`channel: 'email_apply'`, `dryRun: true`).

### Tier 3: Integration & Rendering
- **Scope**: Local headless browser execution and file rendering ($0 cost).
- **Components**:
  - `cvRenderer`: Invokes Playwright Chromium headless `page.pdf()`.
  - Asserts CSS `@page { size: A4 portrait; margin: 10mm 12mm; }`.
  - Asserts generated PDF begins with magic bytes `%PDF-`.
  - Asserts strict page count constraint: strictly 1 or 2 pages A4 (zero orphan lines or blank pages).
  - Asserts vector text rendering (extractable text streams, non-rasterized).
  - Asserts clickable hyperlinks for LinkedIn, GitHub, and email.
  - Asserts proper cleanup of temporary test files.

### Tier 4: End-to-End Dry-Run & Source-of-Truth Integrity
- **Scope**: Complete application flow and repository-wide architectural constraints.
- **Components**:
  - End-to-end dry-run execution with mock vacancy fixture.
  - Outputs generated package to `output/applications/`: validates existence of `email_package.json` and compiled CV PDF.
  - Network isolation check: verifies zero real email sends (no SMTP/external API requests).
  - Source of Truth audit: verifies `AGENTS.md` and `docs/notion-schema.md` explicitly designate Notion `Candidate CV & Experience` as the sole source of truth.
  - Confirms zero occurrences of `master-cv.yaml` or legacy manual CV files in the repository.
  - Confirms channel documentation designates Email Apply as Channel 1 (active) and web forms as future phases.

### Tier 5: Adversarial Stress & Hardening
- **Scope**: Resilience under boundary stress, malicious injection, and invalid combinations.
- **Components**:
  - Extreme word counts: rejects 129 words and 181 words; accepts exactly 130 and 180 words.
  - Stop words with varied casing (`DELVE`, `ThRiLlEd`), surrounding punctuation (`"spearheaded,"`, `(passionate)`).
  - HTML/script injection in candidate contact fields and bullet text (proper sanitization / escaping in PDF HTML).
  - Empty or malformed vacancy descriptions (graceful degradation, no crashes).

---

## 4. Test Execution & Reporting

All tests are runnable through Jest in `scraper/`:

```bash
# Run all generator test suites
cd scraper && npm test -- tests/generator

# Run specific tiers
cd scraper && npx jest tests/generator/tier1-algorithmic.test.ts
cd scraper && npx jest tests/generator/tier2-contracts.test.ts
cd scraper && npx jest tests/generator/tier3-rendering.test.ts
cd scraper && npx jest tests/generator/tier4-e2e-dryrun.test.ts
cd scraper && npx jest tests/generator/adversarial.test.ts
```

All test assertions produce actionable failure messages pointing directly to the violated requirement (R1–R4) or interface contract.
