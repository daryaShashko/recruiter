/**
 * Authoritative Interface Contracts for Application Generator Test Suites.
 * Defined strictly according to PROJECT.md § Interface Contracts and ORIGINAL_REQUEST.md.
 */

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

export interface PreRankResult {
  bulletId: string;
  score: number;
  matchedTags: string[];
}

export interface RenderCvOptions {
  outputPath: string;
  language?: 'en' | 'pl';
}

export interface RenderCvResult {
  pdfPath: string;
  pageCount: number;
  bufferSize: number;
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

/**
 * 5 Canonical Skills Categories required by R1 / Acceptance Criteria
 */
export const CANONICAL_SKILLS_CATEGORIES = [
  'Core Languages & Frameworks',
  'State & Databases',
  'Architecture & Infra',
  'Testing & Quality',
  'AI Tooling & Productivity',
] as const;

export type CanonicalSkillsCategory = (typeof CANONICAL_SKILLS_CATEGORIES)[number];

/**
 * 10 Forbidden Stop Words required by R2 / Acceptance Criteria
 */
export const FORBIDDEN_STOP_WORDS = [
  'delve',
  'testament',
  'beacon',
  'thrilled',
  'passionate',
  'spearheaded',
  'multifaceted',
  'synergetic',
  'seamlessly',
  'robust solutions',
] as const;

/**
 * Forbidden Opening Clichés required by R2 / Acceptance Criteria
 */
export const FORBIDDEN_OPENING_CLICHES = [
  'I am writing to express my interest',
  'As a results-driven engineer',
  'I am excited to apply',
  'Please accept my application',
  'With great enthusiasm',
] as const;
