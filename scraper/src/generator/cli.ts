/**
 * Generator Dry-Run CLI & Multi-Channel Application Runner
 * Location: scraper/src/generator/cli.ts
 *
 * Capabilities:
 * 1. CLI entrypoint supporting flags: --dry-run, --job <id|path>, --lang <en|pl>, --outDir <path>, --target <all|cv|letter>.
 * 2. Programmatic runCli(options) and runApplicationPipeline(options) exports for testing and programmatic invocation.
 * 3. Default built-in mock job (DataBridge Tech Lead from n8n/prompts/smoke_dataset.yaml T02).
 * 4. Resolves smoke dataset case IDs (T01, T02, E01, F08, F01, E05) or custom JSON/YAML files.
 * 5. Full pipeline integration: loadCandidateCvData -> preRankBullets -> assembleExperienceBullets ->
 *    renderCvToPdf -> generateCoverLetter -> buildEmailPackage -> saveEmailPackage.
 * 6. Generates application bundle to output/applications/<company-slug>-<job-slug>/:
 *    - cv.pdf
 *    - cover_letter.txt
 *    - email_package.json
 * 7. Zero outbound network calls ($0 cost, 100% offline dry run).
 */

import * as fs from 'fs';
import * as path from 'path';
import { JobOffer } from '../types';
import {
  CandidateCvData,
  CandidateBullet,
  RenderCvResult,
  CoverLetterResult,
  EmailPackage,
} from './types';
import { loadCandidateCvData } from './notion-loader';
import { preRankBullets } from './pre-ranker';
import { assembleExperienceBullets } from './bullet-assembler';
import { renderCvToPdf } from './cv-renderer';
import { generateCoverLetter } from './cover-letter';
import {
  buildEmailPackage,
  saveEmailPackage,
  DEFAULT_MANIFEST_FILENAME,
} from './email-package';

export interface CliOptions {
  dryRun?: boolean;
  job?: string | JobOffer | Record<string, unknown>;
  lang?: 'en' | 'pl';
  language?: 'en' | 'pl';
  outDir?: string;
  outputDir?: string;
  target?: 'all' | 'cv' | 'letter';
  cvOnly?: boolean;
  letterOnly?: boolean;
  pageLimit?: 1 | 2;
  validateAttachmentExists?: boolean;
  candidateName?: string;
  fallbackEmail?: string;
}

export interface CliRunResult {
  success: boolean;
  company: string;
  jobTitle: string;
  applicationDir: string;
  artifacts: {
    cvPdf?: string;
    coverLetter?: string;
    emailPackage?: string;
  };
  pdfPath?: string;
  coverLetterPath?: string;
  emailPackagePath?: string;
  manifestPath?: string;
  emailPackage?: EmailPackage;
  error?: string;
}

/**
 * Built-in default mock job (T02 DataBridge Tech Lead from n8n/prompts/smoke_dataset.yaml)
 */
export const DEFAULT_MOCK_JOB: JobOffer = {
  id: 'databridge-tech-lead-typescript-001',
  title: 'Tech Lead — TypeScript/Node.js',
  company: 'DataBridge',
  location: 'Gdańsk, hybrid',
  salary: '25,000 – 32,000 PLN net B2B',
  url: 'https://nofluffjobs.com/job/databridge-tech-lead-typescript-gdansk-ab12cd',
  body: 'We are looking for an experienced Tech Lead to guide our backend team of 6 engineers. Our stack: TypeScript, NestJS, React, PostgreSQL, Redis, Docker, Kubernetes. You will own technical decisions, code reviews, and architecture for our SaaS platform. Hybrid model: 2 days in our Gdańsk office. Requirements: 7+ years in software engineering, 2+ years in a lead role.',
  source: 'nofluffjobs',
  tags: [
    'TypeScript',
    'Node.js',
    'NestJS',
    'React',
    'PostgreSQL',
    'Docker',
    'Redis',
    'Kubernetes',
  ],
  scrapedAt: new Date().toISOString(),
};

/**
 * Normalizes text to URL/filesystem safe slug.
 * Transforms: "Tech Lead — TypeScript/Node.js" -> "tech-lead-typescript-nodejs"
 */
export function slugify(text: string): string {
  if (!text || typeof text !== 'string') return 'unknown';
  return text
    .toLowerCase()
    .replace(/\.js\b/gi, 'js')
    .replace(/[/_]/g, '-')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Parses smoke_dataset.yaml file and extracts mock jobs by case ID.
 */
function parseSmokeDataset(filePath: string): Map<string, JobOffer> {
  const jobs = new Map<string, JobOffer>();
  if (!fs.existsSync(filePath)) return jobs;

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const blocks = content.split(/\n(?=-\s+description:)/);

    for (const block of blocks) {
      const descMatch = block.match(/-\s+description:\s*["']?([A-Za-z0-9_]+):?\s*([^"'\n]*)/);
      if (!descMatch) continue;
      const caseId = descMatch[1].trim().toUpperCase();

      const titleMatch = block.match(/title:\s*["']?([^"'\n]+)["']?/);
      const companyMatch = block.match(/company:\s*["']?([^"'\n]+)["']?/);
      const locationMatch = block.match(/location:\s*["']?([^"'\n]+)["']?/);
      const salaryMatch = block.match(/salary:\s*["']?([^"'\n]+)["']?/);
      const urlMatch = block.match(/url:\s*["']?([^"'\n]+)["']?/);

      let body = '';
      const bodyIndex = block.indexOf('body:');
      if (bodyIndex !== -1) {
        const afterBody = block.slice(bodyIndex + 5);
        const lines = afterBody.split('\n');
        const bodyLines: string[] = [];
        let inBody = false;

        for (const line of lines) {
          if (!inBody) {
            const trimmed = line.trim();
            if (trimmed === '>-' || trimmed === '|' || trimmed === '|-') {
              inBody = true;
              continue;
            } else if (trimmed.length > 0) {
              body = trimmed.replace(/^["']|["']$/g, '');
              break;
            }
          } else {
            if (/^\s{4,}/.test(line)) {
              bodyLines.push(line.trim());
            } else if (line.trim() === '' && bodyLines.length > 0) {
              bodyLines.push('');
            } else {
              break;
            }
          }
        }

        if (bodyLines.length > 0) {
          body = bodyLines.join(' ').replace(/\s+/g, ' ').trim();
        }
      }

      const title = titleMatch ? titleMatch[1].trim() : `Mock Job ${caseId}`;
      const company = companyMatch ? companyMatch[1].trim() : 'Mock Company';
      const url = urlMatch ? urlMatch[1].trim() : `https://mock.example.com/${caseId.toLowerCase()}`;
      const location = locationMatch ? locationMatch[1].trim() : undefined;
      const salary = salaryMatch ? salaryMatch[1].trim() : undefined;

      // Extract basic tags from title and body
      const tagCandidates = [
        'TypeScript',
        'Node.js',
        'NestJS',
        'React',
        'PostgreSQL',
        'Redis',
        'Docker',
        'Kubernetes',
        'AWS',
        'GCP',
        'Python',
        'Java',
        'Go',
      ];
      const tags = tagCandidates.filter((t) => {
        const re = new RegExp(`\\b${t.replace('.', '\\.')}\\b`, 'i');
        return re.test(title) || re.test(body);
      });

      jobs.set(caseId, {
        id: `smoke-${caseId.toLowerCase()}`,
        title,
        company,
        location,
        salary,
        url,
        body,
        source: 'manual',
        tags,
        scrapedAt: new Date().toISOString(),
      });
    }
  } catch (err) {
    console.warn(`[cli] Could not parse smoke_dataset.yaml: ${(err as Error).message}`);
  }

  return jobs;
}

/**
 * Resolves job offer from command line argument, smoke dataset, object, or custom JSON/YAML file.
 */
export function loadMockJob(jobArg?: string | JobOffer | Record<string, unknown>): JobOffer {
  if (!jobArg) {
    return DEFAULT_MOCK_JOB;
  }

  if (typeof jobArg === 'object') {
    const obj = jobArg as Record<string, unknown>;
    const vars = (obj.vars && typeof obj.vars === 'object' ? obj.vars : obj) as Record<string, unknown>;
    return {
      id: (obj.id as string) || (vars.id as string) || 'provided-job',
      title: (vars.title as string) || (obj.title as string) || 'Provided Title',
      company: (vars.company as string) || (obj.company as string) || 'Provided Company',
      location: (vars.location as string) || (obj.location as string),
      salary: (vars.salary as string) || (obj.salary as string),
      url: (vars.url as string) || (obj.url as string) || 'https://example.com/job',
      body: (vars.body as string) || (obj.body as string) || '',
      source: ((vars.source as string) || (obj.source as string) || 'manual') as JobOffer['source'],
      tags: Array.isArray(vars.tags)
        ? (vars.tags as string[])
        : Array.isArray(obj.tags)
        ? (obj.tags as string[])
        : [],
      scrapedAt:
        (vars.scrapedAt as string) ||
        (obj.scrapedAt as string) ||
        new Date().toISOString(),
      ...(vars.email ? { email: vars.email as string } : {}),
      ...(vars.applyUrl ? { applyUrl: vars.applyUrl as string } : {}),
    } as JobOffer;
  }

  const cleanArg = String(jobArg).trim();

  // 1. Direct file resolution (JSON or YAML)
  if (fs.existsSync(cleanArg)) {
    try {
      const content = fs.readFileSync(cleanArg, 'utf-8');
      if (cleanArg.endsWith('.json')) {
        const parsed = JSON.parse(content);
        if (parsed.vars) {
          return {
            id: parsed.id || 'custom-json-job',
            title: parsed.vars.title || parsed.title || 'Custom Title',
            company: parsed.vars.company || parsed.company || 'Custom Company',
            location: parsed.vars.location || parsed.location,
            salary: parsed.vars.salary || parsed.salary,
            url: parsed.vars.url || parsed.url || 'https://example.com/job',
            body: parsed.vars.body || parsed.body || '',
            source: 'manual',
            tags: parsed.tags || [],
            scrapedAt: new Date().toISOString(),
          };
        }
        return {
          id: parsed.id || 'custom-json-job',
          title: parsed.title || 'Custom Title',
          company: parsed.company || 'Custom Company',
          location: parsed.location,
          salary: parsed.salary,
          url: parsed.url || 'https://example.com/job',
          body: parsed.body || '',
          source: parsed.source || 'manual',
          tags: parsed.tags || [],
          scrapedAt: parsed.scrapedAt || new Date().toISOString(),
        };
      }
    } catch (err) {
      console.warn(`[cli] Failed reading file at ${cleanArg}: ${(err as Error).message}`);
    }
  }

  // 2. Case ID resolution from smoke_dataset.yaml (e.g. T01, T02, E01, F08, F01, E05)
  const candidateSmokePaths = [
    path.resolve(process.cwd(), 'n8n/prompts/smoke_dataset.yaml'),
    path.resolve(process.cwd(), '../n8n/prompts/smoke_dataset.yaml'),
    path.resolve(__dirname, '../../../n8n/prompts/smoke_dataset.yaml'),
    path.resolve(__dirname, '../../n8n/prompts/smoke_dataset.yaml'),
  ];

  for (const smokePath of candidateSmokePaths) {
    if (fs.existsSync(smokePath)) {
      const smokeJobs = parseSmokeDataset(smokePath);
      const match = smokeJobs.get(cleanArg.toUpperCase());
      if (match) {
        return match;
      }
    }
  }

  // 3. If T02 requested but file not found or parse failed, return built-in DEFAULT_MOCK_JOB
  if (cleanArg.toUpperCase() === 'T02') {
    return DEFAULT_MOCK_JOB;
  }

  // 4. Fallback: Return DEFAULT_MOCK_JOB with warning
  console.warn(`[cli] Job target "${cleanArg}" not found in dataset or files; falling back to DEFAULT_MOCK_JOB.`);
  return DEFAULT_MOCK_JOB;
}

/**
 * Main application runner: coordinates generation of ATS CV, Cover Letter, and Email Package.
 */
export async function runCli(options: CliOptions = {}): Promise<CliRunResult> {
  const dryRun = options.dryRun !== undefined ? Boolean(options.dryRun) : true;
  if (!dryRun) {
    throw new Error('Live email sending is not yet implemented. Only --dry-run is currently supported.');
  }

  let target: 'all' | 'cv' | 'letter' = options.target || 'all';
  if (options.cvOnly) target = 'cv';
  if (options.letterOnly) target = 'letter';

  const job = loadMockJob(options.job);
  const companySlug = slugify(job.company);
  const jobSlug = slugify(job.title);
  const applicationSlug = `${companySlug}-${jobSlug}`;

  const baseOutDir = options.outputDir || options.outDir || 'output/applications';
  const applicationDir = path.resolve(process.cwd(), baseOutDir, applicationSlug);

  if (!fs.existsSync(applicationDir)) {
    fs.mkdirSync(applicationDir, { recursive: true });
  }

  console.log(`[cli] Running Application Generator in dry-run mode...`);
  console.log(`[cli] Target: ${target} | Company: ${job.company} | Role: ${job.title}`);
  console.log(`[cli] Output Directory: ${applicationDir}`);

  // 1. Load Candidate CV Data (100% offline fallback)
  const cvData: CandidateCvData = await loadCandidateCvData(true);

  // 2. Pre-rank bullets deterministically
  const ranked = preRankBullets(cvData.bullets, job.title, job.body, job.tags);
  const rankedIds = ranked.map((r) => r.bulletId);

  // 3. Assemble verbatim experience bullets from Master CV
  // Exclude metadata/stack-summary sections already represented in Professional Summary & Technical Skills
  const excludedCvSections = new Set([
    'Role & Summary',
    'Primary Stack',
    'Secondary Stack',
    'Target Role & Leadership',
    'Languages',
  ]);
  const experienceSourceBullets = cvData.bullets.filter(
    (b) => !excludedCvSections.has(b.section)
  );
  const effectiveSourceBullets =
    experienceSourceBullets.length > 0 ? experienceSourceBullets : cvData.bullets;

  const selectedBullets: CandidateBullet[] = assembleExperienceBullets(
    rankedIds,
    effectiveSourceBullets,
    { sortByCvOrder: true, fallbackToAllIfEmpty: true }
  );

  const artifacts: { cvPdf?: string; coverLetter?: string; emailPackage?: string } = {};
  const language = options.language || options.lang;

  // 4. Render ATS CV PDF
  if (target === 'all' || target === 'cv') {
    const pdfPath = path.join(applicationDir, 'cv.pdf');
    console.log(`[cli] Rendering ATS CV to vector PDF: ${pdfPath}...`);
    const cvResult: RenderCvResult = await renderCvToPdf(cvData, selectedBullets, {
      outputPath: pdfPath,
      language,
      pageLimit: options.pageLimit ?? 2,
    });
    artifacts.cvPdf = cvResult.pdfPath;
    console.log(`[cli] CV PDF rendered successfully (${cvResult.pageCount} page(s), ${cvResult.bufferSize} bytes).`);
  }

  // 5. Generate Tailored Cover Letter
  let letterResult: CoverLetterResult | undefined;
  if (target === 'all' || target === 'letter') {
    console.log(`[cli] Generating EU/Poland tailored Cover Letter...`);
    letterResult = generateCoverLetter(cvData, {
      job: {
        title: job.title,
        company: job.company,
        body: job.body,
        tags: job.tags,
      },
      language,
    });
    if (letterResult && !letterResult.isValid) {
      throw new Error(`Cover Letter validation failed: ${letterResult.validationErrors.join('; ')}`);
    }
    const letterPath = path.join(applicationDir, 'cover_letter.txt');
    fs.writeFileSync(letterPath, letterResult.text, 'utf-8');
    artifacts.coverLetter = letterPath;
    console.log(`[cli] Cover letter generated successfully (${letterResult.wordCount} words, language: ${letterResult.language}).`);
  }

  let emailPkg: EmailPackage | undefined;

  // 6. Build and Save Email Package Manifest
  if (target === 'all') {
    if (!artifacts.cvPdf || !letterResult) {
      throw new Error('Both CV PDF and Cover Letter are required to build the Email Package.');
    }

    console.log(`[cli] Assembling Email Apply package manifest...`);
    const emailJobInput = {
      title: job.title,
      company: job.company,
      email: (job as any).email,
      applyUrl: (job as any).applyUrl || job.url,
      url: job.url,
    };

    emailPkg = buildEmailPackage({
      job: emailJobInput,
      coverLetter: letterResult.text,
      pdfPath: artifacts.cvPdf,
      dryRun: true,
      candidateName: options.candidateName,
      fallbackEmail: options.fallbackEmail,
      validateAttachmentExists: options.validateAttachmentExists !== false,
    });

    const manifestPath = saveEmailPackage(emailPkg, applicationDir, DEFAULT_MANIFEST_FILENAME);
    artifacts.emailPackage = manifestPath;
    console.log(`[cli] Email package saved to manifest: ${manifestPath}`);
  }

  console.log(`[cli] Dry-run completed successfully with 0 network calls.`);

  return {
    success: true,
    company: job.company,
    jobTitle: job.title,
    applicationDir,
    artifacts,
    pdfPath: artifacts.cvPdf,
    coverLetterPath: artifacts.coverLetter,
    manifestPath: artifacts.emailPackage,
    emailPackagePath: artifacts.emailPackage,
    emailPackage: emailPkg,
  };
}

/**
 * Alias for runCli conforming to pipeline terminology
 */
export const runApplicationPipeline = runCli;

/**
 * Parses raw CLI arguments into CliOptions
 */
export function parseCliArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    dryRun: true,
    target: 'all',
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--no-dry-run') {
      options.dryRun = false;
    } else if (arg === '--cv-only' || arg === '--cv') {
      options.target = 'cv';
      options.cvOnly = true;
    } else if (arg === '--letter-only' || arg === '--letter') {
      options.target = 'letter';
      options.letterOnly = true;
    } else if (arg.startsWith('--target=')) {
      options.target = arg.split('=')[1] as 'all' | 'cv' | 'letter';
    } else if (arg === '--target' && i + 1 < args.length) {
      options.target = args[++i] as 'all' | 'cv' | 'letter';
    } else if (arg.startsWith('--job=')) {
      options.job = arg.split('=')[1];
    } else if (arg === '--job' && i + 1 < args.length) {
      options.job = args[++i];
    } else if (arg.startsWith('--lang=')) {
      options.lang = arg.split('=')[1] as 'en' | 'pl';
    } else if (arg === '--lang' && i + 1 < args.length) {
      options.lang = args[++i] as 'en' | 'pl';
    } else if (arg.startsWith('--outDir=')) {
      options.outDir = arg.split('=')[1];
    } else if (arg === '--outDir' && i + 1 < args.length) {
      options.outDir = args[++i];
    } else if (arg.startsWith('--outputDir=')) {
      options.outputDir = arg.split('=')[1];
    } else if (arg === '--outputDir' && i + 1 < args.length) {
      options.outputDir = args[++i];
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`
Personalized Application Generator CLI (Milestone M4)
Usage:
  npx ts-node src/generator/cli.ts [options]

Options:
  --dry-run             Run in offline dry-run mode (default: true)
  --job <id|path>       Mock case ID (e.g. T02, E01) or path to job JSON/YAML
  --lang <en|pl>        Language override for CV and Cover Letter
  --outDir <path>       Output base directory (default: output/applications)
  --target <type>       Generation target: all | cv | letter (default: all)
  --cv-only             Shortcut for --target cv
  --letter-only         Shortcut for --target letter
  -h, --help            Show this help message
`);
}

// Standalone execution entrypoint
if (require.main === module) {
  const parsed = parseCliArgs(process.argv.slice(2));
  runCli(parsed)
    .then((result) => {
      console.log(`[cli] Completed successfully. Artifacts:`, result.artifacts);
      process.exit(0);
    })
    .catch((err) => {
      console.error(`[cli] Error executing application generator:`, err);
      process.exit(1);
    });
}
