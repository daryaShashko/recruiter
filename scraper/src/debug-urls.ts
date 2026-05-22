/**
 * DEBUG SCRIPT — logs every non-static network response URL from both sites.
 * Run: npx ts-node src/debug-urls.ts
 * Purpose: verify current API paths after site updates.
 * Delete after use.
 */
import { openPage } from "./utils/browser";

const SITES = [
  {
    label: "JustJoin",
    url: "https://justjoin.it/job-offers/all-locations/javascript?orderBy=descending&sortBy=publishedAt",
  },
  {
    label: "NoFluffJobs",
    url: "https://nofluffjobs.com/pl/praca/javascript",
  },
];

const STATIC = /\.(css|js|png|jpg|jpeg|svg|woff2?|ico|gif|webp|ttf|map)(\?|$)/i;

async function debugSite(label: string, url: string): Promise<void> {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`[${label}] Opening: ${url}`);
  const { page, context } = await openPage();

  const seen = new Set<string>();

  page.on("response", (response) => {
    const u = response.url();
    if (STATIC.test(u)) return;
    if (seen.has(u)) return;
    seen.add(u);
    const status = response.status();
    // Highlight XHR/fetch (non-HTML) calls
    const isXhr = !u.endsWith("/") && !u.includes(".html");
    const prefix = isXhr ? "  XHR" : "  DOC";
    console.log(`${prefix} [${status}] ${u.substring(0, 120)}`);
  });

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    console.log(`[${label}] DOM loaded — waiting 8s for XHR calls to fire...`);
    await page.waitForTimeout(8_000);
    console.log(`[${label}] Done. ${seen.size} unique URLs intercepted.`);
  } catch (err) {
    console.error(`[${label}] Error:`, err);
  } finally {
    await context.close();
  }
}

async function main() {
  for (const site of SITES) {
    await debugSite(site.label, site.url);
  }
  console.log("\nDone.");
  process.exit(0);
}

main();
