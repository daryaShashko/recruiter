import { JobOffer } from "../types";
import { openPage } from "../utils/browser";
import { config } from "../config";

const JUSTJOIN_BASE_URL = "https://justjoin.it";
// Verified via DevTools — 2025-05
// NOTE: Direct navigation to /job-offers/all-locations/javascript uses SSR and
// does NOT fire this endpoint. Must navigate to homepage first, then click the
// JavaScript category link. See scrapeJustJoin() for details.
const JUSTJOIN_API_PATH = "/api/candidate-api/offers";

// ─── Raw API types (confirmed from actual response) ──────────────────────────

interface RawEmploymentType {
  from?: number;
  fromPerUnit?: number;
  to?: number;
  toPerUnit?: number;
  currency: string; // 'PLN' | 'USD' | 'EUR' | ...
  currencySource: string; // 'original' | 'conversion'
  type: string; // 'b2b' | 'uop' | 'other'
  unit: string; // 'Month' | 'Hour'
  gross: boolean;
}

interface RawLocation {
  city: string;
  street?: string;
  latitude?: number;
  longitude?: number;
  slug: string;
}

interface RawSkill {
  name: string;
  level: number; // 1–5
}

interface RawJustJoinOffer {
  guid: string;
  slug: string;
  title: string;
  workplaceType: "remote" | "hybrid" | "office" | string;
  workingTime: string;
  experienceLevel: string; // 'junior' | 'mid' | 'senior' | 'lead' | ...
  city: string;
  companyName: string;
  publishedAt: string;
  locations: RawLocation[];
  employmentTypes: RawEmploymentType[];
  requiredSkills: RawSkill[];
  niceToHaveSkills: RawSkill[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Extract salary string. Prefers PLN + b2b + Month.
 * Falls back to any PLN entry, then undefined.
 */
function extractSalary(types: RawEmploymentType[]): string | undefined {
  const originalPln = types.filter(
    (e) => e.currency === "PLN" && e.currencySource === "original",
  );

  // Prefer monthly b2b, then any PLN original
  const best =
    originalPln.find((e) => e.type === "b2b" && e.unit === "Month") ??
    originalPln.find((e) => e.unit === "Month") ??
    originalPln[0];

  if (!best || !best.from || !best.to) return undefined;

  const unitLabel = best.unit === "Hour" ? "/h" : "/mo";
  const typeLabel = best.type === "b2b" ? "B2B" : best.type.toUpperCase();
  return `${best.from.toLocaleString("pl-PL")}–${best.to.toLocaleString("pl-PL")} PLN ${typeLabel}${unitLabel}`;
}

/**
 * Determine display location.
 * Remote → 'Remote'. Gdańsk in locations → 'Gdańsk'. Otherwise primary city.
 */
function extractLocation(offer: RawJustJoinOffer): string {
  if (offer.workplaceType === "remote") return "Remote";

  const gdanskMatch = offer.locations.find(
    (l) =>
      l.city.toLowerCase().includes("gdańsk") ||
      l.city.toLowerCase().includes("gdansk"),
  );
  if (gdanskMatch) return "Gdańsk";

  return offer.city || offer.locations[0]?.city || "Unknown";
}

/**
 * Build a synthetic job description from structured data
 * since the list API does not return full body text.
 * This gives Ollama enough signal to evaluate the offer.
 */
function buildBody(raw: RawJustJoinOffer): string {
  const lines: string[] = [];

  lines.push(`Position: ${raw.title}`);
  lines.push(`Company: ${raw.companyName}`);
  lines.push(`Experience level: ${raw.experienceLevel}`);
  lines.push(`Work type: ${raw.workplaceType}`);

  if (raw.requiredSkills?.length) {
    const skills = raw.requiredSkills
      .sort((a, b) => b.level - a.level)
      .map((s) => `${s.name} (${s.level}/5)`)
      .join(", ");
    lines.push(`Required skills: ${skills}`);
  }

  if (raw.niceToHaveSkills?.length) {
    const nice = raw.niceToHaveSkills.map((s) => s.name).join(", ");
    lines.push(`Nice to have: ${nice}`);
  }

  const cities = raw.locations.map((l) => l.city).join(", ");
  if (cities) lines.push(`Locations: ${cities}`);

  return lines.join("\n");
}

/**
 * Pre-filter before sending to Ollama.
 * Keeps: remote OR has Gdańsk location, AND not a rejected seniority.
 * Reduces LLM calls by removing obvious non-matches early.
 */
function matchesPreFilter(offer: RawJustJoinOffer): boolean {
  // Location gate: remote OR Gdańsk in locations array
  const isRemote = offer.workplaceType === "remote";
  const hasGdansk = offer.locations.some(
    (l) =>
      l.city.toLowerCase().includes("gdańsk") ||
      l.city.toLowerCase().includes("gdansk"),
  );

  if (!isRemote && !hasGdansk) return false;

  // Seniority gate: reject explicit junior/mid/intern levels
  const level = (offer.experienceLevel ?? "").toLowerCase();
  if (config.scraper.rejectLevels.some((r) => level.includes(r))) return false;

  return true;
}

function normalizeOffer(raw: RawJustJoinOffer): JobOffer {
  return {
    id: `justjoin_${raw.slug}`,
    title: raw.title,
    company: raw.companyName,
    url: `${JUSTJOIN_BASE_URL}/job-offer/${raw.slug}`,
    body: buildBody(raw),
    source: "justjoin",
    location: extractLocation(raw),
    salary: extractSalary(raw.employmentTypes),
    tags: [
      ...(raw.requiredSkills?.map((s) => s.name.toLowerCase()) ?? []),
      ...(raw.niceToHaveSkills?.map((s) => s.name.toLowerCase()) ?? []),
    ],
    scrapedAt: new Date().toISOString(),
  };
}

// ─── Main scraper ─────────────────────────────────────────────────────────────

// Safety cap — prevents runaway loops on unexpected totalItems values.
const JUSTJOIN_MAX_PAGES = 30;
const JUSTJOIN_PAGE_SIZE = 100;

export async function scrapeJustJoin(): Promise<JobOffer[]> {
  const { page, context } = await openPage();
  const rawOffers: RawJustJoinOffer[] = [];

  // Captured from the first intercepted GET — reused for pages 2+
  let capturedRequestUrl: string | null = null;
  let capturedTotalItems = 0;
  // Guard: response listener must only push page-1 data once.
  // page.evaluate() fetch calls also trigger page.on("response"),
  // which would double-count pages 2–N without this flag.
  let page1Captured = false;

  try {
    console.log("[JustJoin] Setting up XHR interceptor...");

    // Capture the outgoing request URL so we can replay it with different `from=` values
    page.on("request", (request) => {
      const u = request.url();
      if (
        u.includes(JUSTJOIN_API_PATH) &&
        u.includes("categories=javascript") &&
        !u.includes("/clusters") &&
        !u.includes("/count") &&
        !capturedRequestUrl
      ) {
        capturedRequestUrl = u;
      }
    });

    page.on("response", async (response) => {
      // Skip once page 1 is already captured — subsequent API hits come from
      // page.evaluate() fetches (pages 2–N) and must NOT be double-counted here.
      if (page1Captured) return;

      const u = response.url();
      // Only capture the offers list endpoint (not /clusters, /facets/count, etc.)
      if (!u.includes(JUSTJOIN_API_PATH)) return;
      if (u.includes("/clusters") || u.includes("/count")) return;
      if (!u.includes("categories=javascript")) return;

      try {
        const json = await response.json();
        const batch: RawJustJoinOffer[] = json.data ?? [];
        if (Array.isArray(batch) && batch.length > 0) {
          rawOffers.push(...batch);
          page1Captured = true;
          console.log(`[JustJoin] Page 1: ${batch.length} offers intercepted`);
        }
        // Capture total from first response's meta
        if (capturedTotalItems === 0 && json.meta?.totalItems) {
          capturedTotalItems = json.meta.totalItems as number;
          console.log(
            `[JustJoin] Total items reported by API: ${capturedTotalItems}`,
          );
        }
      } catch {
        // Non-JSON, ignore
      }
    });

    // Navigate to main page first.
    // IMPORTANT: Direct navigation to /job-offers/all-locations/javascript uses SSR
    // and does NOT trigger the offers API call. The API only fires when the JS
    // category is clicked from within the SPA — verified via DevTools 2025-05.
    console.log("[JustJoin] Navigating to main page...");
    await page.goto(JUSTJOIN_BASE_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    // Accept cookie consent (standard HTML dialog — not Shadow DOM like NFJ)
    console.log("[JustJoin] Handling cookie consent...");
    await page.waitForTimeout(2_000);
    try {
      await page.click('button:has-text("Accept all")', { timeout: 5_000 });
      console.log("[JustJoin] Cookie consent accepted");
    } catch {
      console.log(
        "[JustJoin] No consent dialog found (may already be accepted)",
      );
    }

    // Click the JavaScript category — this triggers the offers API call
    console.log("[JustJoin] Clicking JavaScript category...");
    try {
      await page.click('a[href*="/job-offers/all-locations/javascript"]', {
        timeout: 10_000,
      });
    } catch {
      // Fallback: navigate directly if the link isn't found
      console.warn(
        "[JustJoin] Could not find JavaScript link, navigating directly...",
      );
      await page.goto(
        `${JUSTJOIN_BASE_URL}/job-offers/all-locations/javascript`,
        { waitUntil: "domcontentloaded", timeout: 60_000 },
      );
    }

    // Wait for the offers API response (up to 20s)
    console.log("[JustJoin] Waiting for API response...");
    try {
      await page.waitForResponse(
        (resp) => {
          const u = resp.url();
          return (
            u.includes(JUSTJOIN_API_PATH) &&
            u.includes("categories=javascript") &&
            !u.includes("/clusters") &&
            !u.includes("/count") &&
            resp.status() === 200
          );
        },
        { timeout: 20_000 },
      );
    } catch {
      console.warn(
        "[JustJoin] API response not received within 20s — proceeding with whatever was collected",
      );
    }
    await page.waitForTimeout(1_000);

    // ── Pagination: pages 2..N via browser-context fetch ─────────────────────
    // Response meta: { from: 0, totalItems: N, next: { cursor: 100 } }
    // We fetch subsequent pages by setting from=100, 200, 300... in the URL.
    if (capturedRequestUrl && capturedTotalItems > JUSTJOIN_PAGE_SIZE) {
      const totalPages = Math.min(
        Math.ceil(capturedTotalItems / JUSTJOIN_PAGE_SIZE),
        JUSTJOIN_MAX_PAGES,
      );
      console.log(
        `[JustJoin] Fetching pages 2..${totalPages} (${capturedTotalItems} total items)`,
      );

      for (let pageNum = 2; pageNum <= totalPages; pageNum++) {
        const fromOffset = (pageNum - 1) * JUSTJOIN_PAGE_SIZE;
        console.log(
          `[JustJoin] Fetching page ${pageNum}/${totalPages} (from=${fromOffset})...`,
        );

        const batch = await page.evaluate(
          async (args: { url: string; from: number }) => {
            // Modify the captured URL's `from` parameter and fetch from browser context
            // (reuses session cookies automatically)
            const u = new URL(args.url);
            u.searchParams.set("from", String(args.from));

            const res = await fetch(u.toString(), {
              headers: { Accept: "application/json" },
            });
            if (!res.ok) return [];
            const json = (await res.json()) as { data?: unknown[] };
            return json.data ?? [];
          },
          { url: capturedRequestUrl, from: fromOffset },
        );

        rawOffers.push(...(batch as RawJustJoinOffer[]));
        console.log(
          `[JustJoin] Page ${pageNum}: ${batch.length} offers (running total: ${rawOffers.length})`,
        );

        // Polite inter-request delay
        await page.waitForTimeout(300);
      }
    }

    console.log(`[JustJoin] Total raw offers collected: ${rawOffers.length}`);

    if (rawOffers.length === 0) {
      console.warn("[JustJoin] WARNING: 0 offers collected.");
      console.warn(
        "[JustJoin] The offers API was not triggered by clicking the JavaScript category.",
      );
      console.warn(
        "[JustJoin] Re-verify the navigation flow via DevTools if this persists.",
      );
      return [];
    }

    // Pre-filter before sending to LLM
    const filtered = rawOffers.filter(matchesPreFilter);
    console.log(
      `[JustJoin] Pre-filter (location + seniority): ${filtered.length}/${rawOffers.length} kept`,
    );

    return filtered.map(normalizeOffer);
  } finally {
    await context.close();
  }
}
