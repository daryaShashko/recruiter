/**
 * 5-Category Skills Matrix Formatter (Zero Graphs / Zero Tables).
 * Location: scraper/src/generator/skills-matrix.ts
 *
 * Responsibilities:
 * 1. Categorizes candidate technologies into strictly 5 canonical categories.
 * 2. Normalizes variants and aliases to authoritative canonical names (Node.js, TypeScript, PostgreSQL).
 * 3. Enforces ATS-friendly formatting: strictly zero graphical bars, meters, percentages, or tables.
 */

import { SkillsCategory, SKILLS_CATEGORIES, SkillsMatrix } from './types';

export { SkillsCategory, SKILLS_CATEGORIES, SkillsMatrix };

export interface CanonicalSkillEntry {
  readonly canonicalName: string;
  readonly category: SkillsCategory;
}

/**
 * Technology Canonical Mapping and Normalization Dictionary.
 */
export const CANONICAL_SKILL_DICTIONARY: Record<string, CanonicalSkillEntry> = {
  // ── Core Languages & Frameworks ──
  typescript: { canonicalName: 'TypeScript', category: 'Core Languages & Frameworks' },
  ts: { canonicalName: 'TypeScript', category: 'Core Languages & Frameworks' },
  javascript: { canonicalName: 'JavaScript', category: 'Core Languages & Frameworks' },
  js: { canonicalName: 'JavaScript', category: 'Core Languages & Frameworks' },
  'node.js': { canonicalName: 'Node.js', category: 'Core Languages & Frameworks' },
  nodejs: { canonicalName: 'Node.js', category: 'Core Languages & Frameworks' },
  node: { canonicalName: 'Node.js', category: 'Core Languages & Frameworks' },
  react: { canonicalName: 'React', category: 'Core Languages & Frameworks' },
  reactjs: { canonicalName: 'React', category: 'Core Languages & Frameworks' },
  'react.js': { canonicalName: 'React', category: 'Core Languages & Frameworks' },
  'next.js': { canonicalName: 'Next.js', category: 'Core Languages & Frameworks' },
  nextjs: { canonicalName: 'Next.js', category: 'Core Languages & Frameworks' },
  next: { canonicalName: 'Next.js', category: 'Core Languages & Frameworks' },
  nestjs: { canonicalName: 'NestJS', category: 'Core Languages & Frameworks' },
  'nest.js': { canonicalName: 'NestJS', category: 'Core Languages & Frameworks' },
  nest: { canonicalName: 'NestJS', category: 'Core Languages & Frameworks' },
  'react native': { canonicalName: 'React Native', category: 'Core Languages & Frameworks' },
  'react-native': { canonicalName: 'React Native', category: 'Core Languages & Frameworks' },
  'vue.js': { canonicalName: 'Vue.js', category: 'Core Languages & Frameworks' },
  vue: { canonicalName: 'Vue.js', category: 'Core Languages & Frameworks' },
  vuejs: { canonicalName: 'Vue.js', category: 'Core Languages & Frameworks' },
  'express.js': { canonicalName: 'Express.js', category: 'Core Languages & Frameworks' },
  express: { canonicalName: 'Express.js', category: 'Core Languages & Frameworks' },
  python: { canonicalName: 'Python', category: 'Core Languages & Frameworks' },
  go: { canonicalName: 'Go', category: 'Core Languages & Frameworks' },
  golang: { canonicalName: 'Go', category: 'Core Languages & Frameworks' },
  java: { canonicalName: 'Java', category: 'Core Languages & Frameworks' },
  c: { canonicalName: 'C', category: 'Core Languages & Frameworks' },
  'c++': { canonicalName: 'C++', category: 'Core Languages & Frameworks' },
  cpp: { canonicalName: 'C++', category: 'Core Languages & Frameworks' },
  'c#': { canonicalName: 'C#', category: 'Core Languages & Frameworks' },
  csharp: { canonicalName: 'C#', category: 'Core Languages & Frameworks' },

  // ── State & Databases ──
  postgresql: { canonicalName: 'PostgreSQL', category: 'State & Databases' },
  postgres: { canonicalName: 'PostgreSQL', category: 'State & Databases' },
  psql: { canonicalName: 'PostgreSQL', category: 'State & Databases' },
  mysql: { canonicalName: 'MySQL', category: 'State & Databases' },
  redis: { canonicalName: 'Redis', category: 'State & Databases' },
  mongodb: { canonicalName: 'MongoDB', category: 'State & Databases' },
  mongo: { canonicalName: 'MongoDB', category: 'State & Databases' },
  sqlite: { canonicalName: 'SQLite', category: 'State & Databases' },
  prisma: { canonicalName: 'Prisma', category: 'State & Databases' },
  typeorm: { canonicalName: 'TypeORM', category: 'State & Databases' },
  elasticsearch: { canonicalName: 'Elasticsearch', category: 'State & Databases' },
  firebase: { canonicalName: 'Firebase', category: 'State & Databases' },
  dynamodb: { canonicalName: 'DynamoDB', category: 'State & Databases' },

  // ── Architecture & Infra ──
  docker: { canonicalName: 'Docker', category: 'Architecture & Infra' },
  'rest apis': { canonicalName: 'REST APIs', category: 'Architecture & Infra' },
  'rest api': { canonicalName: 'REST APIs', category: 'Architecture & Infra' },
  rest: { canonicalName: 'REST APIs', category: 'Architecture & Infra' },
  aws: { canonicalName: 'AWS', category: 'Architecture & Infra' },
  'amazon web services': { canonicalName: 'AWS', category: 'Architecture & Infra' },
  'ci/cd': { canonicalName: 'CI/CD', category: 'Architecture & Infra' },
  cicd: { canonicalName: 'CI/CD', category: 'Architecture & Infra' },
  'ci-cd': { canonicalName: 'CI/CD', category: 'Architecture & Infra' },
  'azure devops': { canonicalName: 'Azure DevOps', category: 'Architecture & Infra' },
  azure: { canonicalName: 'Azure DevOps', category: 'Architecture & Infra' },
  microservices: { canonicalName: 'Microservices', category: 'Architecture & Infra' },
  microservice: { canonicalName: 'Microservices', category: 'Architecture & Infra' },
  kubernetes: { canonicalName: 'Kubernetes', category: 'Architecture & Infra' },
  k8s: { canonicalName: 'Kubernetes', category: 'Architecture & Infra' },
  graphql: { canonicalName: 'GraphQL', category: 'Architecture & Infra' },
  linux: { canonicalName: 'Linux', category: 'Architecture & Infra' },
  git: { canonicalName: 'Git', category: 'Architecture & Infra' },
  github: { canonicalName: 'GitHub', category: 'Architecture & Infra' },
  'github actions': { canonicalName: 'CI/CD', category: 'Architecture & Infra' },

  // ── Testing & Quality ──
  jest: { canonicalName: 'Jest', category: 'Testing & Quality' },
  playwright: { canonicalName: 'Playwright', category: 'Testing & Quality' },
  promptfoo: { canonicalName: 'Promptfoo', category: 'Testing & Quality' },
  tdd: { canonicalName: 'TDD', category: 'Testing & Quality' },
  'test-driven development': { canonicalName: 'TDD', category: 'Testing & Quality' },
  vitest: { canonicalName: 'Vitest', category: 'Testing & Quality' },
  cypress: { canonicalName: 'Cypress', category: 'Testing & Quality' },
  'unit testing': { canonicalName: 'Unit Testing', category: 'Testing & Quality' },
  'e2e testing': { canonicalName: 'E2E Testing', category: 'Testing & Quality' },

  // ── AI Tooling & Productivity ──
  genai: { canonicalName: 'GenAI', category: 'AI Tooling & Productivity' },
  'gen-ai': { canonicalName: 'GenAI', category: 'AI Tooling & Productivity' },
  'generative ai': { canonicalName: 'GenAI', category: 'AI Tooling & Productivity' },
  'ai agents': { canonicalName: 'GenAI', category: 'AI Tooling & Productivity' },
  cursor: { canonicalName: 'Cursor', category: 'AI Tooling & Productivity' },
  'claude code': { canonicalName: 'Claude Code', category: 'AI Tooling & Productivity' },
  claude: { canonicalName: 'Claude Code', category: 'AI Tooling & Productivity' },
  'github copilot': { canonicalName: 'GitHub Copilot', category: 'AI Tooling & Productivity' },
  copilot: { canonicalName: 'GitHub Copilot', category: 'AI Tooling & Productivity' },
  'llm evaluation': { canonicalName: 'LLM Evaluation', category: 'AI Tooling & Productivity' },
  'llm eval': { canonicalName: 'LLM Evaluation', category: 'AI Tooling & Productivity' },
  n8n: { canonicalName: 'n8n', category: 'AI Tooling & Productivity' },
  langchain: { canonicalName: 'LangChain', category: 'AI Tooling & Productivity' },
};

/**
 * Convenience map of lowercase alias -> canonical technology name.
 */
export const CANONICAL_SKILL_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(CANONICAL_SKILL_DICTIONARY).map(([k, v]) => [k, v.canonicalName])
);

/**
 * Normalizes a raw skill string to its canonical name and category.
 */
export function canonicalizeSkill(rawSkill: string): CanonicalSkillEntry {
  const trimmed = (typeof rawSkill === 'string' ? rawSkill : '').trim();
  if (!trimmed) {
    return { canonicalName: '', category: 'Core Languages & Frameworks' };
  }
  const normalizedKey = trimmed.toLowerCase();

  if (Object.prototype.hasOwnProperty.call(CANONICAL_SKILL_DICTIONARY, normalizedKey)) {
    return CANONICAL_SKILL_DICTIONARY[normalizedKey];
  }

  // Fallback heuristics for unmapped technology tags
  let category: SkillsCategory = 'Core Languages & Frameworks';
  if (/db|sql|cache|mongo|data|store/i.test(normalizedKey)) {
    category = 'State & Databases';
  } else if (/cloud|infra|devops|docker|container|api|mesh|arch/i.test(normalizedKey)) {
    category = 'Architecture & Infra';
  } else if (/test|qa|mock|spec|assert/i.test(normalizedKey)) {
    category = 'Testing & Quality';
  } else if (/ai|llm|agent|gpt|prompt|ml/i.test(normalizedKey)) {
    category = 'AI Tooling & Productivity';
  }

  // Preserve acronyms if all caps (e.g. CLI, SDK), else title case
  const canonicalName =
    trimmed.length <= 4 && trimmed === trimmed.toUpperCase()
      ? trimmed
      : trimmed.charAt(0).toUpperCase() + trimmed.slice(1);

  return { canonicalName, category };
}

/**
 * Builds a strict 5-category skills matrix.
 * Guarantees all 5 keys exist in exact order without duplicates or graphical bars.
 */
export function buildSkillsMatrix(
  input?: Record<string, string[]> | string[]
): Record<SkillsCategory, string[]> {
  const matrix: Record<SkillsCategory, string[]> = {
    'Core Languages & Frameworks': [],
    'State & Databases': [],
    'Architecture & Infra': [],
    'Testing & Quality': [],
    'AI Tooling & Productivity': [],
  };

  if (!input) {
    return matrix;
  }

  if (Array.isArray(input)) {
    for (const raw of input) {
      if (!raw || typeof raw !== 'string' || !raw.trim()) continue;
      const { canonicalName, category } = canonicalizeSkill(raw);
      if (!canonicalName || !canonicalName.trim()) continue;
      if (!matrix[category].includes(canonicalName)) {
        matrix[category].push(canonicalName);
      }
    }
    return matrix;
  }

  // Input is Record<string, string[]>
  for (const [catKey, skills] of Object.entries(input)) {
    if (!Array.isArray(skills)) continue;
    const isCanonicalKey = (SKILLS_CATEGORIES as readonly string[]).includes(catKey);
    const targetCategory = isCanonicalKey ? (catKey as SkillsCategory) : null;

    for (const skill of skills) {
      if (!skill || typeof skill !== 'string' || !skill.trim()) continue;
      const { canonicalName, category } = canonicalizeSkill(skill);
      if (!canonicalName || !canonicalName.trim()) continue;
      const effectiveCategory = targetCategory ?? category;
      if (!matrix[effectiveCategory].includes(canonicalName)) {
        matrix[effectiveCategory].push(canonicalName);
      }
    }
  }

  return matrix;
}

/**
 * Alias for buildSkillsMatrix for standard formatting contract.
 */
export const formatSkillsMatrix = buildSkillsMatrix;

/**
 * Escapes HTML entities for safe inclusion in templates.
 */
export function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Renders the Skills Matrix in ATS single-column semantic HTML.
 * STRICT: No tables, no progress bars, no percentage scales, no stars.
 */
export function renderSkillsMatrixHtml(matrix: Record<SkillsCategory, string[]>): string {
  const categoryHtmls = SKILLS_CATEGORIES.map((cat) => {
    const skills = matrix[cat] || [];
    if (skills.length === 0) return '';
    return `    <div class="skill-category-row">
      <span class="skill-category-name">${escapeHtml(cat)}:</span>
      <span class="skill-category-items">${escapeHtml(skills.join(', '))}</span>
    </div>`;
  })
    .filter(Boolean)
    .join('\n');

  return `<section class="cv-section cv-skills">
  <h2 class="section-title">Technical Skills</h2>
  <div class="skills-block">
${categoryHtmls}
  </div>
</section>`;
}

/**
 * Renders the Skills Matrix as plain text.
 */
export function renderSkillsMatrixText(matrix: Record<SkillsCategory, string[]>): string {
  return SKILLS_CATEGORIES.map((cat) => {
    const skills = matrix[cat] || [];
    return `${cat}: ${skills.join(', ')}`;
  }).join('\n');
}
