/**
 * Zero-Hallucination Experience Bullet Assembler
 * Location: scraper/src/generator/bullet-assembler.ts
 *
 * Responsibilities:
 * 1. Maps an array of bullet IDs or slugs strictly to exact CandidateBullet records from Master CV.
 * 2. Enforces zero hallucination: never generates, mutates, or fabricates text or metrics.
 * 3. Handles duplicates, missing IDs, and supports deterministic CV ordering or ranked preservation.
 */

import { CandidateBullet } from './types';
import { CV_SLUGS } from './notion-loader';

export interface BulletAssemblerOptions {
  /**
   * If true, sorts the assembled bullets by their Master CV order ascending.
   * If false or omitted, preserves the requested order from bulletIds.
   */
  sortByCvOrder?: boolean;

  /**
   * If true and no bulletIds match (or bulletIds is empty), falls back to returning
   * all candidate bullets sorted by order.
   */
  fallbackToAllIfEmpty?: boolean;

  /**
   * Maximum number of bullets to return.
   */
  limit?: number;
}

/**
 * Builds an index mapping IDs, lowercase IDs, slugs, and canonical order slugs to bullets.
 */
function buildBulletIndex(bullets: CandidateBullet[]): Map<string, CandidateBullet> {
  const index = new Map<string, CandidateBullet>();
  if (!Array.isArray(bullets)) return index;

  for (const bullet of bullets) {
    if (!bullet || typeof bullet !== 'object') continue;
    if (bullet.id && typeof bullet.id === 'string') {
      index.set(bullet.id, bullet);
      index.set(bullet.id.toLowerCase().trim(), bullet);
    }
    if (bullet.slug && typeof bullet.slug === 'string') {
      index.set(bullet.slug, bullet);
      index.set(bullet.slug.toLowerCase().trim(), bullet);
    }
    if (typeof bullet.order === 'number') {
      const orderKey = `bullet-${bullet.order}`;
      index.set(orderKey, bullet);
      index.set(orderKey.toLowerCase(), bullet);

      if (CV_SLUGS[bullet.order]) {
        const canonicalSlug = CV_SLUGS[bullet.order];
        index.set(canonicalSlug, bullet);
        index.set(canonicalSlug.toLowerCase(), bullet);
      }
    }
  }

  return index;
}

/**
 * Assembles experience bullets strictly from Master CV based on provided IDs/slugs.
 * Guarantees zero hallucinations: returned highlight text is verbatim from Master CV.
 *
 * @param bulletIds - Array of bullet IDs or slugs selected by Pre-Ranker or LLM.
 * @param allBullets - Complete array of candidate bullets from Notion Master CV.
 * @param options - Optional assembly options (ordering, fallback, limit).
 * @returns Array of verbatim CandidateBullet objects.
 */
export function assembleExperienceBullets(
  bulletIds: string[],
  allBullets: CandidateBullet[],
  options?: BulletAssemblerOptions
): CandidateBullet[] {
  if (!allBullets || allBullets.length === 0) {
    return [];
  }

  const index = buildBulletIndex(allBullets);
  const assembled: CandidateBullet[] = [];
  const seenIds = new Set<string>();

  for (const rawId of bulletIds || []) {
    if (!rawId || typeof rawId !== 'string') continue;
    const cleanId = rawId.trim();
    const matched = index.get(cleanId) || index.get(cleanId.toLowerCase());

    if (matched && !seenIds.has(matched.id)) {
      seenIds.add(matched.id);
      // Clone bullet to guarantee immutability while preserving exact verbatim fields
      assembled.push({
        id: matched.id,
        slug: matched.slug,
        title: matched.title,
        section: matched.section,
        highlight: matched.highlight, // EXACT verbatim text from Master CV
        tags: Array.isArray(matched.tags) ? [...matched.tags] : [],
        period: matched.period,
        order: matched.order,
      });
    }
  }

  // Graceful fallback if no IDs matched
  if (assembled.length === 0 && options?.fallbackToAllIfEmpty) {
    return (Array.isArray(allBullets) ? allBullets : [])
      .filter((b): b is CandidateBullet => Boolean(b && typeof b === 'object'))
      .slice()
      .sort((a, b) => (a?.order ?? 0) - (b?.order ?? 0))
      .slice(0, options.limit)
      .map((matched) => ({
        id: matched.id,
        slug: matched.slug,
        title: matched.title,
        section: matched.section,
        highlight: matched.highlight,
        tags: Array.isArray(matched.tags) ? [...matched.tags] : [],
        period: matched.period,
        order: matched.order,
      }));
  }

  // Sort by Master CV order if explicitly requested
  if (options?.sortByCvOrder) {
    assembled.sort((a, b) => a.order - b.order);
  }

  // Apply limit if specified
  if (typeof options?.limit === 'number' && options.limit > 0) {
    return assembled.slice(0, options.limit);
  }

  return assembled;
}

/**
 * Convenience helper returning verbatim highlight strings for selected bullet IDs.
 */
export function assembleVerbatimBulletTexts(
  bulletIds: string[],
  allBullets: CandidateBullet[]
): string[] {
  return assembleExperienceBullets(bulletIds, allBullets).map((b) => b.highlight);
}

/**
 * Validates which bullet IDs from an input array exist in the Master CV.
 */
export function validateBulletIds(
  bulletIds: string[],
  allBullets: CandidateBullet[]
): { valid: string[]; missing: string[] } {
  const index = buildBulletIndex(allBullets);
  const valid: string[] = [];
  const missing: string[] = [];

  for (const rawId of bulletIds || []) {
    const cleanId = (rawId || '').trim();
    if (!cleanId) continue;
    if (index.has(cleanId) || index.has(cleanId.toLowerCase())) {
      valid.push(cleanId);
    } else {
      missing.push(cleanId);
    }
  }

  return { valid, missing };
}
