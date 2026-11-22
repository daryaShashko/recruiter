import { config } from "../config";
import { funnelTracker } from "./funnel";

/** Candidate fields a source can provide for the shared pre-filter (ADR-020). */
export interface GlobalFilterInput {
  title: string;
  /** Plain-text or HTML description; may be empty if the source has none */
  description?: string;
  tags?: readonly string[];
  /** Publish date of the posting, if known */
  publishedAt?: Date;
  /** Expiration date of the posting, if the source provides one */
  expiresAt?: Date;
  /** Optional max age in days threshold override */
  maxAgeDays?: number;
  /** Optional job source name (e.g. 'ats', 'greenhouse', 'thehub') */
  source?: string;
}

export type GlobalFilterReason =
  | "ok"
  | "not-senior"
  | "rejected-level"
  | "rejected-role"
  | "no-js-signal"
  | "too-old"
  | "expired"
  | "legal-blocker";

const DAY_MS = 24 * 60 * 60 * 1000;

export function stripHtml(html: string): string {
  const decoded = html
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&");

  return decoded
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|h[1-6]|div)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n+/g, "\n")
    .trim();
}

function containsAny(haystack: string, needles: readonly string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

/**
 * Matches non-target role families (support, sales, SRE, DevOps, QA, data, mobile)
 * using whole-word regex matching to avoid false positives (e.g. "equal opportunity" or "disregard").
 */
export function matchesRoleFamily(
  title: string,
  families?: readonly string[],
): boolean {
  const list = families ?? config.global?.rejectRoleFamilies ?? [];
  if (!Array.isArray(list) || list.length === 0) {
    return false;
  }
  return list.some((family) => {
    const escaped = family
      .trim()
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\s+/g, "\\s+");
    return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, "i").test(title);
  });
}

/**
 * Cheap title-only check usable on list-endpoint data, before spending a
 * request on a per-job detail fetch. Sources with expensive detail calls
 * (one HTTP request per job) should call this first to cut volume, then run
 * the full evaluateGlobalFilter() once the detail is fetched.
 *
 * Removes mandatory senior keywords requirement, retains junior/intern rejection,
 * and rejects non-target role families.
 */
export function passesTitleFilter(title: string): boolean {
  const padded = ` ${title.toLowerCase()} `;
  const rejectSignals = config.global?.rejectTitleSignals ?? [];
  if (Array.isArray(rejectSignals) && containsAny(padded, rejectSignals)) {
    return false;
  }
  if (matchesRoleFamily(title)) {
    return false;
  }
  return true;
}

const ATS_SOURCES = new Set([
  "ats",
  "greenhouse",
  "lever",
  "ashby",
  "workable",
  "recruitee",
  "personio",
]);

function isAtsSource(source?: string): boolean {
  if (!source) return false;
  const s = source.toLowerCase().trim();
  return s.startsWith("ats") || ATS_SOURCES.has(s);
}

/** Cheap freshness check for list endpoints that expose publish dates. */
export function passesAgeFilter(
  publishedAt: Date | undefined,
  nowOrMaxAgeDays?: Date | number,
  maxAgeDaysParam?: number,
): boolean {
  let now = new Date();
  let maxAgeDays: number = config.global?.maxAgeDays ?? 60;

  if (typeof nowOrMaxAgeDays === "number") {
    maxAgeDays = nowOrMaxAgeDays;
  } else if (nowOrMaxAgeDays instanceof Date) {
    now = nowOrMaxAgeDays;
    if (typeof maxAgeDaysParam === "number") {
      maxAgeDays = maxAgeDaysParam;
    }
  }

  return (
    !publishedAt ||
    now.getTime() - publishedAt.getTime() <= maxAgeDays * DAY_MS
  );
}

/**
 * Matches a JS stack signal as a whole word, so "javascript" does not match
 * "java" and "node" does not match "nodemailer"-like substrings in titles.
 */
function hasJsSignal(text: string): boolean {
  const withoutVerbReact = text.replace(
    /\breact\s+(?:appropriately|accordingly|positively|quickly|effectively|proactively)\b/gi,
    " ",
  );
  const jsSignals = config.global?.jsSignals ?? [];
  return jsSignals.some((signal) => {
    const escaped = signal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, "i").test(
      withoutVerbReact,
    );
  });
}

const optionalSectionHeader =
  /^(?:nice(?:[- ]to[- ]have)?|good[- ]to[- ]have|bonus(?:es)?|optional(?: skills)?|preferred(?: qualifications| skills)?|desirable|additional skills)\s*:?\s*$/i;
const requiredSectionHeader =
  /^(?:requirements?|required(?: skills| qualifications)?|must[- ]have|essential(?: skills| requirements)?|qualifications?|what you(?:'|’)ll need|what you(?:'|’)ll bring|what we(?:'|’)re looking for|your profile)\s*:?\s*$/i;
const descriptionRequiredSignal =
  /\b(?:required|must[- ]have|essential|proficien(?:t|cy)|expertise|experience|strong knowledge|hands[- ]on)\b/i;
const optionalSignal =
  /\b(?:nice to have|good to have|optional|bonus|a plus|an advantage|preferred|desirable|not required|not mandatory|ideally)\b/i;
const primaryNonJsLanguage =
  /(^|[^a-z0-9])(?:java|c#|c sharp|\.net|dotnet)($|[^a-z0-9])/i;

function hasDescriptionJsSignal(
  description: string,
  requireExplicitRequirement: boolean,
): boolean {
  let inOptionalSection = false;
  let inRequiredSection = false;
  const segments = description.split(/(?<=[.!?;])\s+|\n+/);

  for (const segment of segments) {
    const text = segment.trim();
    if (!text) {
      continue;
    }
    if (optionalSectionHeader.test(text)) {
      inOptionalSection = true;
      inRequiredSection = false;
      continue;
    }
    if (requiredSectionHeader.test(text)) {
      inOptionalSection = false;
      inRequiredSection = true;
      continue;
    }
    if (inOptionalSection || optionalSignal.test(text)) {
      continue;
    }
    if (
      hasJsSignal(text) &&
      (!requireExplicitRequirement ||
        inRequiredSection ||
        descriptionRequiredSignal.test(text))
    ) {
      return true;
    }
  }
  return false;
}

/** Classifies a posting; `now` is injectable for deterministic tests. */
export function evaluateGlobalFilter(
  input: GlobalFilterInput,
  now: Date = new Date(),
  maxAgeDaysParam?: number,
): GlobalFilterReason {
  const title = ` ${input.title.toLowerCase()} `;
  const description = (input.description ?? "").toLowerCase();

  const rejectSignals = config.global?.rejectTitleSignals ?? [];
  if (Array.isArray(rejectSignals) && containsAny(title, rejectSignals)) {
    return "rejected-level";
  }
  if (matchesRoleFamily(input.title)) {
    return "rejected-role";
  }
  if (input.expiresAt && input.expiresAt.getTime() < now.getTime()) {
    return "expired";
  }
  const defaultMaxAge = isAtsSource(input.source)
    ? (config.global?.atsMaxAgeDays ?? 180)
    : (config.global?.maxAgeDays ?? 60);
  const maxAgeDays = input.maxAgeDays ?? maxAgeDaysParam ?? defaultMaxAge;
  if (
    input.publishedAt &&
    now.getTime() - input.publishedAt.getTime() > maxAgeDays * DAY_MS
  ) {
    return "too-old";
  }
  const titleAndTags = [input.title, ...(input.tags ?? [])].join(" ");
  const hasDirectSignal = hasJsSignal(titleAndTags);
  const primaryLanguageRole = primaryNonJsLanguage.test(input.title);
  const isTargetProductRole =
    /\bproduct\s+(?:engineer|developer)\b/i.test(input.title) &&
    !primaryLanguageRole;

  if (
    !hasDirectSignal &&
    !isTargetProductRole &&
    !hasDescriptionJsSignal(description, primaryLanguageRole)
  ) {
    return "no-js-signal";
  }
  if (containsAny(description, config.global.legalBlockers)) {
    return "legal-blocker";
  }
  return "ok";
}

export function passesGlobalFilter(
  input: GlobalFilterInput,
  now: Date = new Date(),
  maxAgeDays?: number,
): boolean {
  return evaluateGlobalFilter(input, now, maxAgeDays) === "ok";
}

/** Parses an ISO string, epoch ms, or dd.mm.yyyy; returns undefined if invalid. */
export function parseDate(value: unknown): Date | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  if (typeof value !== "string" || value.trim() === "") {
    return undefined;
  }
  const dotted = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value.trim());
  if (dotted) {
    const date = new Date(
      Date.UTC(Number(dotted[3]), Number(dotted[2]) - 1, Number(dotted[1])),
    );
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** Converts a raw date value (ISO string, epoch ms, or dd.mm.yyyy) to an ISO-8601 string, or null if absent/invalid. */
export function toIsoDate(value: unknown): string | null {
  return parseDate(value)?.toISOString() ?? null;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Logs per-reason counts so pre-filter drop rates are visible in CI logs. */
export function logFilterStats(
  sourceName: string,
  reasons: readonly GlobalFilterReason[],
): void {
  const counts = new Map<GlobalFilterReason, number>();
  for (const reason of reasons) {
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  const summary = [...counts.entries()]
    .map(([reason, count]) => `${reason}=${count}`)
    .join(", ");
  console.log(
    `[${sourceName}] Pre-filter: ${counts.get("ok") ?? 0}/${reasons.length} kept (${summary || "none"})`,
  );

  const passed = counts.get("ok") ?? 0;
  const dropped = reasons.length - passed;
  funnelTracker.recordFilterStats(sourceName, reasons.length, dropped, passed);
}
