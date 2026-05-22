import { Browser, BrowserContext, Page, chromium } from "playwright";
import { config } from "../config";

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

/**
 * Create a new browser context with realistic browser fingerprints.
 */
export async function createContext(): Promise<BrowserContext> {
  const b = await getBrowser();
  const context = await b.newContext({
    userAgent: config.playwright.userAgent,
    viewport: config.playwright.viewport,
    locale: "en-US",
    timezoneId: "Europe/Warsaw",
    // Mimic real browser headers
    extraHTTPHeaders: {
      "Accept-Language": "en-US,en;q=0.9,pl;q=0.8",
      "Accept-Encoding": "gzip, deflate, br",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Sec-Ch-Ua":
        '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": '"macOS"',
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
