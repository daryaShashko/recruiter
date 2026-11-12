/**
 * Deterministic TypeScript Pre-Ranker
 * Location: scraper/src/generator/pre-ranker.ts
 *
 * Responsibilities:
 * 1. Evaluates and scores Candidate CV bullets against Job Offer title, body, and tags.
 * 2. Provides 100% offline fallback when LLM is unavailable or disabled.
 * 3. Returns ranked list with scores, matched tags, and deterministic tie-breaking.
 */

import { CandidateBullet, PreRankOptions, PreRankResult } from './types';

export { PreRankOptions, PreRankResult };

// Synonyms and aliases for robust tag & keyword matching
export const TECH_SYNONYMS: Record<string, string[]> = {
  nodejs: ['node.js', 'node', 'nodejs'],
  typescript: ['typescript', 'ts'],
  javascript: ['javascript', 'js'],
  postgresql: ['postgresql', 'postgres', 'psql'],
  react: ['react', 'react.js', 'reactjs'],
  reactnative: ['react native', 'react-native', 'reactnative'],
  nextjs: ['next.js', 'nextjs', 'next'],
  nestjs: ['nestjs', 'nest.js', 'nest'],
  docker: ['docker', 'container', 'containers'],
  cicd: ['ci/cd', 'cicd', 'ci-cd', 'continuous integration', 'github actions', 'jenkins', 'bamboo'],
  restapi: ['rest api', 'rest apis', 'rest', 'restful'],
  genai: ['genai', 'gen ai', 'generative ai', 'llm', 'llms', 'ai agents', 'promptfoo', 'agent', 'agents'],
  aws: ['aws', 'amazon web services'],
  azuredevops: ['azure devops', 'azure', 'devops'],
  mongodb: ['mongodb', 'mongo'],
  redis: ['redis'],
  mysql: ['mysql'],
  architecture: ['architecture', 'architect', 'architectural', 'greenfield'],
  teamlead: ['team lead', 'tech lead', 'lead', 'leadership', 'leading', 'mentoring'],
  healthtech: ['healthtech', 'medical', 'clinic', 'healthcare'],
  promptfoo: ['promptfoo'],
  cursor: ['cursor'],
  githubcopilot: ['copilot', 'github copilot'],
  n8n: ['n8n'],
  frontend: ['frontend', 'front-end', 'fe'],
  backend: ['backend', 'back-end', 'be'],
  fullstack: ['fullstack', 'full-stack', 'full stack'],
  javamigration: ['java migration', 'java', 'migration'],
  mobile: ['mobile', 'ios', 'android'],
  english: ['english', 'en', 'english b2/c1', 'fluent english'],
  polish: ['polish', 'pl', 'polish b1'],
  russian: ['russian', 'ru', 'russian native'],
  tdd: ['tdd', 'test-driven development', 'unit test', 'unit testing'],
  playwright: ['playwright', 'e2e'],
  jest: ['jest'],
  graphql: ['graphql'],
  microservices: ['microservices', 'microservice'],
  kubernetes: ['kubernetes', 'k8s'],
  firebase: ['firebase'],
  cpp: ['c++', 'cpp'],
  csharp: ['c#', 'csharp', 'c-sharp'],
};

// Section baseline weights prioritizing accomplishments and core relevance
export const SECTION_BASE_WEIGHTS: Record<string, number> = {
  'Key Achievement': 5,
  'Recent Experience (Last 6m)': 4,
  'Role & Summary': 3,
  'Target Role & Leadership': 3,
  'Primary Stack': 2,
  'AI & Tools': 2,
  'Secondary Stack': 1,
  'Languages': 1,
};

function normalizeString(str: unknown): string {
  if (typeof str !== 'string') return '';
  return str.toLowerCase().trim();
}

function normalizeTagKey(tag: unknown): string {
  if (typeof tag !== 'string') return '';
  return tag
    .toLowerCase()
    .trim()
    .replace(/c\+\+/g, 'cpp')
    .replace(/c#/g, 'csharp')
    .replace(/\.net\b/g, 'dotnet')
    .replace(/[^a-z0-9]/g, '');
}

function escapeRegex(str: unknown): string {
  if (typeof str !== 'string') return '';
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Checks whether a candidate bullet tag matches a target job tag or appears in target text.
 */
function tagMatchesJobTag(candidateTag: string, jobTags: string[]): boolean {
  if (!candidateTag || typeof candidateTag !== 'string' || !candidateTag.trim()) {
    return false;
  }
  if (!Array.isArray(jobTags) || jobTags.length === 0) {
    return false;
  }
  const normCandidate = normalizeTagKey(candidateTag);
  if (!normCandidate) return false;

  for (const jt of jobTags) {
    if (!jt || typeof jt !== 'string' || !jt.trim()) continue;
    const normJt = normalizeTagKey(jt);
    if (!normJt) continue;

    if (normCandidate === normJt) {
      return true;
    }
    // Check synonym groups
    for (const synonyms of Object.values(TECH_SYNONYMS)) {
      const candidateInSynonyms = synonyms.some((s) => normalizeTagKey(s) === normCandidate);
      const jtInSynonyms = synonyms.some((s) => normalizeTagKey(s) === normJt);
      if (candidateInSynonyms && jtInSynonyms) {
        return true;
      }
    }
  }
  return false;
}

function buildWordBoundaryPattern(term: string): RegExp {
  const norm = term.toLowerCase().trim();
  const escaped = escapeRegex(norm);
  // Special boundary rule for 'c': ensure it is NOT followed by '+' or '#' so it never matches 'c++' or 'c#'
  const trailing = norm === 'c' ? '(?![a-zA-Z0-9+#])' : '($|[^a-zA-Z0-9])';
  return new RegExp(`(^|[^a-zA-Z0-9])${escaped}${trailing}`, 'i');
}

/**
 * Checks whether a tag appears as a whole word/phrase in text.
 */
function tagAppearsInText(candidateTag: string, text: string): boolean {
  if (!candidateTag || typeof candidateTag !== 'string' || !candidateTag.trim()) {
    return false;
  }
  if (!text || typeof text !== 'string') {
    return false;
  }
  const normCandidate = normalizeString(candidateTag);
  if (!normCandidate) return false;
  const normKey = normalizeTagKey(candidateTag);
  if (!normKey) return false;

  // Direct word-boundary search for candidate tag
  const directPattern = buildWordBoundaryPattern(normCandidate);
  if (directPattern.test(text)) return true;

  // Check synonym group matches
  for (const synonyms of Object.values(TECH_SYNONYMS)) {
    const matchGroup = synonyms.some((s) => normalizeTagKey(s) === normKey);
    if (matchGroup) {
      for (const syn of synonyms) {
        if (!syn || !syn.trim()) continue;
        const synPattern = buildWordBoundaryPattern(syn);
        if (synPattern.test(text)) return true;
      }
    }
  }

  return false;
}

/**
 * Extracts key domain terms from bullet text to detect high-relevance overlap with job requirements.
 */
function calculateKeywordOverlap(bulletText: string, jobText: string): number {
  if (!bulletText || !jobText) return 0;
  const keywords = [
    'migration',
    'modernization',
    'refactoring',
    'architecture',
    'greenfield',
    'leadership',
    'cost',
    'pipeline',
    'evaluation',
    'agent',
  ];
  let score = 0;
  const normJob = normalizeString(jobText);
  const normBullet = normalizeString(bulletText);

  for (const kw of keywords) {
    if (normBullet.includes(kw) && normJob.includes(kw)) {
      score += 2;
    }
  }
  return score;
}

/**
 * Deterministically ranks candidate experience bullets against a job offer.
 *
 * @param bullets - List of candidate experience bullets from Master CV.
 * @param jobTitle - Vacancy title.
 * @param jobBody - Full job description text.
 * @param jobTags - Optional tech stack tags from job board.
 * @param options - Optional ranking parameters (limit, minScore).
 * @returns Array of PreRankResult sorted by score descending, with deterministic tie-breaking.
 */
export function preRankBullets(
  bullets: CandidateBullet[],
  jobTitle: string,
  jobBody: string,
  jobTags?: string[],
  options?: PreRankOptions
): PreRankResult[] {
  if (!bullets || bullets.length === 0) {
    return [];
  }

  const safeTitle = typeof jobTitle === 'string' ? jobTitle : '';
  const safeBody = typeof jobBody === 'string' ? jobBody : '';
  const safeTags = (Array.isArray(jobTags) ? jobTags : [])
    .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
    .map(normalizeString);

  const results: PreRankResult[] = [];

  for (const bullet of bullets) {
    if (!bullet) continue;
    let score = 0;
    const matchedTagsSet = new Set<string>();

    const rawTags = Array.isArray(bullet.tags) ? bullet.tags : [];
    const validTags = rawTags.filter(
      (t): t is string => typeof t === 'string' && t.trim().length > 0
    );

    // 1. Tag matching across jobTags, jobTitle, and jobBody
    for (const tag of validTags) {
      let tagMatched = false;

      // Check job tags (Highest relevance: +10 pts)
      if (safeTags.length > 0 && tagMatchesJobTag(tag, safeTags)) {
        score += 10;
        tagMatched = true;
      }

      // Check job title (+8 pts)
      if (tagAppearsInText(tag, safeTitle)) {
        score += 8;
        tagMatched = true;
      }

      // Check job body (+4 pts)
      if (tagAppearsInText(tag, safeBody)) {
        score += 4;
        tagMatched = true;
      }

      if (tagMatched) {
        matchedTagsSet.add(tag);
      }
    }

    // 2. Keyword overlap in bullet title & highlight against job description
    const titleOverlap = calculateKeywordOverlap(bullet.title, `${safeTitle} ${safeBody}`);
    const highlightOverlap = calculateKeywordOverlap(bullet.highlight, `${safeTitle} ${safeBody}`);
    score += titleOverlap + highlightOverlap;

    // 3. Section base weight (ensures achievements & recent exp rank high in ties or general queries)
    const baseWeight =
      Object.prototype.hasOwnProperty.call(SECTION_BASE_WEIGHTS, bullet.section)
        ? SECTION_BASE_WEIGHTS[bullet.section]
        : 1;
    score += baseWeight;

    results.push({
      bulletId: bullet.id || bullet.slug || `bullet-${bullet.order}`,
      score,
      matchedTags: Array.from(matchedTagsSet),
    });
  }

  // 4. Deterministic Sort:
  // Primary: Score descending
  // Secondary: Original Master CV order ascending
  // Tertiary: BulletId ascending
  const bulletMap = new Map<string, CandidateBullet>();
  for (const b of bullets) {
    if (!b) continue;
    const key = b.id || b.slug || `bullet-${b.order}`;
    bulletMap.set(key, b);
  }

  results.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    const orderA = bulletMap.get(a.bulletId)?.order ?? 999;
    const orderB = bulletMap.get(b.bulletId)?.order ?? 999;
    if (orderA !== orderB) {
      return orderA - orderB;
    }
    return a.bulletId.localeCompare(b.bulletId);
  });

  // 5. Apply filtering (minScore) and slicing (limit)
  let filtered = results;
  if (typeof options?.minScore === 'number') {
    filtered = filtered.filter((r) => r.score >= options.minScore!);
  }

  if (typeof options?.limit === 'number' && options.limit > 0) {
    filtered = filtered.slice(0, options.limit);
  }

  return filtered;
}
