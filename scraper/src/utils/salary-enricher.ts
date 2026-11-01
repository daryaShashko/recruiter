import { JobOffer } from "../types";

const LEGAL_SUFFIXES =
  /\b(?:sp\.?\s*z\s*o\.?\s*o\.?|s\.?\s*a\.?|inc\.?|ltd\.?|llc|gmbh|corp\.?|corporation|polska|poland|group|technologies|technology|software|solutions|systems)\b/gi;

const TITLE_NOISE =
  /\b(?:remote|hybrid|onsite|on-site|senior|sr|lead|principal|staff|regular|mid|junior|engineer|developer|programmer|specialist|architect|in|for|with|and)\b/gi;

export function normalizeCompanyName(company: string): string {
  return company
    .toLowerCase()
    .replace(LEGAL_SUFFIXES, " ")
    .replace(/[^a-z0-9ąćęłńóśźż]+/gi, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeJobTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\bfull[\s-]*stack\b/g, "fullstack")
    .replace(/\bfront[\s-]*end\b/g, "frontend")
    .replace(/\bback[\s-]*end\b/g, "backend")
    .replace(/[^a-z0-9ąćęłńóśźż.#+]+/gi, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function extractCoreRoleTokens(title: string): Set<string> {
  const cleaned = normalizeJobTitle(title).replace(TITLE_NOISE, " ");
  const tokens = cleaned
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
  return new Set(tokens);
}

export function isMissingOrZeroSalary(salary?: string): boolean {
  if (!salary) return true;
  const trimmed = salary.trim().toLowerCase();
  if (
    trimmed === "" ||
    trimmed === "0" ||
    trimmed === "n/a" ||
    trimmed === "na" ||
    trimmed === "none" ||
    trimmed === "null" ||
    trimmed === "undefined" ||
    trimmed === "undisclosed" ||
    trimmed === "no salary" ||
    trimmed === "competitive"
  ) {
    return true;
  }
  const withoutB2b = trimmed.replace(/\bb2b\b/g, " ");
  const numbers = withoutB2b.match(/\d+/g);
  if (!numbers) return true;
  return numbers.every((n) => Number(n) === 0);
}

function titlesMatch(a: string, b: string): boolean {
  const normA = normalizeJobTitle(a);
  const normB = normalizeJobTitle(b);
  if (!normA || !normB) return false;
  if (normA === normB) return true;
  if (normA.includes(normB) || normB.includes(normA)) return true;

  const tokensA = extractCoreRoleTokens(a);
  const tokensB = extractCoreRoleTokens(b);
  if (tokensA.size === 0 || tokensB.size === 0) return false;

  let overlap = 0;
  for (const tok of tokensA) {
    if (tokensB.has(tok)) overlap++;
  }
  const minSize = Math.min(tokensA.size, tokensB.size);
  return overlap > 0 && overlap / minSize >= 0.6;
}

/**
 * Cross-platform salary enrichment:
 * When an offer has a missing or zero salary (common on JustJoin), search all
 * collected offers from other platforms (e.g. NoFluffJobs, where salary is
 * almost always disclosed) for the same company and matching job title.
 * If found, copy the disclosed salary so the offer is evaluated with real
 * compensation data instead of missing salary.
 */
export function enrichMissingSalaries(offers: JobOffer[]): {
  offers: JobOffer[];
  enrichedCount: number;
} {
  const withSalary = offers.filter((o) => !isMissingOrZeroSalary(o.salary));
  let enrichedCount = 0;

  const enriched = offers.map((offer) => {
    if (!isMissingOrZeroSalary(offer.salary)) {
      return offer;
    }

    const compNorm = normalizeCompanyName(offer.company);
    if (!compNorm) {
      return { ...offer, salary: undefined };
    }

    // 1. Exact normalized company + exact normalized title from another source
    const exactMatch =
      withSalary.find(
        (cand) =>
          cand.id !== offer.id &&
          normalizeCompanyName(cand.company) === compNorm &&
          normalizeJobTitle(cand.title) === normalizeJobTitle(offer.title),
      ) ??
      // 2. Exact normalized company + fuzzy core role title match
      withSalary.find(
        (cand) =>
          cand.id !== offer.id &&
          normalizeCompanyName(cand.company) === compNorm &&
          titlesMatch(cand.title, offer.title),
      );

    if (exactMatch && exactMatch.salary) {
      enrichedCount++;
      const enrichedSalary = `${exactMatch.salary} (via ${exactMatch.source})`;
      return {
        ...offer,
        salary: enrichedSalary,
      };
    }

    // Normalize "0" / empty strings to undefined
    return {
      ...offer,
      salary: undefined,
    };
  });

  return { offers: enriched, enrichedCount };
}
