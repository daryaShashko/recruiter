/**
 * Generator Domain Types
 * Location: scraper/src/generator/types.ts
 *
 * Source of truth for ATS CV, Cover Letter, Skills Matrix, Pre-Ranker,
 * and Email Application Packaging.
 */

// ── 1. Candidate Contacts & Profile ─────────────────────────────────────────

export interface CandidateContacts {
  name: string;
  location: string;
  phone: string;
  email: string;
  linkedIn: string;
  github: string;
}

// ── 2. Master CV Experience Bullets ──────────────────────────────────────────

export interface CandidateBullet {
  id: string;
  slug?: string;
  title: string;
  section: string;
  highlight: string;
  tags: string[];
  period?: string;
  order: number;
}

// ── 3. Legal & Regulatory Clauses ───────────────────────────────────────────

export interface RodoClause {
  pl: string;
  en: string;
}

// ── 4. Skills Matrix (Strictly 5 Canonical Categories) ───────────────────────

export type SkillsCategory =
  | 'Core Languages & Frameworks'
  | 'State & Databases'
  | 'Architecture & Infra'
  | 'Testing & Quality'
  | 'AI Tooling & Productivity';

export const SKILLS_CATEGORIES: readonly SkillsCategory[] = [
  'Core Languages & Frameworks',
  'State & Databases',
  'Architecture & Infra',
  'Testing & Quality',
  'AI Tooling & Productivity',
] as const;

export type SkillsMatrix = Record<SkillsCategory | string, string[]>;

// ── 5. Candidate CV Data (Aggregated Master CV) ──────────────────────────────

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

// ── 6. Pre-Ranker & Bullet Assembler Contracts ──────────────────────────────

export interface PreRankResult {
  bulletId: string;
  score: number;
  matchedTags: string[];
}

export interface PreRankOptions {
  limit?: number;
  minScore?: number;
}

// ── 7. CV Renderer Contracts (Playwright PDF) ───────────────────────────────

export interface RenderCvOptions {
  outputPath: string;
  language?: 'en' | 'pl';
  pageLimit?: 1 | 2;
}

export interface RenderCvResult {
  pdfPath: string;
  pageCount: number;
  bufferSize: number;
}

// ── 8. Cover Letter Generator Contracts ─────────────────────────────────────

export interface CoverLetterJobInput {
  title: string;
  company: string;
  body: string;
  tags?: string[];
  location?: string;
}

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

// ── 9. Email Apply Packager Contracts ───────────────────────────────────────

export interface EmailPackageMetadata {
  company: string;
  jobTitle: string;
  coverLetterWordCount: number;
  pdfPath: string;
  channel: 'email_apply';
  dryRun: boolean;
  generatedAt: string;
}

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

export interface BuildEmailPackageParams {
  job: {
    title: string;
    company: string;
    email?: string;
  };
  coverLetter: string;
  pdfPath: string;
  dryRun?: boolean;
}

// ── 10. Loader Options & Snapshot Representation ────────────────────────────

export interface NotionLoaderOptions {
  offlineOnly?: boolean;
  snapshotPath?: string;
  notionToken?: string;
  cvDbId?: string;
  fetchImpl?: typeof fetch;
}

export interface RawCvEntrySnapshot {
  id: string;
  title: string;
  section: string;
  order: number;
  highlight: string;
  tags: string[];
  period?: string;
  active: boolean;
  details?: string;
}

// ── 11. LinkedIn Outreach Pitch & Telegram Application Delivery (Slice 3) ───

export interface LinkedInPitchOptions {
  job: {
    title: string;
    company: string;
    tags?: string[];
    body?: string;
  };
  contactName?: string;
  language?: 'en' | 'pl';
}

export interface LinkedInPitchResult {
  text: string;
  wordCount: number;
  language: 'en' | 'pl';
  isValid: boolean;
  validationErrors: string[];
}

export interface TelegramApplicationPackage {
  pageId: string;
  company: string;
  jobTitle: string;
  pdfPath: string;
  pitch: LinkedInPitchResult;
  coverLetter: CoverLetterResult;
  telegramMessages: {
    documentCaption: string;
    textMessageHtml: string;
  };
  notionStatusPatch: {
    properties: {
      Status: {
        select: {
          name: 'Applied';
        };
      };
    };
  };
}
