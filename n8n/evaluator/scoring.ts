/**
 * Job-evaluation scoring: parses the LLM's raw JSON response and enforces the
 * programmatic hard-reject rules on top of it.
 *
 * Ports the live n8n "Code: Parse Ollama Response" node (see ADR-019,
 * context/decisions.yaml), captured directly from the n8n API on 2026-10-05 —
 * not from any prior assumption about what it does. Notably, the real rules differ
 * from what context/ingest-workflow.yaml documented: there is no hard reject for
 * "wrong location"; relocation costs a flat 10-point penalty. Explicit salary floors
 * are enforced programmatically after converting recognized currencies to PLN; unknown
 * or missing currencies are never compared 1:1 with PLN.
 *
 * 2026-11 rule change (diverges from the live node until redeployed): fully remote
 * roles in any country get no location penalty; hybrid/on-site outside the Tricity
 * gets "Location: Relocation Required" and a flat RELOCATION_PENALTY. Salaries are
 * converted to PLN via CURRENCY_RATES_TO_PLN (unknown currency → no code floor check,
 * never 1:1). A non-JS language is critical only when required; "nice-to-have"
 * mentions map to the non-critical "Stack: Non-JS Nice-to-have", and "javascript"
 * no longer matches the Java check.
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
  readonly scrapedAt?: string;
  readonly fingerprint: string;
  readonly overall_score: number;
  readonly tech_stack_match: number;
  readonly seniority_match: number;
  readonly red_flags: string[];
  readonly reason: string;
  readonly match: boolean;
  readonly company_dossier?: string;
  readonly companyMeta?: CompanyMetadata;
}

interface RawLlmEvaluation {
  overall_score?: number;
  tech_stack_match?: number;
  seniority_match?: number;
  red_flags?: unknown[];
  reason?: string;
  company_dossier?: string;
}

const CRITICAL_FLAGS = [
  "Industry: Crypto/Web3",
  "Industry: Gambling/Betting",
  "Industry: Agency/Outsourcing",
  "Salary: Below Hard Floor",
];

const OUTSOURCING_KEYWORDS = [
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

const CRYPTO_KEYWORDS = [
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

const GAMBLING_KEYWORDS = ["gambling", "betting", "casino", "sportsbook", "sports-betting"];

/** Score penalty for hybrid/on-site roles outside the Tricity (not a reject). */
const RELOCATION_PENALTY = 10;

const NICE_TO_HAVE_PATTERN =
  /nice[\s-]to[\s-]have|good[\s-]to[\s-]have|\bplus\b|\bbonus\b|optional|willing(?:ness)?\s+to\s+learn|can\s+learn|learn\s+on\s+the\s+job/;

/** True when `text` names a non-JavaScript language ("javascript" itself does not count as Java). */
function mentionsNonJsLanguage(text: string): boolean {
  return (
    text.includes("non-js") ||
    text.includes("c#") ||
    text.includes("c++") ||
    text.includes(".net") ||
    /\b(?:java|php|python|golang|go|ruby|kotlin|scala|rust|swift|elixir)\b/.test(text)
  );
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

  // Salary
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

function fallbackResult(job: JobForScoring, reason: string): EvaluationResult {
  // Ported verbatim: the live node only checks for "ollama" (a leftover from when
  // Ollama was the only provider), not "llm" in general — so with today's providers
  // (openrouter/gemini) this branch is effectively always false and these fallbacks
  // always resolve to "Pipeline: Parse Error". Not widening this on purpose — the
  // point of this module is to capture live reality, not what seems more "correct."
  const isLlmError = reason.toLowerCase().includes("ollama");
  return {
    ...baseFields(job),
    overall_score: 0,
    tech_stack_match: 0,
    seniority_match: 0,
    red_flags: [isLlmError ? "Pipeline: LLM Error" : "Pipeline: Parse Error"],
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

/**
 * Approximate conversion rates to PLN (PLN per 1 unit of currency).
 * Static approximations, not live FX data — good enough for a hard-floor gate.
 * Order matters: more specific patterns (e.g. "S$", "HK$", "CNY") must be
 * checked before generic ones ("$", "¥").
 */
const CURRENCY_RATES_TO_PLN: ReadonlyArray<{ readonly code: string; readonly pattern: RegExp; readonly rate: number }> = [
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
];

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

  if (parsedNumbers.length === 0) return undefined;

  const maxNumber = Math.max(...parsedNumbers);
  const monthlyInOriginalCurrency = isHourly
    ? maxNumber * 160
    : isDaily
      ? maxNumber * 20
      : isYearly
        ? maxNumber / 12
        : maxNumber;

  let monthlyPln = monthlyInOriginalCurrency * rateToPln;
  if (!isHourly && !isDaily && !isYearly && monthlyPln > ANNUAL_INFERENCE_THRESHOLD_PLN) {
    monthlyPln = monthlyPln / 12;
  }

  return Math.round(monthlyPln);
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

  const isAgency =
    outsourcingKeywords.some((k) => matchesKeywordWordBoundary(jobCompanyLower, k)) ||
    jobBodyLower.includes("outsourcing agency") ||
    jobBodyLower.includes("outstaffing") ||
    jobBodyLower.includes("outsourcing company") ||
    jobBodyLower.includes("body leasing") ||
    jobBodyLower.includes("staff augmentation") ||
    jobBodyLower.includes("working for our client") ||
    jobBodyLower.includes("on behalf of our client");
  if (isAgency) {
    if (!redFlags.includes("Industry: Agency/Outsourcing")) redFlags.push("Industry: Agency/Outsourcing");
    overallScore = 0;
  }

  const salaryUnspecified = isSalaryUnspecified(job.salary);
  const maxMonthlyPln = extractMaxMonthlyPln(job.salary);
  const salaryLower = (job.salary ?? "").toLowerCase();
  const salaryFloorPln =
    dynamicConfig?.minB2bPlnFloor ??
    (salaryLower.includes("uop") ? 28000 : salaryLower.includes("b2b") ? 22000 : 18000);

  let falseSalaryHardFloorRemoved = false;

  if (salaryUnspecified) {
    // Missing or zero salary must NEVER trigger a hard-floor reject (score = 0).
    // Downgrade any LLM-emitted "Salary: Below Hard Floor" to a non-critical red flag
    // and ensure the offer carries the "Salary: Low/Unspecified" warning flag.
    for (let i = 0; i < redFlags.length; i++) {
      if (redFlags[i] === "Salary: Below Hard Floor") {
        redFlags[i] = "Salary: Low/Unspecified";
        falseSalaryHardFloorRemoved = true;
      }
    }
    if (!redFlags.some((f) => f.startsWith("Salary:"))) {
      redFlags.push("Salary: Low/Unspecified");
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

  const uniqueRedFlags = Array.from(new Set(redFlags));
  // If the stack contains non-JS technologies, route to Review (cap at 75) rather than hard-rejecting to 0
  if (uniqueRedFlags.includes("Stack: Legacy/Non-JS") && overallScore >= 80) {
    overallScore = 75;
  }
  if (uniqueRedFlags.some((f) => CRITICAL_FLAGS.includes(f))) {
    overallScore = 0;
  }

  const finalScore = Math.round(overallScore);

  return {
    ...baseFields(job),
    overall_score: finalScore,
    tech_stack_match: Math.round(techStackMatch),
    seniority_match: Math.round(parsed.seniority_match ?? 0),
    red_flags: uniqueRedFlags,
    reason: parsed.reason ?? "No reason provided",
    match: finalScore >= 50,
    company_dossier: parsed.company_dossier?.trim() || undefined,
  };
}
