/**
 * Notion Candidate Data Loader with 100% Offline Fallback.
 * Location: scraper/src/generator/notion-loader.ts
 *
 * Responsibilities:
 * 1. Queries Notion Live API (`Candidate CV & Experience` database) when online.
 * 2. Falls back seamlessly to `.notion-snapshot.json` if present.
 * 3. Falls back 100% deterministically to `DEFAULT_CANDIDATE_CV_DATA` seed in offline / test environments.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  CandidateBullet,
  CandidateContacts,
  CandidateCvData,
  NotionLoaderOptions,
  RawCvEntrySnapshot,
  RodoClause,
} from './types';

// ── Default Contacts ────────────────────────────────────────────────────────

export const DEFAULT_CANDIDATE_CONTACTS: CandidateContacts = {
  name: process.env.CANDIDATE_NAME || 'Darya Shashko',
  location: process.env.CANDIDATE_LOCATION || 'Gdańsk, Poland',
  phone: process.env.CANDIDATE_PHONE || '+48 573 707 501',
  email: process.env.CANDIDATE_EMAIL || 'shashko.darya@gmail.com',
  linkedIn: process.env.CANDIDATE_LINKEDIN || 'https://linkedin.com/in/darya-shashko',
  github: process.env.CANDIDATE_GITHUB || 'https://github.com/daryashashko',
};

export const DEFAULT_CONTACTS = DEFAULT_CANDIDATE_CONTACTS;

// ── Default RODO Clause (PL & EN) ───────────────────────────────────────────

export const DEFAULT_RODO_CLAUSE: RodoClause = {
  pl: 'Wyrażam zgodę na przetwarzanie moich danych osobowych dla potrzeb niezbędnych do realizacji procesu rekrutacji (zgodnie z ustawą z dnia 10 maja 2018 roku o ochronie danych osobowych (Dz. Ustaw z 2018, poz. 1000) oraz zgodnie z Rozporządzeniem Parlamentu Europejskiego i Rady (UE) 2016/679 z dnia 27 kwietnia 2016 r. w sprawie ochrony osób fizycznych w związku z przetwarzaniem danych osobowych i w sprawie swobodnego przepływu takich danych oraz uchylenia dyrektywy 95/46/WE (RODO)).',
  en: 'I hereby give consent for my personal data included in my application to be processed for the purposes of the recruitment process in accordance with Regulation (EU) 2016/679 of the European Parliament and of the Council of 27 April 2016 (GDPR).',
};

export const RODO_CLAUSES = DEFAULT_RODO_CLAUSE;

// ── Default 5-Category Skills Matrix ────────────────────────────────────────

export const DEFAULT_SKILLS_MATRIX: Record<string, string[]> = {
  'Core Languages & Frameworks': [
    'TypeScript',
    'JavaScript',
    'Node.js',
    'React',
    'Next.js',
    'NestJS',
    'Python',
  ],
  'State & Databases': [
    'PostgreSQL',
    'MySQL',
    'Redis',
    'MongoDB',
    'Redux',
  ],
  'Architecture & Infra': [
    'Docker',
    'REST APIs',
    'Microfrontends',
    'AWS',
    'CI/CD',
    'Azure DevOps',
    'Firebase',
    'Microservices',
  ],
  'Testing & Quality': [
    'Jest',
    'Playwright',
    'Promptfoo',
    'TDD',
    'WCAG (a11y)',
  ],
  'AI Tooling & Productivity': [
    'GenAI',
    'Cursor',
    'Claude Code',
    'GitHub Copilot',
    'LLM Evaluation',
    'n8n',
  ],
};

// ── Canonical Slugs Mapping by Order ────────────────────────────────────────

export const CV_SLUGS: Record<number, string> = {
  1: 'cv-role-summary',
  2: 'cv-recent-6m',
  3: 'cv-primary-stack',
  4: 'cv-secondary-stack',
  5: 'cv-ai-tools',
  6: 'cv-languages',
  7: 'cv-target-balance',
  8: 'cv-leadership',
  9: 'cv-ach-migration',
  10: 'cv-ach-cost',
  11: 'cv-ach-lead',
  12: 'cv-ach-mobile',
};

// ── Default Master CV Bullets (Seed Rows from Notion DB) ─────────────────────

export const DEFAULT_CV_BULLETS: CandidateBullet[] = [
  {
    id: 'cv-role-summary',
    slug: 'cv-role-summary',
    title: 'Senior Full-Stack & Product Engineer | Tech Stream Lead',
    section: 'Role & Summary',
    order: 1,
    highlight:
      'Senior Full-Stack & Product Engineer with 10 years of commercial experience in the JS/TS ecosystem, combining deep React/Next.js frontend expertise with scalable Node.js/NestJS and Python backend delivery. Proven track record of leading technical streams (up to 6 engineers), driving Frontend-to-Full-Stack team transitions, and executing complex legacy migrations (Java/MySQL to Node.js/PostgreSQL). Experienced in AI-native product engineering, multi-agent development workflows, and resolving critical stakeholder escalations through structured architecture and shared UI systems.',
    tags: ['TypeScript', 'React', 'Node.js', 'Next.js', 'NestJS', 'Python', 'Architecture'],
    period: 'Core Profile',
  },
  {
    id: 'cv-recent-6m',
    slug: 'cv-recent-6m',
    title: 'FinTech Investment Platform / EPAM Systems — Senior Product Engineer & UI Stream Lead',
    section: 'Recent Experience (Last 6m)',
    order: 2,
    highlight:
      'Operate as a Product / Forward-Deployed Engineer on an AI-integrated investment platform (TypeScript, React, Python, AI stack), owning ambiguous feature scopes end-to-end from direct customer discovery to production release. Stepped in to lead a 6-engineer technical stream following a critical customer design-alignment escalation; partnered with the Chief Designer to architect and deliver a Shared UI Component Library that unblocked parallel feature teams, while leading backlog slicing, refinement, and sprint demos.',
    tags: ['TypeScript', 'React', 'Python', 'Node.js', 'GenAI', 'Team Lead', 'Architecture'],
    period: 'July 2026 – Present',
  },
  {
    id: 'cv-primary-stack',
    slug: 'cv-primary-stack',
    title: 'Primary Tech Stack',
    section: 'Primary Stack',
    order: 3,
    highlight:
      'JavaScript, TypeScript, React, Next.js, Node.js, NestJS, PostgreSQL, Python (working knowledge), HTML5, CSS3, SCSS.',
    tags: ['JavaScript', 'TypeScript', 'React', 'Next.js', 'Node.js', 'NestJS', 'PostgreSQL', 'Python'],
    period: 'Daily Production',
  },
  {
    id: 'cv-secondary-stack',
    slug: 'cv-secondary-stack',
    title: 'Secondary Stack & Cloud Familiarity',
    section: 'Secondary Stack',
    order: 4,
    highlight:
      'Docker, REST APIs, Microfrontends, AWS, Azure DevOps, CI/CD (GitHub Actions, Jenkins, Bamboo), Firebase, Redis, MongoDB, MySQL, Redux.',
    tags: ['Docker', 'REST API', 'AWS', 'Azure DevOps', 'CI/CD', 'Redis', 'MongoDB', 'MySQL'],
    period: 'Working Knowledge',
  },
  {
    id: 'cv-ai-tools',
    slug: 'cv-ai-tools',
    title: 'Independent AI R&D — Autonomous Job Market Intelligence & LLM Evaluation Platform',
    section: 'AI & Tools',
    order: 5,
    highlight:
      'Architected an end-to-end TypeScript and Node.js data ingestion and LLM evaluation pipeline using Playwright, Notion REST API, n8n, and Promptfoo over a curated Golden Dataset, governed by a spec-driven multi-agent development workflow (Claude Code, Cursor, GitHub Copilot) with deterministic pre-ranking guardrails.',
    tags: ['TypeScript', 'Node.js', 'Playwright', 'Promptfoo', 'LLM Evaluation', 'GenAI', 'Cursor', 'GitHub Copilot', 'n8n'],
    period: '2026',
  },
  {
    id: 'cv-languages',
    slug: 'cv-languages',
    title: 'Spoken Languages (EN / RU / PL)',
    section: 'Languages',
    order: 6,
    highlight:
      'English: Professional (fluent reading/writing, professional speaking). Russian: Native. Polish: Intermediate (job postings in Polish are acceptable, but fluent spoken Polish must NOT be a hard requirement).',
    tags: ['English B2/C1', 'Russian Native', 'Polish B1'],
    period: 'Current',
  },
  {
    id: 'cv-target-balance',
    slug: 'cv-target-balance',
    title: 'Core Full-Stack Balance (FE / BE Ratio)',
    section: 'Target Role & Leadership',
    order: 7,
    highlight:
      'Ideal role is Full-Stack (50/50 to 70/30 in favor of Frontend), Product Engineer, or Node.js/TS Backend-heavy where Senior JS/TS skills apply. Leverage elite Frontend & UI architecture expertise while actively contributing to Node.js/NestJS/Python backend & AI engineering.',
    tags: ['Full-Stack', 'Frontend', 'Backend', 'Node.js', 'React'],
    period: 'Target Role',
  },
  {
    id: 'cv-leadership',
    slug: 'cv-leadership',
    title: 'Leadership, Management & Hands-On Ratio (Tech Lead / Team Lead)',
    section: 'Target Role & Leadership',
    order: 8,
    highlight:
      'Strong communication and stakeholder management skills; actively leads technical streams (up to 6 engineers), customer demos, and escalations (Tech Lead / Team Lead / Product Engineer roles). Preferred hands-on coding ratio is 50% to 70% (NO 100% people management without coding, and NO zero-impact pure coder role).',
    tags: ['Tech Lead', 'Team Lead', 'Architecture', 'Mentoring'],
    period: 'Target Role',
  },
  {
    id: 'cv-ach-migration',
    slug: 'cv-ach-migration',
    title: 'J&J / EPAM Systems — Key Full-Stack Engineer',
    section: 'Key Achievement',
    order: 9,
    highlight:
      'Transitioned to a Full-Stack role and led the high-impact migration of core platform functionality from a legacy Java backend to Node.js alongside a database migration from MySQL to PostgreSQL, preceded by deep legacy codebase investigation and architectural refactoring. Designed and drove the team-wide workflow for transitioning Frontend engineers into Full-Stack development.',
    tags: ['TypeScript', 'Node.js', 'React', 'PostgreSQL', 'MySQL', 'Java Migration', 'Backend', 'Architecture'],
    period: 'September 2022 – July 2026',
  },
  {
    id: 'cv-ach-cost',
    slug: 'cv-ach-cost',
    title: 'J&J / EPAM Systems — Key Full-Stack Engineer',
    section: 'Key Achievement',
    order: 10,
    highlight:
      "Acted as the primary Knowledge Keeper and technical consultant for the platform's charting and analytics service, driving sprint scoping, backlog refinement, and multi-stage technical estimations (50% / 80% / 100% confidence gates). Introduced Clean Code documentation and integrated custom AI agents trained on project standards to assist the engineering team.",
    tags: ['TypeScript', 'React', 'Node.js', 'Architecture', 'GenAI', 'Mentoring', 'GitHub Copilot'],
    period: 'September 2022 – July 2026',
  },
  {
    id: 'cv-ach-lead',
    slug: 'cv-ach-lead',
    title: 'Wolters Kluwer / EPAM Systems — Senior Frontend Engineer',
    section: 'Key Achievement',
    order: 11,
    highlight:
      'Engineered scalable product features using React and Redux within a complex enterprise microfrontend architecture, proposed and integrated a standardized Prettier/ESLint configuration adopted company-wide, mentored junior developers, and resolved technical debt across legacy AngularJS/React modules with WCAG a11y compliance.',
    tags: ['React', 'TypeScript', 'JavaScript', 'Frontend', 'Architecture', 'Mentoring'],
    period: 'October 2021 – September 2022',
  },
  {
    id: 'cv-ach-mobile',
    slug: 'cv-ach-mobile',
    title: 'MIS-Clinic / EPAM Systems — Frontend Team Lead & Resource Manager',
    section: 'Key Achievement',
    order: 12,
    highlight:
      "Managed a team of 4 frontend developers (conducting performance reviews, technical interviews, onboarding, and guiding Middle-to-Senior transitions), designed greenfield project architecture from scratch, configured CI/CD pipelines in Jenkins with Firebase widget deployment, and previously delivered Belarus's first React Native mobile medical app (Aibolit, 2018–2019) and custom component libraries (SAP, 2016–2018).",
    tags: ['Team Lead', 'Architecture', 'React', 'React Native', 'CI/CD', 'Firebase', 'HealthTech', 'Mentoring'],
    period: 'February 2019 – October 2021',
  },
];

export const DEFAULT_FALLBACK_BULLETS = DEFAULT_CV_BULLETS;

// ── Default Complete Candidate CV Data ──────────────────────────────────────

export const DEFAULT_CANDIDATE_CV_DATA: CandidateCvData = {
  contacts: DEFAULT_CANDIDATE_CONTACTS,
  summary:
    'Senior Full-Stack & Product Engineer with 10 years of commercial experience in the JS/TS ecosystem, combining deep React/Next.js frontend expertise with scalable Node.js/NestJS and Python backend delivery. Proven track record of leading technical streams (up to 6 engineers), driving Frontend-to-Full-Stack team transitions, and executing complex legacy migrations (Java/MySQL to Node.js/PostgreSQL). Experienced in AI-native product engineering, multi-agent development workflows, and resolving critical stakeholder escalations through structured architecture and shared UI systems. Based in Gdańsk, Poland; eligible for B2B JDG / UoP.',
  bullets: DEFAULT_CV_BULLETS,
  skills: DEFAULT_SKILLS_MATRIX,
  rodoClause: DEFAULT_RODO_CLAUSE,
};

// ── Helper: Find Bullet By ID or Slug ───────────────────────────────────────

export function findBulletByIdOrSlug(
  bullets: CandidateBullet[],
  idOrSlug: string
): CandidateBullet | undefined {
  return bullets.find((b) => b.id === idOrSlug || b.slug === idOrSlug);
}

// ── Notion Live API Query Helpers ───────────────────────────────────────────

const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

interface NotionQueryRow {
  id: string;
  properties?: Record<string, unknown>;
}

interface NotionQueryResponse {
  results?: NotionQueryRow[];
  has_more?: boolean;
}

function extractTitle(prop: unknown): string {
  const arr = (prop as { title?: Array<{ plain_text?: string }> } | undefined)?.title;
  return Array.isArray(arr) ? arr.map((t) => t.plain_text ?? '').join('') : '';
}

function extractRichText(prop: unknown): string {
  const arr = (prop as { rich_text?: Array<{ plain_text?: string }> } | undefined)?.rich_text;
  return Array.isArray(arr) ? arr.map((t) => t.plain_text ?? '').join('') : '';
}

function extractSelect(prop: unknown, fallback: string): string {
  return (prop as { select?: { name?: string } } | undefined)?.select?.name ?? fallback;
}

function extractMultiSelect(prop: unknown): string[] {
  const arr = (prop as { multi_select?: Array<{ name?: string }> } | undefined)?.multi_select;
  return Array.isArray(arr) ? arr.map((x) => x.name ?? '').filter(Boolean) : [];
}

function extractNumber(prop: unknown, fallback: number): number {
  const n = (prop as { number?: number | null } | undefined)?.number;
  return typeof n === 'number' ? n : fallback;
}

/**
 * Fetch active rows directly from the Notion Candidate CV database.
 */
export async function fetchNotionCandidateData(
  token: string,
  cvDbId: string,
  fetchImpl?: typeof fetch
): Promise<CandidateCvData> {
  const fetchFn = fetchImpl ?? fetch;
  const cleanDbId = cvDbId.replace(/-/g, '').trim();

  const response = await fetchFn(`${NOTION_API_BASE}/databases/${cleanDbId}/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filter: {
        property: 'Active',
        checkbox: { equals: true },
      },
      sorts: [{ property: 'Order', direction: 'ascending' }],
      page_size: 100,
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Notion API query failed (${response.status}): ${errText.slice(0, 200)}`);
  }

  const queryData = (await response.json()) as NotionQueryResponse;
  const rows = queryData.results ?? [];
  if (rows.length === 0) {
    throw new Error('Notion CV query returned 0 active rows');
  }

  const bullets: CandidateBullet[] = rows.map((row, idx) => {
    const p = row.properties ?? {};
    const order = extractNumber(p['Order'], idx + 1);
    const slug = CV_SLUGS[order];
    return {
      id: row.id,
      slug,
      title: extractTitle(p['Title']),
      section: extractSelect(p['Section'], 'Role & Summary'),
      highlight: extractRichText(p['Highlight / Summary']),
      tags: extractMultiSelect(p['Tech Tags']),
      period: extractRichText(p['Period']),
      order,
    };
  });

  const summaryRow = bullets.find((b) => b.section === 'Role & Summary');
  const rawSummary = summaryRow?.highlight || '';
  const summary =
    rawSummary && !/strictly\s+no\s+junior/i.test(rawSummary)
      ? rawSummary
      : DEFAULT_CANDIDATE_CV_DATA.summary;

  return {
    contacts: DEFAULT_CANDIDATE_CONTACTS,
    summary,
    bullets,
    skills: DEFAULT_SKILLS_MATRIX,
    rodoClause: DEFAULT_RODO_CLAUSE,
  };
}

// ── Snapshot Normalization & Loading ────────────────────────────────────────

export function normalizeSnapshotData(parsed: unknown): CandidateCvData | null {
  if (!parsed || typeof parsed !== 'object') return null;

  const candidate = parsed as Partial<CandidateCvData> & {
    cvEntries?: RawCvEntrySnapshot[];
  };

  // Case A: Directly valid CandidateCvData object with bullets array
  if (Array.isArray(candidate.bullets)) {
    const validBullets = candidate.bullets.filter(
      (b): b is CandidateBullet => Boolean(b && typeof b === 'object')
    );
    if (validBullets.length > 0) {
      return {
        contacts: { ...DEFAULT_CANDIDATE_CONTACTS, ...candidate.contacts },
        summary: candidate.summary || DEFAULT_CANDIDATE_CV_DATA.summary,
        bullets: validBullets.map((b, idx) => {
          const order = typeof b.order === 'number' ? b.order : idx + 1;
          const slug = b.slug || CV_SLUGS[order];
          return {
            id: b.id || slug || `bullet-${idx + 1}`,
            slug,
            title: b.title || '',
            section: b.section || 'Experience',
            highlight: b.highlight || '',
            tags: Array.isArray(b.tags) ? b.tags : [],
            period: b.period,
            order,
          };
        }),
        skills: candidate.skills || DEFAULT_SKILLS_MATRIX,
        rodoClause: { ...DEFAULT_RODO_CLAUSE, ...candidate.rodoClause },
      };
    }
  }

  // Case B: Array of CvEntry / RawCvEntrySnapshot (from .notion-snapshot.json or raw array)
  const entries: RawCvEntrySnapshot[] = Array.isArray(parsed)
    ? (parsed as RawCvEntrySnapshot[])
    : Array.isArray(candidate.cvEntries)
    ? candidate.cvEntries
    : [];

  if (entries.length > 0) {
    const activeEntries = entries
      .filter((e) => e.active !== false)
      .sort((a, b) => (a.order || 0) - (b.order || 0));

    const bullets: CandidateBullet[] = activeEntries.map((e, idx) => {
      const order = typeof e.order === 'number' ? e.order : idx + 1;
      const slug = CV_SLUGS[order];
      return {
        id: e.id || slug || `entry-${idx + 1}`,
        slug,
        title: e.title || '',
        section: e.section || 'Experience',
        highlight: e.highlight || '',
        tags: Array.isArray(e.tags) ? e.tags : [],
        period: e.period,
        order,
      };
    });

    const summaryEntry = activeEntries.find((e) => e.section === 'Role & Summary');
    const rawSummary = summaryEntry?.highlight || '';
    const summary =
      rawSummary && !/strictly\s+no\s+junior/i.test(rawSummary)
        ? rawSummary
        : DEFAULT_CANDIDATE_CV_DATA.summary;

    return {
      contacts: DEFAULT_CANDIDATE_CONTACTS,
      summary,
      bullets,
      skills: DEFAULT_SKILLS_MATRIX,
      rodoClause: DEFAULT_RODO_CLAUSE,
    };
  }

  return null;
}

// ── Main Entrypoint: loadCandidateCvData ─────────────────────────────────────

/**
 * Load Candidate CV Data preserving Notion as the sole source of truth,
 * with graceful offline fallback to local snapshot and built-in seed dataset.
 *
 * @param offlineOnly - If true, skips network requests to Notion entirely.
 * @param options - Optional loader configuration (custom tokens, DB IDs, snapshot path).
 */
export async function loadCandidateCvData(
  offlineOnly = false,
  options?: NotionLoaderOptions
): Promise<CandidateCvData> {
  // 1. Live Notion Fetch (if enabled and credentials provided)
  if (!offlineOnly) {
    const token = (options?.notionToken || process.env.NOTION_TOKEN || '').trim();
    const cvDbId = (
      options?.cvDbId ||
      process.env.NOTION_CV_DB_ID ||
      process.env.NOTION_DB_ID ||
      ''
    ).trim();

    if (token && cvDbId) {
      try {
        const liveData = await fetchNotionCandidateData(token, cvDbId, options?.fetchImpl);
        if (liveData && liveData.bullets.length > 0) {
          return liveData;
        }
      } catch (err) {
        console.warn(
          `[notion-loader] Live Notion API unavailable (${(err as Error).message}); falling back to local snapshot/seed.`
        );
      }
    }
  }

  // 2. Local Snapshot Resolution
  const candidateSnapshotPaths: string[] = [
    options?.snapshotPath,
    path.resolve(process.cwd(), 'n8n/prompts/.notion-snapshot.json'),
    path.resolve(process.cwd(), '.notion-snapshot.json'),
    path.resolve(__dirname, '../../../n8n/prompts/.notion-snapshot.json'),
    path.resolve(__dirname, '../../n8n/prompts/.notion-snapshot.json'),
    path.resolve(__dirname, '../../.notion-snapshot.json'),
  ].filter(Boolean) as string[];

  for (const snapshotPath of candidateSnapshotPaths) {
    if (fs.existsSync(snapshotPath)) {
      try {
        const fileContent = fs.readFileSync(snapshotPath, 'utf-8');
        const parsed = JSON.parse(fileContent);
        const validated = normalizeSnapshotData(parsed);
        if (validated && validated.bullets.length > 0) {
          return JSON.parse(JSON.stringify(validated));
        }
      } catch (err) {
        console.warn(
          `[notion-loader] Failed to read snapshot at ${snapshotPath}: ${(err as Error).message}`
        );
      }
    }
  }

  // 3. Guaranteed 100% Offline Seed Fallback
  return JSON.parse(JSON.stringify(DEFAULT_CANDIDATE_CV_DATA));
}
