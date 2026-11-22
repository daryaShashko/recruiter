import * as fs from "fs";
import * as path from "path";
import { scrapeJustJoin } from "./scrapers/justjoin";
import { scrapeNoFluffJobs } from "./scrapers/nofluffjobs";
import { scrapeTheHub } from "./scrapers/thehub";
import { scrapeSwissDevJobs } from "./scrapers/swissdevjobs";
import { scrapeAts } from "./scrapers/ats";
import { scrapeAdzuna } from "./scrapers/adzuna";
import { sendToWebhook } from "./sender";
import { validateConfig } from "./config";
import { enrichMissingSalaries } from "./utils/salary-enricher";
import { filterValidLinks } from "./utils/link-check";
import { funnelTracker } from "./utils/funnel";
import { deduplicateOffers } from "./utils/deduplicateOffers";
import { calcFingerprint } from "./utils/fingerprint";
import { JobOffer } from "./types";

const IS_DRY_RUN = process.env.DRY_RUN === "true";

function getKnownFingerprintsCachePath(): string {
  const customPath = process.env.KNOWN_FINGERPRINTS_FILE?.trim();
  if (customPath) {
    return path.resolve(customPath);
  }
  return path.resolve(__dirname, "../../.cache/known-fingerprints.json");
}

function getOfferFingerprint(offer: JobOffer): string {
  if (
    typeof offer.fingerprint === "string" &&
    /^[0-9a-f]{16}$/i.test(offer.fingerprint)
  ) {
    return offer.fingerprint.toLowerCase();
  }
  return calcFingerprint(offer.company || "", offer.title || "");
}

export function loadKnownFingerprints(cachePath: string = getKnownFingerprintsCachePath()): Set<string> {
  if (process.env.DISABLE_FINGERPRINT_CACHE === "true" || process.env.NODE_ENV === "test") {
    return new Set<string>();
  }
  try {
    if (!fs.existsSync(cachePath)) {
      return new Set<string>();
    }
    const raw = fs.readFileSync(cachePath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    const list = Array.isArray(parsed)
      ? parsed
      : parsed &&
          typeof parsed === "object" &&
          Array.isArray((parsed as { fingerprints?: unknown }).fingerprints)
        ? (parsed as { fingerprints: unknown[] }).fingerprints
        : [];
    const set = new Set<string>();
    for (const item of list) {
      if (typeof item === "string" && item.trim().length > 0) {
        set.add(item.trim().toLowerCase());
      }
    }
    return set;
  } catch {
    return new Set<string>();
  }
}

export function saveKnownFingerprints(
  fingerprints: Iterable<string>,
  cachePath: string = getKnownFingerprintsCachePath(),
): void {
  if (
    IS_DRY_RUN ||
    process.env.DISABLE_FINGERPRINT_CACHE === "true" ||
    process.env.NODE_ENV === "test"
  ) {
    return;
  }
  try {
    const dir = path.dirname(cachePath);
    fs.mkdirSync(dir, { recursive: true });
    const unique = Array.from(new Set(Array.from(fingerprints, (fp) => fp.toLowerCase())));
    const payload = {
      updatedAt: new Date().toISOString(),
      count: unique.length,
      fingerprints: unique,
    };
    fs.writeFileSync(cachePath, JSON.stringify(payload, null, 2), "utf-8");
  } catch (err) {
    console.warn("[PreDedup] Failed to save known fingerprints cache:", err);
  }
}

export function filterKnownFingerprints(
  offers: JobOffer[],
  knownFingerprints: ReadonlySet<string>,
): { freshOffers: JobOffer[]; skippedKnownCount: number } {
  if (knownFingerprints.size === 0) {
    return { freshOffers: offers, skippedKnownCount: 0 };
  }
  const freshOffers: JobOffer[] = [];
  let skippedKnownCount = 0;
  for (const offer of offers) {
    const fp = getOfferFingerprint(offer);
    if (knownFingerprints.has(fp)) {
      skippedKnownCount++;
    } else {
      freshOffers.push(offer);
    }
  }
  return { freshOffers, skippedKnownCount };
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

  const scrapers: ReadonlyArray<{
    name: string;
    run: () => Promise<JobOffer[]>;
  }> = [
    { name: "JustJoin", run: scrapeJustJoin },
    { name: "NoFluffJobs", run: scrapeNoFluffJobs },
    { name: "TheHub", run: scrapeTheHub },
    { name: "SwissDevJobs", run: scrapeSwissDevJobs },
    { name: "ATS", run: scrapeAts },
    { name: "Adzuna", run: scrapeAdzuna },
  ];

  const results = await Promise.allSettled(scrapers.map((s) => s.run()));

  const allOffers: JobOffer[] = [];

  results.forEach((result, index) => {
    const scraperName = scrapers[index].name;
    if (result.status === "fulfilled") {
      console.log(`[${scraperName}] Collected ${result.value.length} offers`);
      allOffers.push(...result.value);
      const stats = funnelTracker.getSourceStats(scraperName);
      const hasFilterStats =
        funnelTracker.hasFilterStats(scraperName) ||
        stats.passed > 0 ||
        stats.dropped > 0;
      if (!hasFilterStats) {
        funnelTracker.recordPassed(scraperName, result.value.length);
      }
    } else {
      console.error(`[${scraperName}] Scraper failed:`, result.reason);
    }
  });

  // Order matters: merge cross-board duplicates first (keeps every salary with the
  // board it came from), then enrich remaining gaps via fuzzy title matching,
  // pre-deduplicate against known fingerprints cache, and only then spend HTTP
  // on link checks for unique new offers.
  const merged = deduplicateOffers(allOffers);
  const { offers: salaryEnriched, enrichedCount } =
    enrichMissingSalaries(merged);
  const knownFingerprints = loadKnownFingerprints();
  const { freshOffers, skippedKnownCount } = filterKnownFingerprints(
    salaryEnriched,
    knownFingerprints,
  );
  const enrichedOffers = await filterValidLinks(freshOffers);
  console.log(
    `\nTotal: ${allOffers.length} collected, ${allOffers.length - merged.length} duplicates merged, ${skippedKnownCount} known fingerprints skipped, ${freshOffers.length - enrichedOffers.length} dead links dropped, ${enrichedOffers.length} unique offers (${enrichedCount} missing salaries enriched across platforms)`,
  );

  const stats = funnelTracker.finalizeSent(enrichedOffers);
  funnelTracker.printSummaryTable();

  if (enrichedOffers.length === 0) {
    if (skippedKnownCount > 0) {
      console.log(
        `\n[PreDedup] All ${skippedKnownCount} unique offers were already processed in previous runs. Nothing new to send.`,
      );
      return;
    }
    process.stderr.write(
      "ERROR: 0 job offers collected after deduplication.\n" +
        "Possible causes: scraper API broken, site structure changed, or network issues.\n",
    );
    process.exit(1);
  }

  if (IS_DRY_RUN) {
    saveDryRunOutput(enrichedOffers);
  } else {
    try {
      await sendToWebhook(enrichedOffers, "scraper-combined", stats);
      for (const offer of enrichedOffers) {
        knownFingerprints.add(getOfferFingerprint(offer));
      }
      saveKnownFingerprints(knownFingerprints);
      console.log(
        `\n✅ Successfully sent ${enrichedOffers.length} offers to webhook`,
      );
    } catch (err) {
      console.error("Failed to send to webhook:", err);
      process.exit(1);
    }
  }

  console.log(`\nFinished at: ${new Date().toISOString()}`);
}

main();
