/**
 * End-to-End TypeScript Evaluation Harness & Notion Data Flywheel.
 *
 * Provides:
 * 1. Deterministic `reason` validation (replacing paid LLM-rubric calls).
 * 2. SHA-256 disk response caching (`EvalResponseCache`) to avoid burning free-tier
 *    quotas when re-running unchanged prompts/jobs.
 * 3. Full end-to-end execution (`routeCompletion` + `evaluateJob` from `scoring.ts`)
 *    so programmatic hard-reject rules are tested alongside the prompt.
 * 4. Data Flywheel importer from the Notion Evaluation Log database (`Wrong – Should Match`
 *    and `Wrong – Should Reject` rows -> `HarnessTestCase` regression cases).
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import type { DynamicScoringConfig, NotionClientOptions } from "./notion-profile";
import { routeCompletion } from "./router";
import { evaluateJob, type EvaluationResult, type JobForScoring } from "./scoring";

const GENERIC_BOILERPLATE_PHRASES = [
  "does not match the candidate's profile",
  "strong match for the candidate's preferred stack",
  "good fit",
] as const;

const CONCRETE_DOMAIN_TOKEN_REGEX =
  /(node|react|typescript|javascript|nest|next|postgres|java|php|\.net|c#|python|go|ruby|angular|vue|aws|docker|remote|gdańsk|gdansk|tricity|warsaw|kraków|krakow|wrocław|wroclaw|poland|eu|hybrid|on-site|onsite|pln|eur|usd|b2b|uop|gross|net|salary|floor|\d+k|senior|lead|principal|staff|architect|junior|mid|regular|intern|crypto|web3|blockchain|solana|gambling|betting|casino|outsourc|outstaff|agency|epam|luxoft|netguru|legacy|migration|spam|invalid|stack)/i;

/**
 * Deterministically validate that the evaluation `reason` is concise, non-boilerplate,
 * and cites at least one concrete domain token (stack, location, salary, seniority, or industry).
 */
export function validateReasonDeterministically(reason: string): {
  valid: boolean;
  error?: string;
} {
  const trimmed = reason.trim();

  if (trimmed.length < 15 || trimmed.length > 320) {
    return {
      valid: false,
      error: `Reason length (${trimmed.length}) must be between 15 and 320 characters`,
    };
  }

  const lower = trimmed.toLowerCase();
  for (const phrase of GENERIC_BOILERPLATE_PHRASES) {
    if (lower.includes(phrase)) {
      return {
        valid: false,
        error: `Reason contains generic boilerplate phrase: "${phrase}"`,
      };
    }
  }

  if (!CONCRETE_DOMAIN_TOKEN_REGEX.test(trimmed)) {
    return {
      valid: false,
      error:
        "Reason must reference at least one concrete domain token (stack, location, salary, seniority, or red flag)",
    };
  }

  return { valid: true };
}

/**
 * Compute a deterministic SHA-256 cache key for an evaluation request.
 */
export function computeEvalCacheKey(
  systemPrompt: string,
  userMessage: string,
  modelHint?: string,
): string {
  const payload = JSON.stringify({
    systemPrompt,
    userMessage,
    modelHint: modelHint ?? "",
  });
  return crypto.createHash("sha256").update(payload, "utf-8").digest("hex");
}

export interface EvalCacheEntry {
  readonly content: string;
  readonly provider: string;
  readonly cachedAt: string;
}

/**
 * Disk-backed JSON response cache for LLM evaluation completions.
 */
export class EvalResponseCache {
  private readonly filePath: string;
  private store: Record<string, EvalCacheEntry>;

  constructor(filePath?: string) {
    this.filePath = filePath ?? path.resolve(__dirname, "../prompts/.eval-cache.json");
    this.store = this.loadFromDisk();
  }

  private loadFromDisk(): Record<string, EvalCacheEntry> {
    if (!fs.existsSync(this.filePath)) {
      return {};
    }
    try {
      const raw = fs.readFileSync(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, EvalCacheEntry>;
      }
      return {};
    } catch {
      return {};
    }
  }

  private saveToDisk(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.filePath, JSON.stringify(this.store, null, 2), "utf-8");
  }

  public get(key: string): EvalCacheEntry | undefined {
    return this.store[key];
  }

  public set(
    key: string,
    entry: { content: string; provider: string; cachedAt?: string },
  ): void {
    this.store[key] = {
      content: entry.content,
      provider: entry.provider,
      cachedAt: entry.cachedAt ?? new Date().toISOString(),
    };
    this.saveToDisk();
  }

  public has(key: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.store, key);
  }

  public getFilePath(): string {
    return this.filePath;
  }
}

export interface HarnessTestCase {
  readonly id: string;
  readonly description: string;
  readonly job: JobForScoring;
  readonly expectedMatch?: boolean;
  readonly minScore?: number;
  readonly maxScore?: number;
  readonly requiredRedFlags?: readonly string[];
}

export function formatJobUserMessage(job: JobForScoring): string {
  return [
    `Job Title: ${job.title ?? ""}`,
    `Company: ${job.company ?? ""}`,
    `Location: ${job.location ?? ""}`,
    `Salary: ${job.salary ?? ""}`,
    `URL: ${job.url}`,
    "",
    "Job Description:",
    job.body ?? "",
  ].join("\n");
}

/**
 * Run a single evaluation test case through the LLM router (or disk cache)
 * and the deterministic `evaluateJob` scoring pipeline.
 */
export async function runHarnessCase(
  testCase: HarnessTestCase,
  options: {
    systemPrompt: string;
    outputSchema: object;
    scoringConfig?: DynamicScoringConfig;
    cache?: EvalResponseCache;
    useCache?: boolean;
    completeFn?: typeof routeCompletion;
  },
): Promise<{
  passed: boolean;
  failures: string[];
  result: EvaluationResult;
  cached: boolean;
  provider: string;
}> {
  const userMessage = formatJobUserMessage(testCase.job);
  const useCache = options.useCache !== false && options.cache !== undefined;
  const cacheKey = computeEvalCacheKey(options.systemPrompt, userMessage);

  let rawContent: string;
  let provider: string;
  let cached = false;

  const cachedEntry = useCache && options.cache ? options.cache.get(cacheKey) : undefined;
  if (cachedEntry !== undefined) {
    rawContent = cachedEntry.content;
    provider = cachedEntry.provider;
    cached = true;
  } else {
    const complete = options.completeFn ?? routeCompletion;
    const response = await complete({
      systemPrompt: options.systemPrompt,
      userMessage,
      outputSchema: options.outputSchema,
    });
    rawContent = response.content;
    provider = response.provider;
    if (useCache && options.cache) {
      options.cache.set(cacheKey, { content: rawContent, provider });
    }
  }

  const result = evaluateJob(rawContent, testCase.job, options.scoringConfig);
  const failures: string[] = [];

  const reasonCheck = validateReasonDeterministically(result.reason);
  if (!reasonCheck.valid) {
    failures.push(`Invalid reason: ${reasonCheck.error ?? "unknown reason error"}`);
  }

  if (testCase.expectedMatch !== undefined && result.match !== testCase.expectedMatch) {
    failures.push(
      `Expected match=${String(testCase.expectedMatch)}, got match=${String(result.match)} (score=${result.overall_score})`,
    );
  }

  if (testCase.minScore !== undefined && result.overall_score < testCase.minScore) {
    failures.push(
      `Expected overall_score >= ${testCase.minScore}, got ${result.overall_score}`,
    );
  }

  if (testCase.maxScore !== undefined && result.overall_score > testCase.maxScore) {
    failures.push(
      `Expected overall_score <= ${testCase.maxScore}, got ${result.overall_score}`,
    );
  }

  if (testCase.requiredRedFlags && testCase.requiredRedFlags.length > 0) {
    for (const requiredFlag of testCase.requiredRedFlags) {
      if (!result.red_flags.includes(requiredFlag)) {
        failures.push(
          `Missing required red flag "${requiredFlag}" in [${result.red_flags.join(", ")}]`,
        );
      }
    }
  }

  return {
    passed: failures.length === 0,
    failures,
    result,
    cached,
    provider,
  };
}

// ─── Notion Evaluation Log Data Flywheel ─────────────────────────────────────

export interface NotionWrongVerdictRow {
  readonly pageId: string;
  readonly title: string;
  readonly company: string;
  readonly url: string;
  readonly source: string;
  readonly humanVerdict: "Wrong – Should Match" | "Wrong – Should Reject";
  readonly llmScore: number;
  readonly llmReason: string;
  readonly tags: readonly string[];
}

function readNotionTitle(prop: unknown): string {
  const arr = (prop as { title?: Array<{ plain_text?: string }> } | undefined)?.title;
  return Array.isArray(arr) ? arr.map((t) => t.plain_text ?? "").join("") : "";
}

function readNotionRichText(prop: unknown): string {
  const arr = (prop as { rich_text?: Array<{ plain_text?: string }> } | undefined)?.rich_text;
  return Array.isArray(arr) ? arr.map((t) => t.plain_text ?? "").join("") : "";
}

function readNotionSelect(prop: unknown): string {
  return (prop as { select?: { name?: string } } | undefined)?.select?.name ?? "";
}

function readNotionMultiSelect(prop: unknown): string[] {
  const arr = (prop as { multi_select?: Array<{ name?: string }> } | undefined)?.multi_select;
  return Array.isArray(arr) ? arr.map((x) => x.name ?? "").filter(Boolean) : [];
}

function readNotionNumber(prop: unknown, fallback: number): number {
  const n = (prop as { number?: number | null } | undefined)?.number;
  return typeof n === "number" ? n : fallback;
}

function readNotionUrl(prop: unknown): string {
  const u = (prop as { url?: string | null } | undefined)?.url;
  if (typeof u === "string" && u.length > 0) return u;
  return readNotionRichText(prop);
}

/**
 * Query the Notion Evaluation Log database for rows where `"Human Verdict"` is
 * `"Wrong – Should Match"` or `"Wrong – Should Reject"`.
 */
export async function fetchWrongVerdictsFromNotion(
  opts: NotionClientOptions,
  evalLogDbId: string,
): Promise<NotionWrongVerdictRow[]> {
  const fetchFn = opts.fetchImpl ?? fetch;
  const cleanDbId = evalLogDbId.replace(/-/g, "");
  const url = `https://api.notion.com/v1/databases/${cleanDbId}/query`;

  const response = await fetchFn(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.token}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      filter: {
        or: [
          {
            property: "Human Verdict",
            select: { equals: "Wrong – Should Match" },
          },
          {
            property: "Human Verdict",
            select: { equals: "Wrong – Should Reject" },
          },
        ],
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(
      `Notion Evaluation Log query failed (${response.status}): ${errText.slice(0, 300)}`,
    );
  }

  interface NotionQueryResult {
    results?: Array<{
      id: string;
      properties?: Record<string, unknown>;
    }>;
  }

  const data = (await response.json()) as NotionQueryResult;
  const rows: NotionWrongVerdictRow[] = [];

  for (const page of data.results ?? []) {
    const p = page.properties ?? {};
    const verdictRaw = readNotionSelect(p["Human Verdict"]);
    if (
      verdictRaw !== "Wrong – Should Match" &&
      verdictRaw !== "Wrong – Should Reject"
    ) {
      continue;
    }

    const title =
      readNotionTitle(p["Job Title"] ?? p["Title"] ?? p["Name"]) || "Untitled Job";
    const company =
      readNotionRichText(p["Company"]) || readNotionSelect(p["Company"]) || "Unknown Company";
    const jobUrl =
      readNotionUrl(p["URL"] ?? p["Job URL"] ?? p["Link"]) || "https://example.com";
    const source =
      readNotionSelect(p["Source"]) || readNotionRichText(p["Source"]) || "notion-flywheel";
    const llmScore = readNotionNumber(p["LLM Score"] ?? p["Score"] ?? p["Overall Score"], 0);
    const llmReason =
      readNotionRichText(p["LLM Reason"] ?? p["Reason"]) || "";
    const tags = readNotionMultiSelect(p["Red Flags"] ?? p["Tags"]);

    rows.push({
      pageId: page.id,
      title,
      company,
      url: jobUrl,
      source,
      humanVerdict: verdictRaw,
      llmScore,
      llmReason,
      tags,
    });
  }

  return rows;
}

/**
 * Convert a human-corrected Notion Evaluation Log row into a regression `HarnessTestCase`.
 */
export function convertVerdictRowToEvalCase(row: NotionWrongVerdictRow): HarnessTestCase {
  const shouldMatch = row.humanVerdict === "Wrong – Should Match";
  return {
    id: "flywheel_" + row.pageId.slice(0, 8),
    description: `[Flywheel ${row.humanVerdict}] ${row.title} @ ${row.company} (prev LLM score=${row.llmScore})`,
    job: {
      id: "flywheel_" + row.pageId.slice(0, 8),
      title: row.title,
      company: row.company,
      url: row.url,
      source: row.source,
      body: row.llmReason,
    },
    expectedMatch: shouldMatch,
    minScore: shouldMatch ? 50 : 0,
    maxScore: shouldMatch ? 100 : 49,
  };
}
