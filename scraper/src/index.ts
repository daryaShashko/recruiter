import * as fs from "fs";
import * as path from "path";
import { scrapeJustJoin } from "./scrapers/justjoin";
import { scrapeNoFluffJobs } from "./scrapers/nofluffjobs";
import { sendToWebhook } from "./sender";
import { validateConfig } from "./config";
import { closeBrowser } from "./utils/browser";
import { JobOffer } from "./types";

const IS_DRY_RUN = process.env.DRY_RUN === "true";

function deduplicateOffers(offers: JobOffer[]): JobOffer[] {
  const seen = new Set<string>();
  return offers.filter((offer) => {
    if (seen.has(offer.id)) {
      return false;
    }
    seen.add(offer.id);
    return true;
  });
}

function saveDryRunOutput(offers: JobOffer[]): void {
  const outputDir = path.resolve(__dirname, "../../output");
  fs.mkdirSync(outputDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputPath = path.join(outputDir, `dry-run-${timestamp}.json`);

  fs.writeFileSync(outputPath, JSON.stringify(offers, null, 2), "utf-8");
  console.log(`\n[DRY RUN] Saved ${offers.length} offers → ${outputPath}`);

  // Print a brief preview table
  console.log(
    "\n── Preview (first 10 offers) ──────────────────────────────────",
  );
  offers.slice(0, 10).forEach((o, i) => {
    const salary = o.salary ?? "no salary";
    console.log(
      `  ${String(i + 1).padStart(2)}. [${o.source}] ${o.title} @ ${o.company} | ${o.location} | ${salary}`,
    );
  });
  if (offers.length > 10) {
    console.log(`  ... and ${offers.length - 10} more`);
  }
}

async function main(): Promise<void> {
  console.log("=== AI Recruiter Scraper ===");
  console.log(`Started at: ${new Date().toISOString()}`);
  if (IS_DRY_RUN) {
    console.log(
      "[DRY RUN] Webhook send is DISABLED — results will be saved to output/",
    );
  }

  if (!IS_DRY_RUN) {
    try {
      validateConfig();
    } catch (err) {
      console.error("Configuration error:", err);
      process.exit(1);
    }
  }

  const results = await Promise.allSettled([
    scrapeJustJoin(),
    scrapeNoFluffJobs(),
  ]);

  const allOffers: JobOffer[] = [];

  results.forEach((result, index) => {
    const scraperName = index === 0 ? "JustJoin" : "NoFluffJobs";
    if (result.status === "fulfilled") {
      console.log(`[${scraperName}] Collected ${result.value.length} offers`);
      allOffers.push(...result.value);
    } else {
      console.error(`[${scraperName}] Scraper failed:`, result.reason);
    }
  });

  const deduplicated = deduplicateOffers(allOffers);
  console.log(
    `\nTotal: ${allOffers.length} collected, ${allOffers.length - deduplicated.length} duplicates removed, ${deduplicated.length} unique offers`,
  );

  if (deduplicated.length === 0) {
    console.warn("No offers to send. Exiting.");
    return;
  }

  if (IS_DRY_RUN) {
    saveDryRunOutput(deduplicated);
  } else {
    try {
      await sendToWebhook(deduplicated, "scraper-combined");
      console.log(
        `\n✅ Successfully sent ${deduplicated.length} offers to webhook`,
      );
    } catch (err) {
      console.error("Failed to send to webhook:", err);
      process.exit(1);
    } finally {
      await closeBrowser();
    }
  }

  console.log(`\nFinished at: ${new Date().toISOString()}`);
}

main();
