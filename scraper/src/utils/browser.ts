import { Browser, BrowserContext, Page, chromium } from "playwright";
import { config, pickRandom, USER_AGENTS, VIEWPORTS } from "../config";

let browser: Browser | null = null;

/**
 * Launch (or reuse) a Playwright browser with realistic fingerprints
 * to avoid Cloudflare bot detection.
 */
export async function getBrowser(): Promise<Browser> {
  if (!browser) {
    browser = await chromium.launch({
      headless: config.playwright.headless,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--disable-gpu",
      ],
    });
  }
  return browser;
}

/** Extract the Chrome major version number from a User-Agent string. */
function extractChromeVersion(userAgent: string): string {
  const match = userAgent.match(/Chrome\/(\d+)/);
  return match ? match[1] : "120";
}

/**
 * Build a Sec-Ch-Ua header value consistent with the given User-Agent.
 * Format: "Not_A Brand";v="8", "Chromium";v="{ver}", "Google Chrome";v="{ver}"
 */
function buildSecChUa(userAgent: string): string {
  const v = extractChromeVersion(userAgent);
  return `"Not_A Brand";v="8", "Chromium";v="${v}", "Google Chrome";v="${v}"`;
}

/** Derive Sec-Ch-Ua-Platform from a User-Agent string. */
function buildSecChUaPlatform(userAgent: string): string {
  if (userAgent.includes("Windows")) return '"Windows"';
  if (userAgent.includes("Macintosh")) return '"macOS"';
  return '"Linux"';
}

/**
 * Create a new browser context with realistic browser fingerprints.
 * Picks a random User-Agent and viewport from the configured pools on every call.
 */
export async function createContext(): Promise<BrowserContext> {
  const b = await getBrowser();
  const userAgent = pickRandom(USER_AGENTS);
  const viewport = pickRandom(VIEWPORTS);
  const context = await b.newContext({
    userAgent,
    viewport,
    locale: "en-US",
    timezoneId: "Europe/Warsaw",
    // Mimic real browser headers — keep Sec-Ch-Ua consistent with the chosen UA
    extraHTTPHeaders: {
      "Accept-Language": "en-US,en;q=0.9,pl;q=0.8",
      "Accept-Encoding": "gzip, deflate, br",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Sec-Ch-Ua": buildSecChUa(userAgent),
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": buildSecChUaPlatform(userAgent),
    },
  });

  // Mask WebDriver fingerprint
  // This callback runs in the browser context where `navigator` is a global.
  // Cast via globalThis to avoid TS2304 (lib: ES2022 has no DOM types).
  await context.addInitScript(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nav: any = (globalThis as any).navigator;
    Object.defineProperty(nav, "webdriver", { get: () => undefined });
    Object.defineProperty(nav, "plugins", { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(nav, "languages", {
      get: () => ["en-US", "en", "pl"],
    });
  });

  return context;
}

/**
 * Close the shared browser instance.
 */
export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
  }
}

/**
 * Open a new page in a fresh context with anti-detection measures.
 */
export async function openPage(): Promise<{
  page: Page;
  context: BrowserContext;
}> {
  const context = await createContext();
  const page = await context.newPage();

  // Set navigation timeout
  page.setDefaultNavigationTimeout(config.playwright.navigationTimeout);
  page.setDefaultTimeout(config.playwright.requestTimeout);

  return { page, context };
}
