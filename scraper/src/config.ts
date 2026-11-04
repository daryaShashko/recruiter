import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../.env") });

/** Realistic Chrome 120+ User-Agent pool — Windows, macOS, Linux */
export const USER_AGENTS = [
  // Windows — Chrome 120
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  // Windows — Chrome 124
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  // macOS — Chrome 120
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  // macOS — Chrome 126
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  // Linux — Chrome 122
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
] as const;

/** Common desktop viewport resolutions */
export const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
  { width: 2560, height: 1440 },
] as const;

/**
 * Return a uniformly random element from a non-empty array.
 * @param arr - Source array (mutable or readonly).
 * @returns A randomly selected element of type T.
 */
export function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export const config = {
  webhookUrl: process.env.WEBHOOK_URL || "",

  scraper: {
    // Target locations (used for filtering)
    locations: ["gdansk", "gdańsk", "remote", "zdalnie"],

    // Target tech stack (used for initial pre-filter before LLM)
    targetStack: [
      "javascript",
      "typescript",
      "node",
      "react",
      "postgresql",
      "postgres",
    ],

    // Reject if ONLY these stacks appear (before LLM evaluation)
    rejectStack: [
      "java",
      "c#",
      ".net",
      "php",
      "ruby",
      "go",
      "rust",
      "kotlin",
      "swift",
    ],

    // Target seniority levels
    targetLevels: ["senior", "lead", "principal", "architect", "staff"],

    // Reject junior/mid positions
    rejectLevels: ["junior", "mid", "regular", "intern", "trainee"],
  },

  // ADR-020: global sources batch 1. Location is not pre-filtered here —
  // the LLM evaluator applies remote/relocation rules.
  global: {
    // Drop postings older than this (by publish date)
    maxAgeDays: 60,
    // Polite delay between sequential requests to the same host (ms)
    requestDelayMs: 300,
    // Per-request timeout (ms)
    requestTimeoutMs: 20_000,
    // Stack signal: at least one must appear in title, tags, or description
    jsSignals: [
      "javascript",
      "typescript",
      "node.js",
      "nodejs",
      "node",
      "react",
      "next.js",
      "nextjs",
      "nestjs",
      "vue",
      "angular",
      "full-stack",
      "fullstack",
      "full stack",
      "frontend",
      "front-end",
    ],
    // Title must contain at least one of these
    seniorTitleSignals: [
      "senior",
      "sr.",
      "sr ",
      "lead",
      "principal",
      "staff",
      "architect",
      "head of",
      "founding",
    ],
    // Title must not contain any of these
    rejectTitleSignals: [
      "junior",
      "intern",
      "internship",
      "trainee",
      "graduate",
      "working student",
      "werkstudent",
      "apprentice",
    ],
    // Hard legal blockers for an EU citizen (description, case-insensitive)
    legalBlockers: [
      "us citizen only",
      "us citizens only",
      "u.s. citizens only",
      "must be a us citizen",
      "must be a u.s. citizen",
      "security clearance",
      "active clearance",
      "itar",
    ],
    thehub: {
      apiBaseUrl: "https://api.thehub.io",
      siteBaseUrl: "https://thehub.io",
      countries: ["DK", "SE", "NO", "FI"],
      // Safety cap on list pages per country (15 jobs per page)
      maxPagesPerCountry: 30,
      // Only these TheHub jobRole values are fetched in detail
      jobRoles: [
        "fullstackdeveloper",
        "frontenddeveloper",
        "backenddeveloper",
        "engineer",
        "cxo",
      ],
    },
    swissdevjobs: {
      feedUrl: "https://swissdevjobs.ch/job_feed.xml",
    },
    // Curated company slugs — slugs verified 2026-11-04 (non-empty public board)
    ats: {
      greenhouse: [
        "gitlab",
        "vercel",
        "netlify",
        "contentful",
        "typeform",
        "remote",
        "cloudflare",
        "datadog",
        "elastic",
        "mongodb",
        "grafanalabs",
        "adyen",
        "n26",
        "trivago",
        "getyourguide",
        "hellofresh",
        "wolt",
        "mentimeter",
        "monzo",
        "wise",
        "deliveroo",
        "cleo",
        "gocardless",
        "intercom",
        "storyblok",
        "algolia",
        "airtable",
        "figma",
      ],
      lever: ["spotify", "matillion", "contentsquare", "swile"],
      ashby: [
        "linear",
        "posthog",
        "supabase",
        "resend",
        "n8n",
        "ramp",
        "lovable",
        "synthesia",
        "elevenlabs",
        "incident",
        "attio",
        "clerk",
        "knock",
      ],
    },
  },

  playwright: {
    headless: process.env.HEADLESS !== "false",
    // Viewport mimics a common desktop resolution
    viewport: { width: 1440, height: 900 },
    // Realistic user agent
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    // Timeout for navigation
    navigationTimeout: 30_000,
    // Timeout for network requests
    requestTimeout: 15_000,
  },

  sender: {
    // Max retries for webhook POST
    maxRetries: 3,
    // Initial delay between retries (ms), doubles each attempt
    retryDelay: 1_000,
    // Number of job offers per webhook request.
    // Default is intentionally high to avoid spawning many parallel n8n executions.
    batchSize: Number(process.env.WEBHOOK_BATCH_SIZE || 250),
  },
} as const;

export function validateConfig(): void {
  if (!config.webhookUrl) {
    throw new Error("WEBHOOK_URL environment variable is required");
  }

  let parsed: URL;
  try {
    parsed = new URL(config.webhookUrl);
  } catch {
    throw new Error("WEBHOOK_URL must be a valid absolute URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("WEBHOOK_URL must use http or https protocol");
  }
}
