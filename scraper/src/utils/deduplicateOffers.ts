import { JobOffer } from "../types";
import { isMissingOrZeroSalary } from "./salary-enricher";

/** Sources whose `url` is a tracking redirect rather than the employer/board posting. */
const REDIRECT_SOURCES: ReadonlySet<JobOffer["source"]> = new Set(["adzuna"]);

function groupKey(offer: JobOffer): string {
  return offer.fingerprint ? `fp:${offer.fingerprint}` : `id:${offer.id}`;
}

/**
 * Lists every disclosed salary across the group together with where it was seen,
 * e.g. `20 000–25 000 PLN (via justjoin, nofluffjobs) | 6 000 EUR (via greenhouse)`.
 * Identical salary strings are collapsed into one entry with all their sources.
 * The `(via …)` suffix is stripped by `extractMaxMonthlyPln` in n8n scoring.
 */
export function listSalariesWithSources(group: readonly JobOffer[]): string | undefined {
  const bySalary = new Map<string, string[]>();
  for (const offer of group) {
    const salary = offer.salary?.trim();
    if (!salary || isMissingOrZeroSalary(salary)) continue;
    const sources = bySalary.get(salary) ?? [];
    if (!sources.includes(offer.source)) sources.push(offer.source);
    bySalary.set(salary, sources);
  }
  if (bySalary.size === 0) return undefined;
  return [...bySalary.entries()]
    .map(([salary, sources]) => `${salary} (via ${sources.join(", ")})`)
    .join(" | ");
}

function pickFreshestPublishedAt(group: readonly JobOffer[]): string | null | undefined {
  const dates = group
    .map((o) => o.publishedAt)
    .filter((d): d is string => typeof d === "string" && !Number.isNaN(Date.parse(d)));
  if (dates.length === 0) return group[0]?.publishedAt;
  return dates.reduce((a, b) => (Date.parse(b) > Date.parse(a) ? b : a));
}

/**
 * Smart Cross-Board Merge of a group of offers describing the same job:
 * - base record = the one with the longest `body` (richest description),
 * - `url` = direct posting URL (tracking redirects like Adzuna only as last resort),
 * - `salary` = all disclosed salaries with the boards where they were mentioned,
 * - `publishedAt` = freshest valid date, `tags` = union.
 */
export function mergeOfferGroup(group: readonly JobOffer[]): JobOffer {
  const [first] = group;
  if (!first) throw new Error("mergeOfferGroup: empty group");
  if (group.length === 1) return first;

  const base = group.reduce((best, cand) =>
    (cand.body?.length ?? 0) > (best.body?.length ?? 0) ? cand : best,
  );
  const direct = REDIRECT_SOURCES.has(base.source)
    ? group.find((o) => !REDIRECT_SOURCES.has(o.source))
    : undefined;
  const tags = [...new Set(group.flatMap((o) => o.tags ?? []))];

  return {
    ...base,
    url: direct?.url ?? base.url,
    salary: listSalariesWithSources(group),
    publishedAt: pickFreshestPublishedAt(group),
    tags: tags.length > 0 ? tags : base.tags,
    companyMeta: base.companyMeta ?? group.find((o) => o.companyMeta)?.companyMeta,
  };
}

/**
 * Deduplicates offers by `fingerprint` (fallback: `id`) and merges each group of
 * duplicates into a single enriched record instead of keeping only the first one.
 * Output order follows the first occurrence of each group.
 */
export function deduplicateOffers(offers: JobOffer[]): JobOffer[] {
  const groups = new Map<string, JobOffer[]>();
  const idToKey = new Map<string, string>();

  for (const offer of offers) {
    const key = offer.fingerprint ? groupKey(offer) : (idToKey.get(offer.id) ?? groupKey(offer));
    const group = groups.get(key);
    if (group) {
      // Exact same posting seen twice (same source id) — keep the first copy only.
      if (!group.some((o) => o.id === offer.id && o.source === offer.source)) {
        group.push(offer);
      }
    } else {
      groups.set(key, [offer]);
    }
    if (!idToKey.has(offer.id)) idToKey.set(offer.id, key);
  }

  return [...groups.values()].map(mergeOfferGroup);
}
