# Project: Personalized Application Generator (ATS CV, Cover Letter, Email Apply)

## Architecture
- **Package Location**: `scraper/src/generator/` (inside `scraper/` package to utilize existing Playwright `1.63.0` and TypeScript `5.5.3` compiler settings without introducing unnecessary root workspaces or violating repo surface checks).
- **Data Flow**:
  1. **Candidate Profile / Master CV**: Loaded via `notion-loader.ts` from Notion Live API or fallback snapshot (`n8n/prompts/.notion-snapshot.json` / `DEFAULT_CV_ENTRIES`), preserving Notion as the sole source of truth.
  2. **Job Offer Input**: Ingests job vacancy data (`JobOffer` from `scraper/src/types.ts` or mock fixture).
  3. **Deterministic Pre-Ranker**: Evaluates JD keywords and stack tags against Master CV bullet tags, generating relevance-ranked bullet IDs for zero-hallucination selection and 100% offline fallback.
  4. **Zero-Hallucination Bullet Assembler**: Maps selected IDs strictly to exact text from Notion Master CV.
  5. **Skills Matrix Formatter**: Maps candidate skills into strictly 5 canonical categories without graphical bars.
  6. **ATS CV HTML/CSS & Playwright PDF Renderer**: Renders single-column A4 HTML with CSS `@page { size: A4 portrait; margin: 10mm 12mm; }` and compiles to vector PDF via Playwright Chromium headless `page.pdf()`. Includes RODO clause.
  7. **Cover Letter Generator**: Builds 130–180 word letter with 3 blocks (hook, 2–3 quantified bullets, logistics/CTA), excluding all 10 stop words and opening clichés.
  8. **Email Apply Packager & CLI**: Bundles subject, body, recipient, and attached PDF path into `email_package.json` for dry-run verification without sending real emails.
  9. **Documentation & Source of Truth**: Explicitly records Notion as sole source of truth in `AGENTS.md`, `docs/notion-schema.md`, and `context/`, eliminating manual CV duplicates.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Notion Source of Truth Documentation | Fix Notion `Candidate CV & Experience` as sole source of truth in `AGENTS.md` and `docs/notion-schema.md`, eliminating any manual `master-cv.yaml` references | M1 | Survey / R4 |
| 2 | Generator Domain Types | Define TypeScript interfaces for CV, Cover Letter, Pre-Ranker, Skills Matrix, and Email Package in `scraper/src/generator/types.ts` | M1 | Survey / R1, R2, R3 |
| 3 | Notion Candidate Data Loader | Loader fetching from Notion or local `.notion-snapshot.json` / seed with graceful offline fallback | M1 | Survey / R1, R4 |
| 4 | Deterministic TypeScript Pre-Ranker | Tag-matching ranking engine for bullet points with 100% offline fallback capability | M2 | Survey / R1 |
| 5 | Zero-Hallucination Bullet Assembler | Verbatim bullet injection based strictly on bullet IDs from Master CV (no hallucinated text) | M2 | Survey / R1 |
| 6 | 5-Category Skills Matrix | Canonical technology names in 5 strict categories, no graphical progress bars or tables | M2 | Survey / R1 |
| 7 | Single-Column Strict ATS HTML Layout | Semantic HTML without tables, icons, or graphics; contact header, Google XYZ bullets, Tech Stack lines, and Polish RODO clause | M2 | Survey / R1 |
| 8 | Playwright Headless PDF Renderer | Local rendering via Chromium `page.pdf()` producing strictly 1 or 2 page A4 vector PDF with clickable links | M2 | Survey / R1 |
| 9 | Cover Letter 3-Block Generator | 130–180 word text covering hook under JD, 2–3 quantified bullets, logistics (Gdańsk/Remote, EU work right, B2B/UoP), and CTA | M3 | Survey / R2 |
| 10 | Stop Words & Clichés Filter | Automated validator rejecting forbidden stop words (`delve`, `testament`, etc.) and opening clichés | M3 | Survey / R2 |
| 11 | English/Polish Language Selector | Default English, Polish only when JD is strictly Polish (with C1 EN + B1/B2 PL note) | M3 | Survey / R2 |
| 12 | Email Apply Packager | JSON manifest assembler containing recipient, subject, body, and generated PDF attachment path | M4 | Survey / R3 |
| 13 | Channel Status Alignment | Fix Email Apply as implemented Channel 1; record web-form platforms as subsequent roadmap stages | M4 | Survey / R3 |
| 14 | Dry-Run CLI & Repository Scripts | CLI supporting `--dry-run` on repository mock vacancies, outputting artifacts to disk without network sends | M4 | Survey / R3 |
| 15 | E2E Test Suite (Tiers 1-4) | Comprehensive opaque-box test suite verifying all features against acceptance criteria | E2E-Track | Survey / All AC |
| 16 | Final Integration & Adversarial Verification | 100% pass of E2E test suite followed by adversarial stress testing (Tier 5) | M5 | Survey / Final |

## Application Submission Channels

The application generation pipeline (`scraper/src/generator/`) supports multiple employer application channels. To ensure deterministic execution, safety ($0 cost, zero unsolicited network calls), and manageable scope, channels are organized into active and scheduled phases:

| Channel # | Channel Name | Type | Status | Artifacts / Implementation |
|-----------|--------------|------|--------|----------------------------|
| **Channel 1** | **Email Apply** | Direct Email Manifest | **Active (Implemented)** | Bundles recipient, personalized subject, 130–180 word Cover Letter body, and attached vector A4 PDF path into `email_package.json`. Verified in `--dry-run` mode without network delivery. |
| **Channel 2** | **Greenhouse ATS** | Web Form Auto-Apply | **Scheduled (Subsequent Stage)** | Playwright automation filling Greenhouse board application form fields (`/jobs/<id>#app`), uploading PDF CV, and submitting in dry-run mode. |
| **Channel 3** | **Lever ATS** | Web Form Auto-Apply | **Scheduled (Subsequent Stage)** | Playwright automation filling Lever posting application form fields (`/apply`), uploading PDF CV, and submitting in dry-run mode. |
| **Channel 4** | **Workable ATS** | Web Form Auto-Apply | **Scheduled (Subsequent Stage)** | Playwright automation filling Workable modal application form fields, uploading PDF CV, and submitting in dry-run mode. |
| **Channel 5** | **JustJoin IT Quick-Apply** | Portal Form Auto-Apply | **Scheduled (Subsequent Stage)** | Playwright automation filling JustJoin.it 1-click apply modal with candidate data and PDF attachment in dry-run mode. |

### Channel 1: Email Apply Invariants
- Manifest generated at `output/applications/<company>-<slug>/email_package.json`.
- Attached ATS CV generated at `output/applications/<company>-<slug>/cv.pdf` (strictly 1 or 2 pages A4).
- Cover Letter generated at `output/applications/<company>-<slug>/cover_letter.txt` (130–180 words, 0 stop words).
- Zero external network requests: no SMTP, SendGrid, or SES calls are made during local generation or dry-run runs.

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Source of Truth & Data Layer | Documentation updates (AGENTS.md, docs), generator domain types (`types.ts`), Notion loader (`notion-loader.ts`) | none | DONE |
| M2 | ATS CV Generator (PDF) | Pre-Ranker, zero-hallucination bullet assembler, 5-category skills matrix, single-column HTML layout, Playwright headless A4 PDF renderer, RODO clause | M1 | DONE |
| M3 | Cover Letter Generator | 3-block 130–180 word generator, stop words and cliché validation, English/Polish language detection | M1 | DONE |
| M4 | Email Apply Packager & CLI | Email package bundling, channel status docs, CLI runner with `--dry-run` mode against mock vacancies, npm scripts | M2, M3 | DONE |
| M5 | Final E2E Pass & Coverage Hardening | Pass 100% of E2E test suite (Tiers 1-4) and adversarial coverage hardening (Tier 5) | M4, TEST_READY.md | DONE |

## Interface Contracts
### `notion-loader.ts` ↔ Generator Modules
```typescript
export interface CandidateContacts {
  name: string;
  location: string;
  phone: string;
  email: string;
  linkedIn: string;
  github: string;
}

export interface CandidateBullet {
  id: string;
  title: string;
  section: string;
  highlight: string;
  tags: string[];
  period?: string;
  order: number;
}

export interface CandidateCvData {
  contacts: CandidateContacts;
  summary: string;
  bullets: CandidateBullet[];
  skills: Record<string, string[]>;
  rodoClause: {
    pl: string;
    en: string;
  };
}

export function loadCandidateCvData(offlineOnly?: boolean): Promise<CandidateCvData>;
```

### `pre-ranker.ts` ↔ `bullet-assembler.ts`
```typescript
export interface PreRankResult {
  bulletId: string;
  score: number;
  matchedTags: string[];
}

export function preRankBullets(
  bullets: CandidateBullet[],
  jobTitle: string,
  jobBody: string,
  jobTags?: string[]
): PreRankResult[];

export function assembleExperienceBullets(
  bulletIds: string[],
  allBullets: CandidateBullet[]
): CandidateBullet[];
```

### `cv-renderer.ts` ↔ CLI / Exporters
```typescript
export interface RenderCvOptions {
  outputPath: string;
  language?: 'en' | 'pl';
}

export function renderCvToPdf(
  cvData: CandidateCvData,
  selectedBullets: CandidateBullet[],
  options: RenderCvOptions
): Promise<{ pdfPath: string; pageCount: number; bufferSize: number }>;
```

### `cover-letter.ts` ↔ `email-package.ts`
```typescript
export interface CoverLetterOptions {
  job: {
    title: string;
    company: string;
    body: string;
    tags?: string[];
  };
  language?: 'en' | 'pl';
}

export interface CoverLetterResult {
  text: string;
  wordCount: number;
  language: 'en' | 'pl';
  isValid: boolean;
  validationErrors: string[];
}

export function generateCoverLetter(
  cvData: CandidateCvData,
  options: CoverLetterOptions
): CoverLetterResult;
```

### `email-package.ts` ↔ CLI
```typescript
export interface EmailPackage {
  to: string;
  subject: string;
  body: string;
  attachments: string[];
  metadata: {
    company: string;
    jobTitle: string;
    coverLetterWordCount: number;
    pdfPath: string;
    channel: 'email_apply';
    dryRun: boolean;
    generatedAt: string;
  };
}

export function buildEmailPackage(params: {
  job: { title: string; company: string; email?: string };
  coverLetter: string;
  pdfPath: string;
  dryRun?: boolean;
}): EmailPackage;
```

## Code Layout
```text
scraper/src/generator/
├── types.ts              # Domain interfaces and contracts
├── notion-loader.ts      # Notion data loader + offline fallback (.notion-snapshot.json)
├── pre-ranker.ts         # Deterministic tag-matching ranking engine (100% offline fallback)
├── bullet-assembler.ts   # Zero-hallucination ID-to-verbatim-text assembler
├── skills-matrix.ts      # 5 canonical categories formatter (no graphic bars)
├── cv-renderer.ts        # ATS single-column HTML/CSS + Playwright page.pdf() renderer
├── cover-letter.ts       # 130–180 word EU/Poland cover letter generator with stop-word filter
├── email-package.ts      # Channel packager (subject, body, recipient, attached PDF path)
└── cli.ts                # CLI entry point for dry-run verification against repository mock vacancies

output/applications/      # Target directory for generated dry-run application packages
```
