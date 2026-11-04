import { config } from "../config";

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
}

export type GlobalFilterReason =
  | "ok"
  | "not-senior"
  | "rejected-level"
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
 * Cheap title-only check usable on list-endpoint data, before spending a
 * request on a per-job detail fetch. Sources with expensive detail calls
 * (one HTTP request per job) should call this first to cut volume, then run
 * the full evaluateGlobalFilter() once the detail is fetched.
 */
export function passesTitleFilter(title: string): boolean {
  const padded = ` ${title.toLowerCase()} `;
  if (containsAny(padded, config.global.rejectTitleSignals)) {
    return false;
  }
  return containsAny(padded, config.global.seniorTitleSignals);
}

/** Cheap freshness check for list endpoints that expose publish dates. */
export function passesAgeFilter(
  publishedAt: Date | undefined,
  now: Date = new Date(),
): boolean {
  return (
    !publishedAt ||
    now.getTime() - publishedAt.getTime() <= config.global.maxAgeDays * DAY_MS
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
  return config.global.jsSignals.some((signal) => {
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
  const segments = description.split(/(?<=[.!?])\s+|\n+/);

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
): GlobalFilterReason {
  const title = ` ${input.title.toLowerCase()} `;
  const description = (input.description ?? "").toLowerCase();

  if (containsAny(title, config.global.rejectTitleSignals)) {
    return "rejected-level";
  }
  if (!containsAny(title, config.global.seniorTitleSignals)) {
    return "not-senior";
  }
  if (input.expiresAt && input.expiresAt.getTime() < now.getTime()) {
    return "expired";
  }
  if (
    input.publishedAt &&
    now.getTime() - input.publishedAt.getTime() >
      config.global.maxAgeDays * DAY_MS
  ) {
    return "too-old";
  }
  const titleAndTags = [input.title, ...(input.tags ?? [])].join(" ");
  const hasDirectSignal = hasJsSignal(titleAndTags);
  const primaryLanguageRole = primaryNonJsLanguage.test(input.title);
  if (
    !hasDirectSignal &&
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
): boolean {
  return evaluateGlobalFilter(input, now) === "ok";
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
}
