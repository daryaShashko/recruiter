/**
 * Email Apply Application Packager
 * Location: scraper/src/generator/email-package.ts
 *
 * Responsibilities:
 * 1. Bundles recipient, subject, cover letter body, and PDF attachment into EmailPackage.
 * 2. Formats professional subject line: "Application: <CandidateName> - <JobTitle>".
 * 3. Resolves recipient email from job.email, mailto: in applyUrl/url, or fallback.
 * 4. Preserves exact Cover Letter text and computes accurate word count.
 * 5. Validates PDF attachment path (.pdf extension, non-empty, optional physical existence).
 * 6. Populates metadata: company, jobTitle, coverLetterWordCount, pdfPath, channel ('email_apply'), dryRun (default true), generatedAt (ISO 8601).
 * 7. Serializes package to disk as 'email_package.json' (avoiding Node package.json collision).
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  BuildEmailPackageParams,
  EmailPackage,
  EmailPackageMetadata,
} from './types';
import { DEFAULT_CANDIDATE_CONTACTS } from './notion-loader';
import { countWords } from './cover-letter';

export const DEFAULT_MANIFEST_FILENAME = 'email_package.json';

export interface ExtendedJobInput {
  title: string;
  company: string;
  email?: string;
  applyUrl?: string;
  url?: string;
  [key: string]: unknown;
}

export interface ExtendedBuildEmailPackageParams extends Omit<BuildEmailPackageParams, 'job'> {
  job: ExtendedJobInput;
  candidateName?: string;
  fallbackEmail?: string;
  customSubject?: string;
  attachments?: string[];
  validateAttachmentExists?: boolean;
}

/**
 * Extracts and sanitizes recipient email from job metadata.
 * Hierarchy:
 * 1. job.email (stripping mailto: and query parameters)
 * 2. job.applyUrl (if starting with mailto:)
 * 3. job.url (if starting with mailto:)
 * 4. fallbackEmail (defaults to empty string)
 */
export function extractRecipientEmail(
  job: { email?: string; applyUrl?: string; url?: string; [key: string]: unknown },
  fallbackEmail = ''
): string {
  if (!job || typeof job !== 'object') {
    return fallbackEmail.trim();
  }

  if (job.email && typeof job.email === 'string') {
    const cleaned = job.email.replace(/^mailto:\s*/i, '').split('?')[0].trim();
    if (cleaned.length > 0) {
      try {
        return decodeURIComponent(cleaned);
      } catch {
        return cleaned;
      }
    }
  }

  const urlCandidates = [job.applyUrl, job.url];
  for (const candidate of urlCandidates) {
    if (candidate && typeof candidate === 'string' && /^mailto:/i.test(candidate.trim())) {
      const cleaned = candidate.trim().replace(/^mailto:\s*/i, '').split('?')[0].trim();
      if (cleaned.length > 0) {
        try {
          return decodeURIComponent(cleaned);
        } catch {
          return cleaned;
        }
      }
    }
  }

  return fallbackEmail.trim();
}

/**
 * Formats standard professional subject line: "Application: <CandidateName> - <JobTitle>"
 */
export function formatSubjectLine(candidateName: string, jobTitle: string): string {
  const cleanName = candidateName?.trim() || DEFAULT_CANDIDATE_CONTACTS.name;
  const cleanTitle = jobTitle?.trim() || '';
  if (!cleanTitle) {
    return `Application: ${cleanName}`;
  }
  return `Application: ${cleanName} - ${cleanTitle}`;
}

/**
 * Validates PDF attachment path.
 */
export function validatePdfAttachment(
  pdfPath: string,
  options?: { checkExists?: boolean }
): { isValid: boolean; error?: string } {
  if (!pdfPath || typeof pdfPath !== 'string' || pdfPath.trim().length === 0) {
    return { isValid: false, error: 'pdfPath must be a non-empty string' };
  }
  if (!/\.pdf$/i.test(pdfPath.trim())) {
    return { isValid: false, error: 'pdfPath must point to a .pdf file' };
  }
  if (options?.checkExists && !fs.existsSync(pdfPath.trim())) {
    return { isValid: false, error: `PDF file does not exist at path: ${pdfPath}` };
  }
  return { isValid: true };
}

/**
 * Builds the canonical EmailPackage conforming to domain contracts.
 */
export function buildEmailPackage(
  params: BuildEmailPackageParams | ExtendedBuildEmailPackageParams
): EmailPackage {
  if (!params) {
    throw new TypeError('buildEmailPackage requires a params object');
  }
  if (!params.job || typeof params.job !== 'object') {
    throw new TypeError('params.job must be an object with title and company');
  }

  const job = params.job as ExtendedJobInput;
  const title = (job.title || '').trim();
  const company = (job.company || '').trim();
  const coverLetter = typeof params.coverLetter === 'string' ? params.coverLetter : '';
  const pdfPath = (params.pdfPath || '').trim();

  // Validate PDF path structure
  const pdfValidation = validatePdfAttachment(pdfPath, {
    checkExists: (params as ExtendedBuildEmailPackageParams).validateAttachmentExists,
  });
  if (!pdfValidation.isValid) {
    throw new Error(pdfValidation.error);
  }

  const extended = params as ExtendedBuildEmailPackageParams;
  const candidateName =
    extended.candidateName?.trim() ||
    process.env.CANDIDATE_NAME ||
    DEFAULT_CANDIDATE_CONTACTS.name;

  const subject =
    extended.customSubject?.trim() ||
    formatSubjectLine(candidateName, title);

  const to = extractRecipientEmail(job, extended.fallbackEmail);

  const attachments: string[] = [pdfPath];
  if (Array.isArray(extended.attachments)) {
    for (const att of extended.attachments) {
      if (typeof att === 'string' && att.trim() && !attachments.includes(att.trim())) {
        attachments.push(att.trim());
      }
    }
  }

  const dryRun = params.dryRun !== undefined ? Boolean(params.dryRun) : true;
  const coverLetterWordCount = countWords(coverLetter);

  const metadata: EmailPackageMetadata = {
    company,
    jobTitle: title,
    coverLetterWordCount,
    pdfPath,
    channel: 'email_apply',
    dryRun,
    generatedAt: new Date().toISOString(),
  };

  return {
    to,
    subject,
    body: coverLetter,
    attachments,
    metadata,
  };
}

/**
 * Serializes an EmailPackage to formatted JSON string.
 */
export function serializeEmailPackage(pkg: EmailPackage): string {
  return JSON.stringify(pkg, null, 2);
}

/**
 * Saves the EmailPackage as a JSON manifest to output directory.
 * Avoids collision with Node's package.json by using 'email_package.json'.
 */
export function saveEmailPackage(
  pkg: EmailPackage,
  outputDir: string,
  fileName: string = DEFAULT_MANIFEST_FILENAME
): string {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const manifestPath = path.join(outputDir, fileName);
  fs.writeFileSync(manifestPath, serializeEmailPackage(pkg), 'utf-8');
  return manifestPath;
}

/**
 * Loads and parses an EmailPackage manifest from disk.
 */
export function loadEmailPackage(manifestPath: string): EmailPackage {
  const content = fs.readFileSync(manifestPath, 'utf-8');
  return JSON.parse(content) as EmailPackage;
}
