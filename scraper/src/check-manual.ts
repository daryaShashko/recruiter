/**
 * CLI utility to manually submit a single job offer into the n8n evaluation pipeline.
 *
 * Usage — URL only (Playwright scrapes the page automatically):
 *   ts-node src/check-manual.ts --url "https://justjoin.it/job-offer/..."
 *   ts-node src/check-manual.ts --url "https://nofluffjobs.com/pl/praca/..."
 *   ts-node src/check-manual.ts --url "https://any-job-board.com/job/..."
 *
 * Usage — full manual flags:
 *   ts-node src/check-manual.ts --url "..." --title "..." --company "..." --body "..."
 *
 * Usage — JSON file:
 *   ts-node src/check-manual.ts job.json
 *
 * JSON file shape:
 *   { "url": "...", "title": "...", "company": "...", "body": "...",
 *     "location": "...", "salary": "...", "tags": ["React", "TypeScript"] }
 */

import * as fs from "fs";
import * as path from "path";
import type { Page } from "playwright";
import { JobOffer } from "./types";
import { sendToWebhook } from "./sender";
import { validateConfig } from "./config";
import { openPage, closeBrowser } from "./utils/browser";

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface ManualJobInput {
  url: string;
  title: string;
  company: string;
  body: string;
  location?: string;
  salary?: string;
  tags?: string[];
}

// ─── Type guards ──────────────────────────────────────────────────────────────

function isString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

// ─── Input parsers ────────────────────────────────────────────────────────────

function parseJsonFile(filePath: string): ManualJobInput {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) throw new Error(`File not found: ${resolved}`);

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(resolved, "utf-8"));
  } catch {
    throw new Error(`Failed to parse JSON from: ${resolved}`);
  }

  if (typeof raw !== "object" || raw === null)
    throw new Error("JSON file must contain an object");

  const obj = raw as Record<string, unknown>;
  if (!isString(obj["url"])) throw new Error('Missing or empty field: "url"');
  if (!isString(obj["title"]))
    throw new Error('Missing or empty field: "title"');
  if (!isString(obj["company"]))
    throw new Error('Missing or empty field: "company"');
  if (!isString(obj["body"])) throw new Error('Missing or empty field: "body"');

  return {
    url: obj["url"],
    title: obj["title"],
    company: obj["company"],
    body: obj["body"],
    location: isString(obj["location"]) ? obj["location"] : undefined,
    salary: isString(obj["salary"]) ? obj["salary"] : undefined,
    tags: isStringArray(obj["tags"]) ? obj["tags"] : undefined,
  };
}

function getFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function getAllFlags(args: string[], flag: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag && i + 1 < args.length) values.push(args[i + 1]);
  }
  return values;
}

function parseFlags(args: string[]): ManualJobInput | { urlOnly: string } {
  const url = getFlag(args, "--url");
  if (!url) throw new Error("Missing required flag: --url");

  const title = getFlag(args, "--title");
  const company = getFlag(args, "--company");
  const body = getFlag(args, "--body");

  // URL-only mode: only --url provided, no --body
  if (!title && !company && !body) {
    return { urlOnly: url };
  }

  if (!title) throw new Error("Missing required flag: --title");
  if (!company) throw new Error("Missing required flag: --company");
  if (!body) throw new Error("Missing required flag: --body");

  const tags = getAllFlags(args, "--tag");

  return {
    url,
    title,
    company,
    body,
    location: getFlag(args, "--location"),
    salary: getFlag(args, "--salary"),
    tags: tags.length > 0 ? tags : undefined,
  };
}

function isUrlOnly(input: unknown): input is { urlOnly: string } {
  return typeof input === "object" && input !== null && "urlOnly" in input;
}

// ─── JustJoin single-offer API ────────────────────────────────────────────────

interface RawJJSkill {
  name: string;
  level: number;
}
interface RawJJEmploymentType {
  from?: number;
  to?: number;
  currency: string;
  currencySource: string;
  type: string;
  unit: string;
}
interface RawJJLocation {
  city: string;
}
interface RawJJOffer {
  title?: string;
  companyName?: string;
  workplaceType?: string;
  experienceLevel?: string;
  city?: string;
  locations?: RawJJLocation[];
  requiredSkills?: RawJJSkill[];
  niceToHaveSkills?: RawJJSkill[];
  employmentTypes?: RawJJEmploymentType[];
}

function buildJJBody(offer: RawJJOffer, url: string): string {
  const lines: string[] = [];
  if (offer.title) lines.push(`Position: ${offer.title}`);
  if (offer.companyName) lines.push(`Company: ${offer.companyName}`);
  if (offer.experienceLevel)
    lines.push(`Experience level: ${offer.experienceLevel}`);
  if (offer.workplaceType) lines.push(`Work type: ${offer.workplaceType}`);

  const required = offer.requiredSkills ?? [];
  if (required.length) {
    const skills = required
      .sort((a, b) => b.level - a.level)
      .map((s) => `${s.name} (${s.level}/5)`)
      .join(", ");
    lines.push(`Required skills: ${skills}`);
  }

  const nice = offer.niceToHaveSkills ?? [];
  if (nice.length) {
    lines.push(`Nice to have: ${nice.map((s) => s.name).join(", ")}`);
  }

  const cities = (offer.locations ?? []).map((l) => l.city).join(", ");
  if (cities) lines.push(`Locations: ${cities}`);

  lines.push(`URL: ${url}`);
  return lines.join("\n");
}

function extractJJSalary(types: RawJJEmploymentType[]): string | undefined {
  const pln = types.filter(
    (e) => e.currency === "PLN" && e.currencySource === "original",
  );
  const best =
    pln.find((e) => e.type === "b2b" && e.unit === "Month") ??
    pln.find((e) => e.unit === "Month") ??
    pln[0];
  if (!best?.from || !best?.to) return undefined;
  const unitLabel = best.unit === "Hour" ? "/h" : "/mo";
  const typeLabel = best.type === "b2b" ? "B2B" : best.type.toUpperCase();
  return `${best.from.toLocaleString("pl-PL")}–${best.to.toLocaleString("pl-PL")} PLN ${typeLabel}${unitLabel}`;
}

async function tryJustJoinApi(
  page: Page,
  slug: string,
  url: string,
): Promise<ManualJobInput | null> {
  const apiUrl = `https://justjoin.it/api/candidate-api/offers/${slug}`;

  const raw = await page.evaluate(async (endpoint: string) => {
    try {
      const res = await fetch(endpoint, {
        headers: { Accept: "application/json" },
        credentials: "include",
      });
      if (!res.ok) return null;
      return (await res.json()) as unknown;
    } catch {
      return null;
    }
  }, apiUrl);

  if (!raw || typeof raw !== "object") return null;

  const offer = raw as RawJJOffer;
  if (!offer.title || !offer.companyName) return null;

  return {
    url,
    title: offer.title,
    company: offer.companyName,
    body: buildJJBody(offer, url),
    location:
      offer.workplaceType === "remote"
        ? "Remote"
        : (offer.city ?? offer.locations?.[0]?.city),
    salary: offer.employmentTypes
      ? extractJJSalary(offer.employmentTypes)
      : undefined,
    tags: [
      ...(offer.requiredSkills?.map((s) => s.name.toLowerCase()) ?? []),
      ...(offer.niceToHaveSkills?.map((s) => s.name.toLowerCase()) ?? []),
    ],
  };
}

// ─── Generic DOM scraper ──────────────────────────────────────────────────────

async function scrapeGeneric(page: Page, url: string): Promise<ManualJobInput> {
  const extracted = await page.evaluate(() => {
    // Title: h1 first, then document.title
    const h1 = document.querySelector("h1");
    const title = (h1?.textContent?.trim() || document.title).trim();

    // Company: try common patterns used by job boards
    const companySelectors = [
      '[data-testid*="company"]',
      '[class*="company"]',
      '[class*="employer"]',
      '[class*="CompanyName"]',
      'a[href*="/company/"]',
      'a[href*="/employer/"]',
    ];
    let company = "Unknown";
    for (const sel of companySelectors) {
      const el = document.querySelector(sel);
      const text = el?.textContent?.trim();
      if (text && text.length > 0 && text.length < 100) {
        company = text;
        break;
      }
    }

    // Body: main content containers, in priority order
    const bodySelectors = [
      "article",
      '[class*="description"]',
      '[class*="Description"]',
      '[class*="job-details"]',
      '[class*="JobDetails"]',
      '[class*="offer-details"]',
      "main",
      "#main-content",
    ];
    let body = "";
    for (const sel of bodySelectors) {
      const el = document.querySelector(sel);
      const text = (el as HTMLElement | null)?.innerText?.trim();
      if (text && text.length > 200) {
        body = text;
        break;
      }
    }

    // Last resort: full body text (trimmed)
    if (!body) {
      body = (document.body as HTMLElement).innerText.trim().slice(0, 8000);
    }

    return { title, company, body };
  });

  return {
    url,
    title: extracted.title,
    company: extracted.company,
    body: extracted.body,
  };
}

// ─── URL scraper (dispatcher) ─────────────────────────────────────────────────

async function scrapeFromUrl(url: string): Promise<ManualJobInput> {
  console.log(`[CheckManual] Opening browser for: ${url}`);
  const { page, context } = await openPage();

  try {
    // JustJoin: try API first — it gives structured data (skills, salary, etc.)
    const jjMatch = url.match(/justjoin\.it\/job-offer\/([^/?#]+)/);
    if (jjMatch) {
      console.log("[CheckManual] Detected JustJoin — trying offers API...");

      // Navigate to homepage first so the session cookie is set
      await page.goto("https://justjoin.it", {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      await page.waitForTimeout(1_500);

      const apiResult = await tryJustJoinApi(page, jjMatch[1], url);
      if (apiResult) {
        console.log("[CheckManual] JustJoin API: success ✓");
        return apiResult;
      }
      console.log(
        "[CheckManual] JustJoin API returned nothing — falling back to DOM",
      );
    }

    // Generic: navigate to the job page and extract text from DOM
    console.log("[CheckManual] Navigating to job page...");
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(2_000); // let JS render

    const result = await scrapeGeneric(page, url);
    console.log(
      `[CheckManual] DOM extraction: title="${result.title}", company="${result.company}"`,
    );
    return result;
  } finally {
    await context.close();
    await closeBrowser();
  }
}

// ─── Build JobOffer ───────────────────────────────────────────────────────────

function buildJobOffer(input: ManualJobInput): JobOffer {
  return {
    id: `manual-${Date.now()}`,
    title: input.title,
    company: input.company,
    url: input.url,
    body: input.body,
    source: "manual",
    location: input.location,
    salary: input.salary,
    tags: input.tags,
    scrapedAt: new Date().toISOString(),
  };
}

// ─── Usage ────────────────────────────────────────────────────────────────────

function printUsage(): void {
  console.log(`
Usage:
  # URL only — Playwright scrapes the page automatically:
  ts-node src/check-manual.ts --url <url>

  # Full manual flags:
  ts-node src/check-manual.ts --url <url> --title <title> --company <company> --body <body> [options]

  # JSON file:
  ts-node src/check-manual.ts job.json

Options:
  --url       Job posting URL (required)
  --title     Job title (required unless url-only mode)
  --company   Company name (required unless url-only mode)
  --body      Full job description text (required unless url-only mode)
  --location  Location string, e.g. "Remote" or "Gdańsk"
  --salary    Salary range string, e.g. "20 000–25 000 PLN"
  --tag       Tech stack tag; repeat for multiple, e.g. --tag React --tag TypeScript

JSON file shape:
  { "url": "...", "title": "...", "company": "...", "body": "...",
    "location": "...", "salary": "...", "tags": ["React", "TypeScript"] }
`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    printUsage();
    process.exit(0);
  }

  let input: ManualJobInput;

  if (!args[0].startsWith("--")) {
    // Positional argument — treat as JSON file path
    input = parseJsonFile(args[0]);
  } else {
    const parsed = parseFlags(args);
    if (isUrlOnly(parsed)) {
      input = await scrapeFromUrl(parsed.urlOnly);
    } else {
      input = parsed;
    }
  }

  validateConfig();

  const job = buildJobOffer(input);

  console.log(`[CheckManual] Submitting: "${job.title}" @ ${job.company}`);
  console.log(`[CheckManual] URL: ${job.url}`);

  await sendToWebhook([job], "manual");

  console.log(`[CheckManual] ✅ Sent 1 job: "${job.title}" → ${job.url}`);
  console.log(
    "[CheckManual] Check Notion / Telegram for the evaluation result.",
  );
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[CheckManual] ❌ ${message}`);
  process.exit(1);
});
