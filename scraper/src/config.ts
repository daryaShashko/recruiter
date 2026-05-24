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
