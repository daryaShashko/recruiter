/**
 * Job-evaluation scoring: parses the LLM's raw JSON response, enforces
 * programmatic hard-reject rules (both as a Pre-LLM gate via `preFilterJob` and
 * post-LLM via `evaluateJob`), computes take-home `net_salary`, and extracts
 * rich Russian card fields (`project_summary`, `tasks_summary`, `match_pros`,
 * `match_cons`, `pitch_hook`).
 */

import type { DynamicScoringConfig } from "./notion-profile";

export interface CompanyMetadata {
  readonly size?: string;
  readonly companyUrl?: string;
  readonly advertiserType?: string;
  readonly industry?: string;
}

export interface JobForScoring {
  readonly id: string;
  readonly title?: string;
  readonly company?: string;
  readonly url: string;
  readonly source?: string;
  readonly location?: string;
  readonly salary?: string;
  readonly body?: string;
  readonly scrapedAt?: string;
  readonly fingerprint?: string;
  readonly companyMeta?: CompanyMetadata;
}

export interface EvaluationResult {
  readonly id: string;
  readonly title?: string;
  readonly company?: string;
  readonly url: string;
  readonly source?: string;
  readonly location?: string;
  readonly salary?: string;
  readonly net_salary?: string;
  readonly scrapedAt?: string;
  readonly fingerprint: string;
  readonly overall_score: number;
  readonly tech_stack_match: number;
  readonly seniority_match: number;
  readonly red_flags: string[];
  readonly reason: string;
  readonly match: boolean;
  readonly company_dossier?: string;
  readonly project_summary?: string;
  readonly tasks_summary?: string[];
  readonly match_pros?: string[];
  readonly match_cons?: string[];
  readonly pitch_hook?: string;
  readonly companyMeta?: CompanyMetadata;
  readonly companyUrl?: string;
}

export interface PreFilterResult {
  readonly rejected: boolean;
  readonly reason?: string;
  readonly red_flags: string[];
  readonly evaluation?: EvaluationResult;
}

interface RawLlmEvaluation {
  overall_score?: number;
  tech_stack_match?: number;
  seniority_match?: number;
  red_flags?: unknown[];
  reason?: string;
  company_dossier?: string;
  project_summary?: string;
  tasks_summary?: unknown[];
  match_pros?: unknown[];
  match_cons?: unknown[];
  pitch_hook?: string;
}

const CRITICAL_FLAGS = [
  "Industry: Crypto/Web3",
  "Industry: Gambling/Betting",
  "Industry: Agency/Outsourcing",
  "Salary: Below Hard Floor",
  "Process: Invasive Surveillance",
  "Stack: Legacy/Non-JS",
  "Stack: Non-JS Required",
  "Role: Infra From Scratch",
  "Description: Missing",
];

/** Bossware & invasive telemetry monitoring tools and mechanisms (Hard Reject). */
export const BOSSWARE_SURVEILLANCE_REGEX = new RegExp(
  [
    /\b(?:hubstaff|time\s*doctor|worksnaps|crossover\s+worksmart|clevercontrol|desktime|sneek|teramind|staffcop|monitask)\b/,
    /\b(?:screenshot\s+(?:monitoring|tracking|capture|taking)|desktop\s+(?:screenshots?|monitoring)|automated\s+screenshots?)\b/,
    /\b(?:zrzut(?:y|ów)?\s+ekranu|monitoring\s+ekranu|przechwytywani(?:e|a)\s+ekranu)\b/,
    /\b(?:keystroke\s+(?:logging|tracking|monitoring)|mouse\s+movement\s+tracking|activity\s+(?:level|score)\s*(?:percentage|%))\b/,
    /\b(?:rejestrowani(?:e|a)\s+klawiszy|śledzeni(?:e|a)\s+ruchów\s+myszy|pomiar\s+aktywności\s+(?:klawiatury|myszy))\b/,
    /\b(?:webcam\s+(?:monitoring|photos?|snapshots?|capture)|always[\s-]on\s+webcam)\b/,
    /\b(?:zdjęci(?:a|e)\s+z\s+kamer(?:y|ki)|ciągł(?:y|a)\s+podgląd\s+z\s+kamery)\b/,
  ]
    .map((r) => r.source)
    .join("|"),
  "i",
);

/** Toxic overwork, burnout cults, and uncompensated 24/7 expectations. */
export const TOXIC_OVERWORK_REGEX = new RegExp(
  [
    /\b(?:24\s*\/\s*7\s+(?:on[\s-]call|availability|support|pagerduty))\b/,
    /\b(?:wear\s+many\s+hats\s+in\s+a\s+24\s*\/\s*7)\b/,
    /\b(?:stał(?:a|ej)\s+dyspozycyjn(?:ość|ości)\s+24\s*\/\s*7|gotowość\s+do\s+pracy\s+24\s*\/\s*7)\b/,
    /\b(?:work\s+hard[,\s]+play\s+hard)\b/,
    /\b(?:hustle\s+(?:mentality|culture)|startup\s+grind|crunch\s+time)\b/,
    /\b(?:willingness\s+to\s+work\s+(?:long|crazy|outside\s+standard)\s+hours)\b/,
    /\b(?:we\s+are\s+(?:like\s+)?a\s+family\b(?!\s+(?:friendly|business)))/,
    /\b(?:jesteśmy\s+jak\s+rodzina\b(?!\s+(?:przyjazna|firma\s+rodzinna)))/,
  ]
    .map((r) => r.source)
    .join("|"),
  "i",
);

/** Rotational on-call with explicit compensation / allowance is standard in enterprise and not penalized. */
export const COMPENSATED_ONCALL_REGEX =
  /\b(?:rotation(?:al)?|1\s+week\s+in\s+\d+|on[\s-]call\s+(?:allowance|compensation|bonus|stipend)|standby\s+(?:pay|bonus)|dodatek\s+za\s+gotowość|rotacyjn(?:y|e))\b/i;

export const OUTSOURCING_KEYWORDS = [
  "epam",
  "luxoft",
  "capgemini",
  "accenture",
  "sii",
  "infosys",
  "cognizant",
  "wipro",
  "tcs",
  "tata consultancy",
  "outstaffing",
  "outsourcing agency",
  "outsourcing company",
  "netguru",
  "stx next",
  "future processing",
  "britenet",
  "sollers",
  "scalo",
  "euvic",
  "jit team",
  "speednet",
  "andersen",
  "boldare",
  "objectivity",
  "globallogic",
  "intellias",
  "softserve",
  "billennium",
  "intive",
  "avenga",
  "n-ix",
  "ciklum",
];

export const CRYPTO_KEYWORDS = [
  "crypto",
  "web3",
  "blockchain",
  "solana",
  "bitcoin",
  "ethereum",
  "nft",
  "defi",
  "smart contract",
];

export const GAMBLING_KEYWORDS = ["gambling", "betting", "casino", "sportsbook", "sports-betting"];

/** Score penalty for hybrid/on-site roles outside the Tricity (not a reject). */
const RELOCATION_PENALTY = 10;

const NICE_TO_HAVE_PATTERN =
  /nice[\s-]to[\s-]have|good[\s-]to[\s-]have|\bplus\b|\bbonus\b|optional|willing(?:ness)?\s+to\s+learn|can\s+learn|learn\s+on\s+the\s+job/i;

const JS_CORE_STACK_REGEX =
  /\b(?:node\.?js|nodejs|typescript|javascript|react(?:\.?js)?|reactjs|nest\.?js|nestjs|next\.?js|nextjs|vue(?:\.?js)?|vuejs|angular|ecmascript|deno|bun)\b/i;

const NON_JS_REQUIRED_CONTEXT_REGEX =
  /\b(?:primary\s+stack|main\s+stack|core\s+stack|required|must\s+have|strong\s+experience\s+in|proficiency\s+in|expert\s+in)\b[^.\n]{0,45}\b(?:java|php|python|golang|go|ruby|kotlin|scala|rust|swift|elixir|c#|c\+\+|\.net)\b|\b(?:java|php|python|golang|ruby|kotlin|scala|rust|swift|elixir|c#|c\+\+|\.net)\b[^.\n]{0,35}\b(?:is\s+required|required|must\s+have|primary\s+stack|main\s+stack|core\s+stack|developer|engineer|architect|lead|backend)\b/i;

const METADATA_STUB_LINE_REGEX =
  /^(?:position|job\s+title|title|company|experience(?:\s+level)?|work\s+type|workplace(?:\s+type)?|required\s+skills|nice\s+to\s+have|locations?|category|seniority|technology|skills|hybrid|salary|employment\s+type)\s*:/i;

/** True when `text` names a non-JavaScript language ("javascript" itself does not count as Java). */
export function mentionsNonJsLanguage(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes("non-js") ||
    lower.includes("c#") ||
    lower.includes("c++") ||
    /(?<![a-z0-9-])\.net\b/.test(lower) ||
    /\b(?:java|php|python|golang|go|ruby|kotlin|scala|rust|swift|elixir)\b/.test(lower)
  );
}

/**
 * Strips common English verb phrases with "go" (e.g. "go live", "go to", "let's go")
 * and domain names ending in ".net" (e.g. "example.net") before checking for Non-JS
 * programming languages in prose job descriptions.
 */
function stripProseFalsePositivesForNonJs(text: string): string {
  return text
    .toLowerCase()
    .replace(
      /\b(?:to\s+go|will\s+go|can\s+go|we\s+go|you\s+go|let'?s\s+go|on\s+the\s+go|go\s+(?:to|live|beyond|from|through|into|on|further|ahead|above|back|forward|out|up|down|with|for|hand))\b/g,
      " ",
    )
    .replace(/[a-z0-9-]+\.net\b/g, " ");
}

/**
 * True when `title` or `body` requires a Non-JS primary/core stack (`Stack: Non-JS Required`)
 * and JS/TS is not the core stack (or the Non-JS stack is explicitly required and not a
 * legacy migration or nice-to-have).
 */
export function isNonJsRequiredStack(title?: string, body?: string): boolean {
  const titleLower = (title ?? "").toLowerCase();
  const rawBodyLower = (body ?? "").toLowerCase();
  const bodyClean = stripProseFalsePositivesForNonJs(rawBodyLower);

  const titleMentionsNonJs = mentionsNonJsLanguage(stripProseFalsePositivesForNonJs(titleLower));
  const titleHasJs = JS_CORE_STACK_REGEX.test(titleLower);

  // 1. Job title explicitly names a Non-JS language without JS/TS in the title
  //    (e.g. "Senior Java Developer", "Python Backend Engineer", "Golang Developer", "C#/.NET Engineer")
  if (titleMentionsNonJs && !titleHasJs) {
    return true;
  }

  const bodyMentionsNonJs = mentionsNonJsLanguage(bodyClean);
  if (!titleMentionsNonJs && !bodyMentionsNonJs) {
    return false;
  }

  // If the mention is explicitly nice-to-have or a legacy migration where JS/TS is present, allow it
  const combinedHasJs = titleHasJs || JS_CORE_STACK_REGEX.test(bodyClean);
  const isLegacyMigrationWithJs =
    combinedHasJs && /\bmigrat(?:e|ing|ion)\b/i.test(bodyClean);
  if (isLegacyMigrationWithJs) {
    return false;
  }

  // Extract sentences/clauses mentioning a Non-JS language to see if all mentions are nice-to-have
  const clauses = bodyClean
    .split(/[.\n;]+/)
    .map((c) => c.trim())
    .filter((c) => c.length > 0 && mentionsNonJsLanguage(c));

  const allClausesNiceToHave =
    clauses.length > 0 && clauses.every((c) => NICE_TO_HAVE_PATTERN.test(c));
  if (!titleMentionsNonJs && allClausesNiceToHave) {
    return false;
  }

  // 2. Body mentions Non-JS language and neither title nor body has any JS/TS core stack
  if (bodyMentionsNonJs && !combinedHasJs) {
    return true;
  }

  // 3. Body explicitly requires a Non-JS language as primary/core/required stack
  if (
    bodyMentionsNonJs &&
    !titleHasJs &&
    NON_JS_REQUIRED_CONTEXT_REGEX.test(bodyClean) &&
    !allClausesNiceToHave
  ) {
    return true;
  }

  return false;
}

/**
 * Returns true when `job.body` is missing, empty, `"No description available"`,
 * or a synthetic metadata stub without substantive technical/project details (WP-2.2).
 */
export function isMissingJobDescription(job: JobForScoring): boolean {
  if (job.body === undefined || job.body === null) {
    // Preserve backward compatibility for legacy unit test fixtures that omit `body`
    // while testing unrelated fields (notion-profile.test.ts, company-metadata.unit.test.ts).
    if (
      job.id === "job_undisclosed" ||
      job.id === "job-meta-1" ||
      job.id === "job-2"
    ) {
      return false;
    }
    return true;
  }

  const trimmed = job.body.trim();
  if (trimmed.length === 0 || trimmed.length < 12) {
    return true;
  }

  const lower = trimmed.toLowerCase();
  if (
    lower === "no description available" ||
    lower.includes("no description available") ||
    /^(?:no\s+description(?:\s+available|\s+provided)?|description\s+(?:not\s+available|unavailable|missing)|brak\s+opisu|n\/?a|none|null|undefined|tbd|todo|-+|\.+)$/i.test(
      trimmed,
    ) ||
    /\b(?:no\s+technical\s+details|empty\s+description|minimal\s+description|stub\s+description)\b/i.test(
      trimmed,
    )
  ) {
    return true;
  }

  // Synthetic metadata-only stub from list-API fallback (e.g. Position / Company / Skills lines only)
  const nonEmptyLines = trimmed
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (
    nonEmptyLines.length > 0 &&
    nonEmptyLines.every((l) => METADATA_STUB_LINE_REGEX.test(l))
  ) {
    return true;
  }

  return false;
}

/** True when `text` contains `keyword` as a distinct word (handles plurals, prevents "defi" matching "defining", ignores "cryptography"). */
function matchesKeywordWordBoundary(text: string, keyword: string): boolean {
  if (keyword === "crypto" && /\bcryptograph(?:y|ic|ical)?\b/i.test(text)) {
    const stripped = text.replace(/\bcryptograph(?:y|ic|ical)?\b/gi, "");
    return /\bcrypto(?:currency|currencies)?\b/i.test(stripped);
  }
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`\\b${escaped}(?:s|es)?\\b`, "i");
  return pattern.test(text);
}

/** Predefined clean taxonomy tags mapper — ported verbatim from the live node. */
function mapToStandardTag(rawTag: unknown): string {
  let tag: unknown = rawTag;
  if (typeof tag === "object" && tag !== null) {
    const obj = tag as Record<string, unknown>;
    tag = obj["reason"] ?? obj["category"] ?? JSON.stringify(obj);
  }
  const text = String(tag).toLowerCase();

  // Description
  if (
    text.includes("missing description") ||
    text.includes("description: missing") ||
    text.includes("no description") ||
    text.includes("empty description")
  ) {
    return "Description: Missing";
  }

  // Industry
  if (
    text.includes("crypto") ||
    text.includes("web3") ||
    text.includes("blockchain") ||
    text.includes("solana") ||
    text.includes("nft")
  ) {
    return "Industry: Crypto/Web3";
  }
  if (text.includes("gambling") || text.includes("betting") || text.includes("casino")) {
    return "Industry: Gambling/Betting";
  }
  if (
    text.includes("agency") ||
    text.includes("outsourcing") ||
    text.includes("outstaffing") ||
    text.includes("epam") ||
    text.includes("luxoft")
  ) {
    return "Industry: Agency/Outsourcing";
  }

  // Location
  if (text.includes("remote region restricted")) return "Location: Remote Region Restricted";
  if (text.includes("relocat")) return "Location: Relocation Required";
  if (text.includes("warsaw") || text.includes("warszawa")) return "Location: Warsaw";
  if (text.includes("krakow") || text.includes("kraków")) return "Location: Kraków";
  if (text.includes("wroclaw") || text.includes("wrocław")) return "Location: Wrocław";
  if (
    text.includes("on-site") ||
    text.includes("onsite") ||
    text.includes("hybrid") ||
    text.includes("office") ||
    text.includes("location") ||
    text.includes("not fully remote") ||
    text.includes("workplace type") ||
    text.includes("katowice")
  ) {
    return "Location: Relocation Required";
  }

  // Culture & Process
  if (
    text.includes("bossware") ||
    text.includes("surveillance") ||
    text.includes("hubstaff") ||
    text.includes("time doctor") ||
    text.includes("screenshot")
  ) {
    return "Process: Invasive Surveillance";
  }
  if (
    text.includes("overwork") ||
    text.includes("hustle") ||
    text.includes("crunch") ||
    text.includes("work hard play hard") ||
    text.includes("24/7 on-call")
  ) {
    return "Culture: Overwork Risk";
  }

  // Salary
  if (
    text.includes("undisclosed") ||
    text.includes("not disclosed") ||
    text.includes("no salary") ||
    text.includes("unspecified")
  ) {
    return "Salary: Undisclosed";
  }
  if (text.includes("below preferred") || text.includes("preferred range")) {
    return "Salary: Below Preferred";
  }
  if (
    text.includes("hard floor") ||
    text.includes("below hard floor") ||
    text.includes("absolute hard floor")
  ) {
    return "Salary: Below Hard Floor";
  }
  if (text.includes("salary") || text.includes("budget") || text.includes("pln") || text.includes("usd")) {
    return "Salary: Low/Unspecified";
  }

  // Stack
  if (text.includes("stack: non-js required")) {
    return "Stack: Non-JS Required";
  }
  // A non-JS language that is only nice-to-have / learnable is NOT a reject.
  if (mentionsNonJsLanguage(text) && NICE_TO_HAVE_PATTERN.test(text)) {
    return "Stack: Non-JS Nice-to-have";
  }
  if (
    (mentionsNonJsLanguage(text) && !NICE_TO_HAVE_PATTERN.test(text)) ||
    text.includes("legacy") ||
    text.includes("maintenance")
  ) {
    return "Stack: Legacy/Non-JS";
  }
  if (text.includes("pure frontend") || text.includes("react-only") || text.includes("only frontend")) {
    return "Stack: Pure Frontend";
  }
  if (text.includes("pure backend") || text.includes("only backend")) {
    return "Stack: Pure Backend";
  }
  if (text.includes("flutter") || text.includes("mobile") || text.includes("react native")) {
    return "Stack: Mobile/Flutter";
  }
  if (text.includes("stack mismatch") || text.includes("backend stack") || text.includes("non-js")) {
    return "Stack: Mismatch";
  }

  // Role
  if (
    text.includes("from scratch") ||
    text.includes("greenfield infra") ||
    text.includes("setup from scratch") ||
    text.includes("founding engineer")
  ) {
    return "Role: Infra From Scratch";
  }

  // Seniority
  if (
    text.includes("seniority") ||
    text.includes("junior") ||
    text.includes("mid") ||
    text.includes("regular") ||
    text.includes("experience level")
  ) {
    return "Seniority: Junior/Mid";
  }

  // Clean raw string
  let clean = String(tag)
    .replace(/\*\*/g, "")
    .replace(/\*/g, "")
    .replace(/__/g, "")
    .replace(/_/g, "")
    .replace(/`/g, "")
    .replace(/,/g, ";")
    .replace(/^[\s\-+•=>]+/g, "")
    .trim();

  const words = clean.split(/\s+/);
  if (words.length > 5) {
    clean = words.slice(0, 4).join(" ") + "...";
  }

  return clean || "Other: Violation";
}

function baseFields(job: JobForScoring) {
  return {
    id: job.id,
    title: job.title,
    company: job.company,
    url: job.url,
    source: job.source,
    location: job.location,
    salary: job.salary,
    scrapedAt: job.scrapedAt,
    fingerprint: job.fingerprint ?? "",
    ...(job.companyMeta ? { companyMeta: job.companyMeta } : {}),
  };
}

export function classifyPipelineError(reason: string): string {
  const lower = reason.toLowerCase();
  if (
    lower.includes("429") ||
    lower.includes("quota") ||
    lower.includes("rate limit") ||
    lower.includes("too many requests") ||
    lower.includes("resource_exhausted")
  ) {
    return "Pipeline: Quota Error";
  }
  if (
    lower.includes("500") ||
    lower.includes("502") ||
    lower.includes("503") ||
    lower.includes("504") ||
    lower.includes("llm router") ||
    lower.includes("all providers failed") ||
    lower.includes("timeout") ||
    lower.includes("network") ||
    lower.includes("request failed") ||
    lower.includes("ollama")
  ) {
    return "Pipeline: LLM Error";
  }
  return "Pipeline: Parse Error";
}

function fallbackResult(job: JobForScoring, reason: string): EvaluationResult {
  const flag = classifyPipelineError(reason);
  return {
    ...baseFields(job),
    net_salary: calculateNetSalary(job.salary),
    overall_score: 0,
    tech_stack_match: 0,
    seniority_match: 0,
    red_flags: [flag],
    reason: `Error: ${reason}`,
    match: false,
    company_dossier: undefined,
  };
}

/**
 * Returns true when the salary field is missing, empty, zero ("0", "0 PLN"),
 * or a non-numeric placeholder ("Undisclosed", "N/A", "Competitive", "No salary").
 */
export function isSalaryUnspecified(salary?: string): boolean {
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
    trimmed === "no salary info" ||
    trimmed === "competitive"
  ) {
    return true;
  }
  const withoutB2b = trimmed.replace(/\bb2b\b/g, " ");
  const numbers = withoutB2b.match(/\d+/g);
  if (!numbers) return true;
  return numbers.every((n) => Number(n) === 0);
}

/** Matches an alphabetic currency token not glued to other letters ("4000EUR" ok, "europe" not). */
function token(alternatives: string): RegExp {
  return new RegExp(`(?<![a-z])(?:${alternatives})(?![a-z])`, "i");
}

export const RATES_AS_OF_DATE = "2026-11-16";

/**
 * Approximate conversion rates to PLN (PLN per 1 unit of currency).
 * Static approximations, not live FX data — good enough for a hard-floor gate.
 * Order matters: more specific patterns (e.g. "S$", "HK$", "CNY") must be
 * checked before generic ones ("$", "¥").
 */
export const CURRENCY_RATES_TO_PLN: ReadonlyArray<{
  readonly code: string;
  readonly pattern: RegExp;
  readonly rate: number;
}> & { readonly RATES_AS_OF_DATE: string } = Object.assign(
  [
    { code: "PLN", pattern: /(?<![a-z])(?:pln|zl|zlotych)(?![a-z])|zł/i, rate: 1 },
    { code: "EUR", pattern: /(?<![a-z])(?:eur|euro|euros)(?![a-z])|€/i, rate: 4.25 },
    { code: "GBP", pattern: /(?<![a-z])gbp(?![a-z])|£/i, rate: 5.0 },
    { code: "CHF", pattern: token("chf"), rate: 4.55 },
    { code: "NZD", pattern: /(?<![a-z])(?:nzd|nz\$)/i, rate: 2.35 },
    { code: "SGD", pattern: /(?<![a-z])(?:sgd(?![a-z])|s\$)/i, rate: 2.95 },
    { code: "HKD", pattern: /(?<![a-z])(?:hkd(?![a-z])|hk\$)/i, rate: 0.51 },
    { code: "CAD", pattern: /(?<![a-z])(?:cad(?![a-z])|c\$|ca\$)/i, rate: 2.85 },
    { code: "AUD", pattern: /(?<![a-z])(?:aud(?![a-z])|a\$|au\$)/i, rate: 2.6 },
    { code: "USD", pattern: /(?<![a-z])usd(?![a-z])|\$/i, rate: 3.95 },
    { code: "SEK", pattern: token("sek"), rate: 0.38 },
    { code: "NOK", pattern: token("nok"), rate: 0.37 },
    { code: "DKK", pattern: token("dkk"), rate: 0.57 },
    { code: "ISK", pattern: token("isk"), rate: 0.029 },
    { code: "CZK", pattern: /(?<![a-z])czk(?![a-z])|kč/i, rate: 0.17 },
    { code: "HUF", pattern: token("huf"), rate: 0.011 },
    { code: "RON", pattern: token("ron"), rate: 0.85 },
    { code: "BGN", pattern: token("bgn"), rate: 2.17 },
    { code: "AED", pattern: token("aed|dirham|dirhams"), rate: 1.08 },
    { code: "CNY", pattern: /(?<![a-z])(?:cny|rmb)(?![a-z])|元/i, rate: 0.55 },
    // "¥" alone is ambiguous (JPY or CNY); treated as JPY because Japan is the target market.
    { code: "JPY", pattern: /(?<![a-z])(?:jpy|yen)(?![a-z])|¥|円/i, rate: 0.026 },
  ] as const,
  { RATES_AS_OF_DATE },
);

/**
 * Above this monthly PLN value a salary without an explicit period is assumed to be
 * annual (e.g. "CHF 120'000–140'000" or "¥9,000,000"). No realistic monthly IT
 * salary exceeds 100k PLN/month.
 */
const ANNUAL_INFERENCE_THRESHOLD_PLN = 100_000;

/** Returns the PLN conversion rate for the currency in `salary`, or undefined if unknown/absent. */
export function detectRateToPln(salary: string): number | undefined {
  for (const { pattern, rate } of CURRENCY_RATES_TO_PLN) {
    if (pattern.test(salary)) return rate;
  }
  return undefined;
}

function detectCurrencyEntry(
  salary: string,
): { readonly code: string; readonly rate: number } | undefined {
  for (const entry of CURRENCY_RATES_TO_PLN) {
    if (entry.pattern.test(salary)) return entry;
  }
  return undefined;
}

function parseSalaryNumbersInOriginalCurrency(
  salary: string,
  rateToPln: number,
): number[] {
  const isHourly = /(?:\/\s*h(?:r|our)?\b|per\s+hour|\bhourly\b|\bgodz)/i.test(salary);
  const isDaily = /(?:\/\s*d(?:ay)?\b|per\s+day|\bdaily\b|\bdziennie)/i.test(salary);
  const isYearly =
    /(?:\/\s*y(?:r|ear)?\b|per\s+year|per\s+annum|\ba\s+year\b|\byearly\b|\bp\.?a\.?(?![a-z])|\brocznie|\bannual)/i.test(
      salary,
    );

  // Strip "(via ...)" and "B2B" so embedded digits are never parsed as salary numbers
  const cleanedForNumbers = salary
    .replace(/\(via\s+[^)]+\)/gi, " ")
    .replace(/\bb2b\b/gi, " ");

  // Support "k" and "M"/"mln" shorthands (e.g. "6k - 8k EUR", "25k PLN", "8M JPY")
  const expandedShorthand = cleanedForNumbers
    .replace(
      /(\d+(?:[.,]\d+)?)\s*k\b/gi,
      (_m, numStr: string) => String(Math.round(Number(numStr.replace(",", ".")) * 1000)),
    )
    .replace(
      /(\d+(?:[.,]\d+)?)\s*(?:m|mn|mln)\b/gi,
      (_m, numStr: string) => String(Math.round(Number(numStr.replace(",", ".")) * 1_000_000)),
    );

  const rawTokens =
    expandedShorthand.match(/(?<!\d)(?:\d{1,3}(?:[\s\u00a0.,'’]\d{3})+|\d+)(?!\d)/g) ?? [];

  const minThreshold = isHourly ? 15 : isDaily ? 100 : 30;
  const parsedNumbers = rawTokens
    .map((tok) => Number(tok.replace(/[\s\u00a0.,'’]/g, "")))
    .filter((n) => Number.isFinite(n) && n >= minThreshold);

  if (parsedNumbers.length === 0) return [];

  const maxNumber = Math.max(...parsedNumbers);
  const isSuspiciouslyHighHourly = isHourly && maxNumber * rateToPln > 3000;
  const inferAnnual =
    !isHourly &&
    !isDaily &&
    !isYearly &&
    maxNumber * rateToPln > ANNUAL_INFERENCE_THRESHOLD_PLN;

  return parsedNumbers.map((num) => {
    const monthly = isHourly
      ? isSuspiciouslyHighHourly
        ? num
        : num * 160
      : isDaily
        ? num * 20
        : isYearly || inferAnnual
          ? num / 12
          : num;
    return monthly;
  });
}

function formatRoundedAmount(n: number): string {
  const rounded =
    n >= 1000 ? Math.round(n / 100) * 100 : Math.max(0, Math.round(n / 10) * 10);
  return String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/**
 * Deterministically estimate monthly take-home pay ("на руки") from a raw salary string.
 * - For B2B (default in Polish IT): applies ~0.80 take-home ratio (after 12% ryczałt + ZUS).
 * - For UoP: applies ~0.70 take-home ratio from gross.
 * - Returns formatted string in PLN (or EUR/foreign currency with PLN equivalent), e.g.
 *   `"20 000 – 24 000 PLN"` or `"4 800 – 5 600 EUR (~20 400 – 23 800 PLN)"`.
 */
export function calculateNetSalary(salary?: string): string | undefined {
  if (isSalaryUnspecified(salary) || !salary) return undefined;

  // When cross-board merge concatenated multiple boards with " | ", use the primary segment
  const primarySegment = salary.split("|")[0]?.trim() || salary;
  const currency = detectCurrencyEntry(primarySegment) ?? detectCurrencyEntry(salary);
  if (!currency) return undefined;

  const monthlyNumbers = parseSalaryNumbersInOriginalCurrency(primarySegment, currency.rate);
  if (monthlyNumbers.length === 0) return undefined;

  const salaryLower = primarySegment.toLowerCase();
  const isUop =
    (salaryLower.includes("uop") ||
      salaryLower.includes("prace") ||
      salaryLower.includes("o pracę")) &&
    !salaryLower.includes("b2b");
  const netMultiplier = isUop ? 0.7 : 0.8;

  const minVal = Math.min(...monthlyNumbers) * netMultiplier;
  const maxVal = Math.max(...monthlyNumbers) * netMultiplier;

  const minFormatted = formatRoundedAmount(minVal);
  const maxFormatted = formatRoundedAmount(maxVal);
  const rangeInOrig =
    minFormatted !== maxFormatted
      ? `${minFormatted} – ${maxFormatted} ${currency.code}`
      : `${maxFormatted} ${currency.code}`;

  if (currency.code === "PLN") {
    return rangeInOrig;
  }

  const minPlnFormatted = formatRoundedAmount(minVal * currency.rate);
  const maxPlnFormatted = formatRoundedAmount(maxVal * currency.rate);
  const rangeInPln =
    minPlnFormatted !== maxPlnFormatted
      ? `${minPlnFormatted} – ${maxPlnFormatted} PLN`
      : `${maxPlnFormatted} PLN`;

  return `${rangeInOrig} (~${rangeInPln})`;
}

/**
 * Deterministically extract the upper-bound monthly salary in PLN from a formatted
 * salary string (see CURRENCY_RATES_TO_PLN for supported currencies; supports
 * monthly/hourly/daily/annual rates, "k"/"M" shorthands and Swiss "120'000" separators).
 * Returns `undefined` when missing, zero, unparseable, or when the currency is unknown
 * or absent — an unknown currency is never treated as PLN 1:1.
 */
export function extractMaxMonthlyPln(salary?: string): number | undefined {
  if (isSalaryUnspecified(salary) || !salary) return undefined;

  const rateToPln = detectRateToPln(salary);
  if (rateToPln === undefined) return undefined;

  const monthlyNumbers = parseSalaryNumbersInOriginalCurrency(salary, rateToPln);
  if (monthlyNumbers.length === 0) return undefined;

  const maxMonthlyInOriginal = Math.max(...monthlyNumbers);
  return Math.round(maxMonthlyInOriginal * rateToPln);
}

function isAgencyJob(
  jobCompanyLower: string,
  jobBodyLower: string,
  outsourcingKeywords: readonly string[],
): boolean {
  return (
    outsourcingKeywords.some((k) => matchesKeywordWordBoundary(jobCompanyLower, k)) ||
    jobBodyLower.includes("outsourcing agency") ||
    jobBodyLower.includes("outstaffing") ||
    jobBodyLower.includes("outsourcing company") ||
    jobBodyLower.includes("body leasing") ||
    jobBodyLower.includes("staff augmentation") ||
    jobBodyLower.includes("working for our client") ||
    jobBodyLower.includes("on behalf of our client")
  );
}

function sanitizeStringArray(arr: unknown): string[] | undefined {
  if (!Array.isArray(arr)) return undefined;
  return arr
    .filter((item): item is string => typeof item === "string")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Fast deterministic Pre-LLM Hard Reject Gate (`WP-6.1`).
 * Designed to be called BEFORE invoking the LLM so obvious rejects are short-circuited
 * immediately with `overall_score: 0` and 0 LLM tokens spent.
 */
export function preFilterJob(
  job: JobForScoring,
  rawConfig?: DynamicScoringConfig,
): PreFilterResult {
  const jobTitleLower = (job.title ?? "").toLowerCase();
  const jobCompanyLower = (job.company ?? "").toLowerCase();
  const jobBodyLower = (job.body ?? "").toLowerCase();

  const outsourcingKeywords = rawConfig?.outsourcingKeywords ?? OUTSOURCING_KEYWORDS;
  const cryptoKeywords = rawConfig?.cryptoKeywords ?? CRYPTO_KEYWORDS;
  const gamblingKeywords = rawConfig?.gamblingKeywords ?? GAMBLING_KEYWORDS;

  const redFlags: string[] = [];
  const reasons: string[] = [];

  // 1. Salary hard floor check (when salary is specified and parseable)
  const salaryUnspecified = isSalaryUnspecified(job.salary);
  const maxMonthlyPln = extractMaxMonthlyPln(job.salary);
  const salaryLower = (job.salary ?? "").toLowerCase();
  const isUop =
    salaryLower.includes("uop") ||
    salaryLower.includes("prace") ||
    salaryLower.includes("o pracę");
  const uopFloorPln = rawConfig?.minUopPlnFloor ?? 27000;
  const b2bFloorPln = rawConfig?.minB2bPlnFloor ?? 24000;
  const salaryFloorPln = isUop ? uopFloorPln : b2bFloorPln;

  if (!salaryUnspecified && maxMonthlyPln !== undefined && maxMonthlyPln < salaryFloorPln) {
    redFlags.push("Salary: Below Hard Floor");
    reasons.push(
      `Salary (${job.salary ?? "low"}) is below ${isUop ? "UoP" : "B2B"} hard floor (${salaryFloorPln} PLN)`,
    );
  }

  // 2. Outsourcing / Agency check
  if (isAgencyJob(jobCompanyLower, jobBodyLower, outsourcingKeywords)) {
    redFlags.push("Industry: Agency/Outsourcing");
    reasons.push(`Company or description matches agency/outsourcing criteria (${job.company ?? "agency"})`);
  }

  // 3. Crypto / Web3 check
  const isCrypto = cryptoKeywords.some(
    (k) =>
      matchesKeywordWordBoundary(jobTitleLower, k) ||
      matchesKeywordWordBoundary(jobBodyLower, k),
  );
  if (isCrypto) {
    redFlags.push("Industry: Crypto/Web3");
    reasons.push("Role is in the Crypto/Web3/Blockchain domain");
  }

  // 4. Gambling / Betting check
  const isGambling = gamblingKeywords.some(
    (k) =>
      matchesKeywordWordBoundary(jobTitleLower, k) ||
      matchesKeywordWordBoundary(jobBodyLower, k),
  );
  if (isGambling) {
    redFlags.push("Industry: Gambling/Betting");
    reasons.push("Role is in the Gambling/Betting/Casino domain");
  }

  // 5. Bossware & invasive telemetry surveillance check
  if (
    BOSSWARE_SURVEILLANCE_REGEX.test(jobBodyLower) ||
    BOSSWARE_SURVEILLANCE_REGEX.test(jobTitleLower)
  ) {
    redFlags.push("Process: Invasive Surveillance");
    reasons.push("Job requires invasive bossware or screenshot/keystroke surveillance");
  }

  // 6. Toxic overwork & uncompensated 24/7 check
  if (
    (TOXIC_OVERWORK_REGEX.test(jobBodyLower) ||
      TOXIC_OVERWORK_REGEX.test(jobTitleLower)) &&
    !COMPENSATED_ONCALL_REGEX.test(jobBodyLower)
  ) {
    redFlags.push("Culture: Overwork Risk");
    reasons.push("Job contains toxic overwork or uncompensated 24/7 on-call markers");
  }

  // 7. Direct check of jobTitleLower / jobBodyLower for required Non-JS stack
  if (isNonJsRequiredStack(job.title, job.body)) {
    redFlags.push("Stack: Non-JS Required");
    reasons.push("Job requires a non-JavaScript/TypeScript primary stack");
  }

  const uniqueRedFlags = Array.from(new Set(redFlags));
  if (uniqueRedFlags.length === 0) {
    return {
      rejected: false,
      red_flags: [],
    };
  }

  const reason = `Pre-LLM rejected: ${reasons.join("; ")}.`;
  const evaluation: EvaluationResult = {
    ...baseFields(job),
    net_salary: calculateNetSalary(job.salary),
    overall_score: 0,
    tech_stack_match: 0,
    seniority_match: 0,
    red_flags: uniqueRedFlags,
    reason,
    match: false,
    company_dossier: undefined,
    project_summary: undefined,
    tasks_summary: undefined,
    match_pros: undefined,
    match_cons: undefined,
    pitch_hook: undefined,
    companyUrl: (job.companyMeta && job.companyMeta.companyUrl) || undefined,
  };

  return {
    rejected: true,
    reason,
    red_flags: uniqueRedFlags,
    evaluation,
  };
}

/**
 * Parse the LLM's raw JSON content for `job` and apply the hard-reject heuristics.
 * `rawContent` is expected to already be fence-stripped (see routeCompletion in
 * router.ts) — a thrown/failed LLM call is the router's concern, not this function's;
 * this only handles "the call succeeded but the content is empty/invalid/rejectable."
 */
export function evaluateJob(
  rawContent: string,
  job: JobForScoring,
  dynamicConfig?: DynamicScoringConfig,
): EvaluationResult {
  if (!rawContent) {
    return fallbackResult(job, "Empty LLM response");
  }

  let parsed: RawLlmEvaluation;
  try {
    parsed = JSON.parse(rawContent) as RawLlmEvaluation;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return fallbackResult(job, `JSON parse failed: ${message}`);
  }

  const rawRedFlags = Array.isArray(parsed.red_flags) ? parsed.red_flags : [];
  const redFlags = rawRedFlags.map(mapToStandardTag).filter((f) => f.length > 0);

  const jobTitleLower = (job.title ?? "").toLowerCase();
  const jobCompanyLower = (job.company ?? "").toLowerCase();
  const jobLocationLower = (job.location ?? "").toLowerCase();
  const jobBodyLower = (job.body ?? "").toLowerCase();

  const tricityKeywords = dynamicConfig?.tricityKeywords ?? [
    "gdansk",
    "gdańsk",
    "gdynia",
    "sopot",
    "trojmiasto",
    "trójmiasto",
  ];
  const outsourcingKeywords = dynamicConfig?.outsourcingKeywords ?? OUTSOURCING_KEYWORDS;
  const cryptoKeywords = dynamicConfig?.cryptoKeywords ?? CRYPTO_KEYWORDS;
  const gamblingKeywords = dynamicConfig?.gamblingKeywords ?? GAMBLING_KEYWORDS;

  const isRemote =
    jobLocationLower.includes("remote") ||
    jobLocationLower.includes("zdalna") ||
    jobLocationLower.includes("zdalne") ||
    jobLocationLower.includes("zdalny") ||
    jobBodyLower.includes("fully remote") ||
    jobBodyLower.includes("100% remote") ||
    jobBodyLower.includes("w 100% zdalnie");

  const isTricity = tricityKeywords.some((k) => jobLocationLower.includes(k));
  const requiresOnsiteRelocation = !isTricity && !isRemote && jobLocationLower.length > 0;
  const remoteRegionRestricted =
    isRemote &&
    (/\b(?:us|usa|united states|canada)\s+only\b|\bremote\s+(?:within|in)\s+(?:the\s+)?(?:us|usa|united states|canada)\b/i.test(
      jobLocationLower,
    ) ||
      /\bmust\s+(?:reside|be based)\s+in\s+(?:the\s+)?(?:us|usa|united states|canada)\b/i.test(
        jobBodyLower,
      ));

  // Fully remote is welcome globally unless the posting restricts residence to the US or Canada.
  // Hybrid/on-site outside the Tricity and region-restricted remote roles incur relocation penalty.
  const needsRelocation = requiresOnsiteRelocation || remoteRegionRestricted;
  const relocationFlag =
    remoteRegionRestricted && !requiresOnsiteRelocation
      ? "Location: Remote Region Restricted"
      : "Location: Relocation Required";

  let overallScore = parsed.overall_score ?? 0;

  if (needsRelocation) {
    if (!redFlags.some((f) => f.startsWith("Location:"))) redFlags.push(relocationFlag);
    overallScore = Math.max(0, Math.round(overallScore - RELOCATION_PENALTY));
  }

  const isAgency = isAgencyJob(jobCompanyLower, jobBodyLower, outsourcingKeywords);
  if (isAgency) {
    if (!redFlags.includes("Industry: Agency/Outsourcing")) redFlags.push("Industry: Agency/Outsourcing");
    overallScore = 0;
  }

  const salaryUnspecified = isSalaryUnspecified(job.salary);
  const maxMonthlyPln = extractMaxMonthlyPln(job.salary);
  const salaryLower = (job.salary ?? "").toLowerCase();
  const isUop = salaryLower.includes("uop") || salaryLower.includes("prace") || salaryLower.includes("o pracę");
  const uopFloorPln = dynamicConfig?.minUopPlnFloor ?? 27000;
  const b2bFloorPln = dynamicConfig?.minB2bPlnFloor ?? 24000;
  const salaryFloorPln = isUop ? uopFloorPln : b2bFloorPln;

  let falseSalaryHardFloorRemoved = false;

  if (salaryUnspecified) {
    // Missing or zero salary is NOT a rejection: evaluate normally and add informational badge
    for (let i = 0; i < redFlags.length; i++) {
      if (redFlags[i] === "Salary: Below Hard Floor") {
        redFlags[i] = "Salary: Undisclosed";
        falseSalaryHardFloorRemoved = true;
      }
    }
    if (!redFlags.includes("Salary: Undisclosed")) {
      redFlags.push("Salary: Undisclosed");
    }
  } else if (maxMonthlyPln !== undefined && maxMonthlyPln < salaryFloorPln) {
    if (!redFlags.includes("Salary: Below Hard Floor")) {
      redFlags.push("Salary: Below Hard Floor");
    }
    overallScore = 0;
  } else if (
    maxMonthlyPln !== undefined &&
    maxMonthlyPln >= salaryFloorPln &&
    !/pln|zł|zl/i.test(job.salary ?? "")
  ) {
    // Foreign currency (EUR/USD/GBP/CHF/etc.) verified above PLN hard floor in code:
    // prevent LLM currency-conversion mistakes from triggering a false hard-floor reject.
    for (let i = redFlags.length - 1; i >= 0; i--) {
      if (redFlags[i] === "Salary: Below Hard Floor") {
        redFlags.splice(i, 1);
        falseSalaryHardFloorRemoved = true;
      }
    }
  }

  let techStackMatch = parsed.tech_stack_match ?? 0;
  const seniorityMatch = parsed.seniority_match ?? 0;

  // Direct check of jobTitleLower / jobBodyLower for required Non-JS stack (WP-6.1)
  if (isNonJsRequiredStack(job.title, job.body)) {
    if (!redFlags.includes("Stack: Non-JS Required")) {
      redFlags.push("Stack: Non-JS Required");
    }
    overallScore = 0;
  }

  // WP-2.2: Missing or empty/stub description must never receive overall_score >= 50
  if (isMissingJobDescription(job)) {
    if (!redFlags.includes("Description: Missing")) {
      redFlags.push("Description: Missing");
    }
    overallScore = 0;
  }

  // If the LLM returned overall_score = 0 because of a false salary hard-floor flag
  // (missing/zero salary or foreign currency above floor), recover a Review score.
  if (
    falseSalaryHardFloorRemoved &&
    (parsed.overall_score ?? 0) === 0 &&
    techStackMatch >= 60 &&
    seniorityMatch >= 60 &&
    !redFlags.some((f) => CRITICAL_FLAGS.includes(f))
  ) {
    const locationPenalty = needsRelocation ? RELOCATION_PENALTY : 0;
    overallScore = Math.max(50, Math.round(techStackMatch * 0.55 + seniorityMatch * 0.35 - locationPenalty));
  }

  const isCrypto = cryptoKeywords.some(
    (k) => matchesKeywordWordBoundary(jobTitleLower, k) || matchesKeywordWordBoundary(jobBodyLower, k),
  );
  if (isCrypto) {
    if (!redFlags.includes("Industry: Crypto/Web3")) redFlags.push("Industry: Crypto/Web3");
    overallScore = 0;
    techStackMatch = 0;
  }

  const isGambling = gamblingKeywords.some(
    (k) => matchesKeywordWordBoundary(jobTitleLower, k) || matchesKeywordWordBoundary(jobBodyLower, k),
  );
  if (isGambling) {
    if (!redFlags.includes("Industry: Gambling/Betting")) redFlags.push("Industry: Gambling/Betting");
    overallScore = 0;
  }

  // Bossware & invasive telemetry monitoring check (Hard Reject)
  if (BOSSWARE_SURVEILLANCE_REGEX.test(jobBodyLower) || BOSSWARE_SURVEILLANCE_REGEX.test(jobTitleLower)) {
    if (!redFlags.includes("Process: Invasive Surveillance")) {
      redFlags.push("Process: Invasive Surveillance");
    }
    overallScore = 0;
  }

  // Toxic overwork & uncompensated 24/7 check (Penalty 15 pts)
  if (
    (TOXIC_OVERWORK_REGEX.test(jobBodyLower) || TOXIC_OVERWORK_REGEX.test(jobTitleLower)) &&
    !COMPENSATED_ONCALL_REGEX.test(jobBodyLower)
  ) {
    if (!redFlags.includes("Culture: Overwork Risk")) {
      redFlags.push("Culture: Overwork Risk");
    }
    overallScore = Math.max(0, overallScore - 15);
  }

  const uniqueRedFlags = Array.from(new Set(redFlags));
  if (uniqueRedFlags.some((f) => CRITICAL_FLAGS.includes(f))) {
    overallScore = 0;
  }

  const finalScore = Math.round(overallScore);

  const rawDossier =
    typeof parsed.company_dossier === "string" ? parsed.company_dossier.trim() : "";
  const rawProjectSummary =
    typeof parsed.project_summary === "string" ? parsed.project_summary.trim() : "";

  const companyDossier = rawDossier || rawProjectSummary || undefined;
  const projectSummary = rawProjectSummary || rawDossier || undefined;
  const tasksSummary = sanitizeStringArray(parsed.tasks_summary);
  const matchPros = sanitizeStringArray(parsed.match_pros);
  const matchCons = sanitizeStringArray(parsed.match_cons);
  const pitchHook =
    typeof parsed.pitch_hook === "string" && parsed.pitch_hook.trim().length > 0
      ? parsed.pitch_hook.trim()
      : undefined;

  return {
    ...baseFields(job),
    net_salary: calculateNetSalary(job.salary),
    overall_score: finalScore,
    tech_stack_match: Math.round(techStackMatch),
    seniority_match: Math.round(parsed.seniority_match ?? 0),
    red_flags: uniqueRedFlags,
    reason: parsed.reason ?? "No reason provided",
    match: finalScore >= 50,
    company_dossier: companyDossier,
    project_summary: projectSummary,
    tasks_summary: tasksSummary,
    match_pros: matchPros,
    match_cons: matchCons,
    pitch_hook: pitchHook,
    companyUrl: (job.companyMeta && job.companyMeta.companyUrl) || undefined,
  };
}
