import * as fs from 'fs';
import * as path from 'path';
import {
  CandidateCvData,
  CANONICAL_SKILLS_CATEGORIES,
  FORBIDDEN_STOP_WORDS,
  FORBIDDEN_OPENING_CLICHES,
} from './test-contracts';

/**
 * Dynamically resolves and loads a generator module from scraper/src/generator/
 * Returns null if the module has not been implemented yet.
 */
export function loadGeneratorModule<T = any>(moduleName: string): T | null {
  const possiblePaths = [
    path.resolve(__dirname, `../../src/generator/${moduleName}.ts`),
    path.resolve(__dirname, `../../src/generator/${moduleName}.js`),
    path.resolve(__dirname, `../../src/generator/${moduleName}/index.ts`),
    path.resolve(__dirname, `../../src/generator/${moduleName}/index.js`),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      try {
        return require(p);
      } catch (err) {
        // If compilation/syntax error, rethrow so developer knows
        throw err;
      }
    }
  }

  return null;
}

/**
 * Asserts that a generator module is available, throwing an informative error if missing.
 */
export function requireGeneratorModule<T = any>(moduleName: string): T {
  const mod = loadGeneratorModule<T>(moduleName);
  if (!mod) {
    throw new Error(
      `[Not Implemented] Generator module 'scraper/src/generator/${moduleName}' was not found. ` +
        `This milestone feature needs to be implemented.`
    );
  }
  return mod;
}

/**
 * Canonical test candidate CV fixture matching Notion schema
 */
export const mockCandidateCvData: CandidateCvData = {
  contacts: {
    name: 'Darya Shashko',
    location: 'Gdańsk, Poland',
    phone: '+48 500 000 000',
    email: 'darya.shashko@example.com',
    linkedIn: 'https://linkedin.com/in/daryashashko',
    github: 'https://github.com/daryashashko',
  },
  summary:
    'Senior Full-Stack Engineer with 8+ years building high-throughput distributed systems, scalable web applications, and GenAI-integrated pipelines. Specialized in TypeScript, React, Node.js, and cloud native architectures.',
  bullets: [
    {
      id: 'bullet-arch-microservices',
      title: 'Senior Full-Stack Engineer',
      section: 'Work Experience',
      highlight:
        'Architected and deployed microservices handling 25M daily requests with Node.js and TypeScript, reducing p99 latency by 35% through Redis caching and query optimization.',
      tags: ['TypeScript', 'Node.js', 'Redis', 'Architecture', 'Microservices', 'Performance'],
      period: '2023 - Present',
      order: 1,
    },
    {
      id: 'bullet-genai-rag',
      title: 'Senior Full-Stack Engineer',
      section: 'Work Experience',
      highlight:
        'Engineered an enterprise GenAI document analysis assistant utilizing LangChain and vector databases, cutting manual review time by 60% for 5,000+ monthly active users.',
      tags: ['AI Tooling', 'GenAI', 'LLM', 'Python', 'TypeScript', 'Vector DB'],
      period: '2023 - Present',
      order: 2,
    },
    {
      id: 'bullet-frontend-nextjs',
      title: 'Full-Stack Developer',
      section: 'Work Experience',
      highlight:
        'Led migration of legacy monolith to Next.js and React 18 frontend, boosting Core Web Vitals to 98+ and improving conversion rate by 18%.',
      tags: ['React', 'Next.js', 'TypeScript', 'Frontend', 'Web Performance'],
      period: '2021 - 2023',
      order: 3,
    },
    {
      id: 'bullet-database-postgres',
      title: 'Full-Stack Developer',
      section: 'Work Experience',
      highlight:
        'Redesigned relational schemas in PostgreSQL with partitioning and composite indexes, decreasing batch processing time from 4 hours to 45 minutes.',
      tags: ['PostgreSQL', 'SQL', 'Databases', 'Optimization'],
      period: '2021 - 2023',
      order: 4,
    },
    {
      id: 'bullet-ci-cd-docker',
      title: 'Software Engineer',
      section: 'Work Experience',
      highlight:
        'Built automated CI/CD deployment pipelines using Docker, Kubernetes, and GitHub Actions, shortening release cycle from bi-weekly to multiple times daily.',
      tags: ['Docker', 'Kubernetes', 'CI/CD', 'DevOps', 'GitHub Actions'],
      period: '2019 - 2021',
      order: 5,
    },
    {
      id: 'bullet-testing-e2e',
      title: 'Software Engineer',
      section: 'Work Experience',
      highlight:
        'Implemented comprehensive automated test suites with Jest and Playwright achieving 92% code coverage, preventing 40+ critical production regressions annually.',
      tags: ['Testing & Quality', 'Jest', 'Playwright', 'E2E Testing'],
      period: '2019 - 2021',
      order: 6,
    },
  ],
  skills: {
    'Core Languages & Frameworks': ['TypeScript', 'JavaScript (ES2022+)', 'Node.js', 'React', 'Next.js', 'NestJS'],
    'State & Databases': ['PostgreSQL', 'Redis', 'Prisma', 'MongoDB'],
    'Architecture & Infra': ['Microservices', 'Docker', 'Kubernetes', 'AWS', 'CI/CD', 'GitHub Actions'],
    'Testing & Quality': ['Jest', 'Playwright', 'TDD', 'Contract Testing'],
    'AI Tooling & Productivity': ['GenAI', 'LLM APIs', 'LangChain', 'Prompt Engineering'],
  },
  rodoClause: {
    pl: 'Wyrażam zgodę na przetwarzanie moich danych osobowych dla potrzeb niezbędnych do realizacji procesu rekrutacji zgodnie z Rozporządzeniem Parlamentu Europejskiego i Rady (UE) 2016/679 z dnia 27 kwietnia 2016 r. (RODO).',
    en: 'I agree to the processing of personal data provided in this document for realising the recruitment process in accordance with the GDPR (Regulation (EU) 2016/679 of the European Parliament and of the Council).',
  },
};

/**
 * Mock job offer fixtures for testing
 */
export const mockJobOffers = {
  fullstackSenior: {
    title: 'Senior Full-Stack Engineer',
    company: 'FinTech Innovations Sp. z o.o.',
    body: 'We are seeking a Senior Full-Stack Engineer to scale our payment processing platform. You will design resilient distributed microservices, optimize PostgreSQL queries, and integrate cutting-edge AI features. Required: TypeScript, Node.js, React, PostgreSQL, Docker, AWS.',
    tags: ['TypeScript', 'Node.js', 'React', 'PostgreSQL', 'Docker', 'AWS', 'Microservices'],
    email: 'careers@fintechinnovations.example.com',
  },
  frontendReact: {
    title: 'Lead Frontend Developer',
    company: 'NextGen SaaS',
    body: 'Looking for a Lead Frontend Engineer to drive modern web applications using React, Next.js, and TypeScript. Experience with Core Web Vitals and design systems is required.',
    tags: ['React', 'Next.js', 'TypeScript', 'Frontend', 'Web Performance'],
    email: 'jobs@nextgensaas.example.com',
  },
  polishBackend: {
    title: 'Starszy Inżynier Backend (Node.js / PostgreSQL)',
    company: 'Polskie Systemy Chmurowe S.A.',
    body: 'Poszukujemy doświadczonego programisty backendowego do budowy systemów rozproszonych w oparciu o Node.js i PostgreSQL. Wymagania: znajomość TypeScript, Docker, mikroserwisy oraz język polski w mowie i piśmie.',
    tags: ['Node.js', 'TypeScript', 'PostgreSQL', 'Docker', 'Backend'],
    email: 'rekrutacja@chmura.pl',
  },
  minimalVacancy: {
    title: 'Software Developer',
    company: 'Startup Lab',
    body: 'General software developer position.',
    tags: [],
  },
};

/**
 * Counts words by whitespace tokens
 */
export function countWords(text: string): number {
  if (!text || text.trim() === '') return 0;
  return text.trim().split(/\s+/).length;
}

/**
 * Scans text for any of the 10 forbidden stop words
 */
export function findForbiddenStopWords(text: string): string[] {
  const found: string[] = [];
  const lower = text.toLowerCase();
  for (const stopWord of FORBIDDEN_STOP_WORDS) {
    // Check whole word or phrase boundary
    const regex = new RegExp(`\\b${stopWord.replace(/\s+/g, '\\s+')}\\b`, 'i');
    if (regex.test(lower)) {
      found.push(stopWord);
    }
  }
  return found;
}

/**
 * Scans text for forbidden opening clichés
 */
export function findForbiddenClichés(text: string): string[] {
  const found: string[] = [];
  const lower = text.toLowerCase();
  for (const cliché of FORBIDDEN_OPENING_CLICHES) {
    if (lower.includes(cliché.toLowerCase())) {
      found.push(cliché);
    }
  }
  return found;
}

/**
 * Inspects binary PDF structure without external dependencies
 */
export interface PdfInspectionResult {
  isPdf: boolean;
  version: string;
  pageCount: number;
  hasVectorText: boolean;
  links: string[];
}

export function inspectPdf(pdfBuffer: Buffer): PdfInspectionResult {
  const header = pdfBuffer.slice(0, 10).toString('utf-8');
  const isPdf = header.startsWith('%PDF-');
  const versionMatch = header.match(/%PDF-([0-9.]+)/);
  const version = versionMatch ? versionMatch[1] : '';

  const raw = pdfBuffer.toString('latin1');

  // Count /Type /Page objects (excluding /Pages catalog)
  // Matching /Type\s*\/Page\b but not /Pages
  const pageMatches = raw.match(/\/Type\s*\/Page\b(?!\s*s)/g) || [];
  let pageCount = pageMatches.length;

  // Fallback: look for /Count in /Pages dictionary if individual pages are grouped
  if (pageCount === 0) {
    const countMatch = raw.match(/\/Type\s*\/Pages[\s\S]*?\/Count\s+(\d+)/);
    if (countMatch) {
      pageCount = parseInt(countMatch[1], 10);
    }
  }

  // Check for vector text (BT ... ET text objects or stream contents)
  const hasVectorText = /\bBT\b[\s\S]*?\bET\b/.test(raw) || /\/Font\b/.test(raw);

  // Extract URI links from Annotations
  const links: string[] = [];
  const uriMatches = raw.matchAll(/\/URI\s*\(([^)]+)\)/g);
  for (const m of uriMatches) {
    links.push(m[1]);
  }

  return {
    isPdf,
    version,
    pageCount,
    hasVectorText,
    links,
  };
}

/**
 * Helper to manage temporary test directories
 */
export function createTempTestDir(prefix: string): string {
  const dir = path.resolve(__dirname, `../../output/tmp_${prefix}_${Date.now()}`);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function removeTempTestDir(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
