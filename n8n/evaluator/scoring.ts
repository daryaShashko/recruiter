/**
 * Job-evaluation scoring: parses the LLM's raw JSON response and enforces the
 * programmatic hard-reject rules on top of it.
 *
 * Ports the live n8n "Code: Parse Ollama Response" node (see ADR-019,
 * context/decisions.yaml), captured directly from the n8n API on 2026-10-05 —
 * not from any prior assumption about what it does. Notably, the real rules differ
 * from what context/ingest-workflow.yaml documented: there is no hard reject for
 * "wrong location" (missing Tricity/remote only costs a 10-20 point penalty), and
 * the salary hard floor is enforced only if the LLM itself reports it as a red flag
 * (which then maps to the "Salary: Below Hard Floor" critical tag) — there is no
 * programmatic numeric salary check here.
 */

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
}

interface RawLlmEvaluation {
  overall_score?: number;
  tech_stack_match?: number;
  seniority_match?: number;
  red_flags?: unknown[];
  reason?: string;
}

const CRITICAL_FLAGS = [
  "Industry: Crypto/Web3",
  "Industry: Gambling/Betting",
  "Industry: Agency/Outsourcing",
  "Salary: Below Hard Floor",
  "Stack: Legacy/Non-JS",
  "Stack: Pure Backend",
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
  if (
    text.includes("legacy") ||
    text.includes("maintenance") ||
    text.includes("php") ||
    text.includes("java") ||
    text.includes("c++") ||
    text.includes("c#")
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
  };
}

/**
 * Parse the LLM's raw JSON content for `job` and apply the hard-reject heuristics.
 * `rawContent` is expected to already be fence-stripped (see routeCompletion in
 * router.ts) — a thrown/failed LLM call is the router's concern, not this function's;
 * this only handles "the call succeeded but the content is empty/invalid/rejectable."
 */
export function evaluateJob(rawContent: string, job: JobForScoring): EvaluationResult {
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

  const isRemote =
    jobLocationLower.includes("remote") ||
    jobLocationLower.includes("zdalna") ||
    jobLocationLower.includes("zdalne") ||
    jobLocationLower.includes("zdalny") ||
    jobBodyLower.includes("fully remote") ||
    jobBodyLower.includes("100% remote") ||
    jobBodyLower.includes("w 100% zdalnie");

  const isTricity =
    jobLocationLower.includes("gdansk") ||
    jobLocationLower.includes("gdańsk") ||
    jobLocationLower.includes("gdynia") ||
    jobLocationLower.includes("sopot") ||
    jobLocationLower.includes("trojmiasto") ||
    jobLocationLower.includes("trójmiasto");

  // Location: no city is a hard reject — a 10-20 point penalty only.
  const hasRemoteOption =
    isRemote || jobLocationLower.includes("hybrid") || jobBodyLower.includes("hybrid") || jobBodyLower.includes("remote");

  let overallScore = parsed.overall_score ?? 0;

  if (!isTricity && jobLocationLower.length > 0) {
    if (!redFlags.some((f) => f.startsWith("Location:"))) redFlags.push("Location: Relocation Required");
    const penalty = hasRemoteOption ? 10 : 20;
    overallScore = Math.max(0, Math.round(overallScore - penalty));
  }

  const isAgency =
    OUTSOURCING_KEYWORDS.some((k) => jobCompanyLower.includes(k)) ||
    jobBodyLower.includes("outsourcing agency") ||
    jobBodyLower.includes("outstaffing") ||
    jobBodyLower.includes("outsourcing company");
  if (isAgency) {
    if (!redFlags.includes("Industry: Agency/Outsourcing")) redFlags.push("Industry: Agency/Outsourcing");
    overallScore = 0;
  }

  let techStackMatch = parsed.tech_stack_match ?? 0;

  const isCrypto = CRYPTO_KEYWORDS.some((k) => jobTitleLower.includes(k) || jobBodyLower.includes(k));
  if (isCrypto) {
    if (!redFlags.includes("Industry: Crypto/Web3")) redFlags.push("Industry: Crypto/Web3");
    overallScore = 0;
    techStackMatch = 0;
  }

  const isGambling = GAMBLING_KEYWORDS.some((k) => jobTitleLower.includes(k) || jobBodyLower.includes(k));
  if (isGambling) {
    if (!redFlags.includes("Industry: Gambling/Betting")) redFlags.push("Industry: Gambling/Betting");
    overallScore = 0;
  }

  const uniqueRedFlags = Array.from(new Set(redFlags));
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
  };
}
