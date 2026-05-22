import { JobOffer } from "../types";
import { openPage } from "../utils/browser";
import { config } from "../config";

const NOFLUFFJOBS_BASE_URL = "https://nofluffjobs.com";
// 2025-05: was POST /api/search/posting (XHR-intercepted)
// 2026-05: NFJ switched to Angular SSR — job data is embedded in
//          <script id="serverApp-state"> on every page load.
//          Pagination uses cumulative SSR: page N contains items 1..N*PAGE_SIZE.
//          We navigate to the last page to get all postings in one shot.
const NOFLUFFJOBS_SEARCH_URL = `${NOFLUFFJOBS_BASE_URL}/pl/praca/javascript`;
const NOFLUFFJOBS_SSR_STATE_SELECTOR = "#serverApp-state";

// ─── Raw API types (confirmed from actual response) ──────────────────────────

export interface RawNFJPlace {
  city?: string; // present for city-based places
  street?: string;
  country?: { code: string; name: string };
  province?: string; // present for province-based places
  provinceOnly?: boolean;
  url: string;
}

export interface RawNFJLocation {
  places: RawNFJPlace[];
  fullyRemote: boolean; // use THIS for remote detection (not posting.fullyRemote)
  covidTimeRemotely: boolean;
  hybridDesc?: string;
}

export interface RawNFJSalary {
  from?: number;
  to?: number;
  type: string; // 'b2b' | 'permanent' | 'zlecenie' | ...
  currency: string; // 'PLN' | 'USD' | 'EUR'
  disclosedAt: string; // 'VISIBLE' | 'AT_FIRST_INTERVIEW' | 'AT_LAST_INTERVIEW'
  flexibleUpperBound: boolean;
}

export interface RawNFJTileValue {
  value: string;
  type: string; // 'category' | 'requirement'
}

export interface RawNoFluffPosting {
  id: string; // includes location suffix: "job-title-company-City-N" — NOT unique across locations!
  name: string; // COMPANY name (not the job title)
  title: string; // job title (plain string)
  url: string; // URL slug only — prepend: /pl/praca/
  reference: string; // UNIQUE job reference — same value across all location variants
  posted: number; // Unix timestamp in MILLISECONDS
  renewed?: number;
  technology: string;
  category: string; // 'frontend' | 'fullstack' | 'backend' | ...
  seniority: string[]; // e.g. ["Senior"] | ["Mid"] | ["Expert"]
  location: RawNFJLocation;
  salary?: RawNFJSalary;
  fullyRemote: boolean; // posting-level flag — use location.fullyRemote instead (more reliable)
  tiles?: { values: RawNFJTileValue[] };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Extract salary string.
 * NoFluffJobs salary is always monthly (no 'unit' field), so just use from/to directly.
 */
function extractSalary(salary?: RawNFJSalary): string | undefined {
  if (!salary || !salary.from || !salary.to) return undefined;
  if (salary.disclosedAt !== "VISIBLE") return undefined;

  const typeLabel = salary.type === "b2b" ? "B2B" : salary.type.toUpperCase();
  return `${salary.from.toLocaleString("pl-PL")}–${salary.to.toLocaleString("pl-PL")} ${salary.currency} ${typeLabel}/mo`;
}

/**
 * Determine display location from the posting's location object.
 * Prefers: Remote > Gdańsk > first city in places list.
 */
function extractLocation(posting: RawNoFluffPosting): string {
  // Use location.fullyRemote (more reliable than posting.fullyRemote)
  if (posting.location.fullyRemote) return "Remote";

  // Look for Gdańsk in places (city-based entries only, skip province-only)
  const gdanskPlace = posting.location.places.find(
    (p) =>
      !p.provinceOnly &&
      p.city &&
      (p.city.toLowerCase().includes("gdańsk") ||
        p.city.toLowerCase().includes("gdansk")),
  );
  if (gdanskPlace) return "Gdańsk";

  // First named city
  const firstCity = posting.location.places.find(
    (p) => !p.provinceOnly && p.city,
  );
  return firstCity?.city ?? "Unknown";
}

/**
 * Extract tags from tiles (requirement-type values).
 */
function extractTags(posting: RawNoFluffPosting): string[] {
  if (!posting.tiles?.values) return [];
  return posting.tiles.values
    .filter((t) => t.type === "requirement")
    .map((t) => t.value.toLowerCase());
}

/**
 * Build synthetic job body from structured fields.
 * NoFluffJobs list API does not return full job description text.
 */
function buildBody(posting: RawNoFluffPosting): string {
  const lines: string[] = [];

  lines.push(`Position: ${posting.title}`);
  lines.push(`Company: ${posting.name}`);
  lines.push(`Category: ${posting.category}`);
  lines.push(`Seniority: ${posting.seniority.join(", ")}`);
  lines.push(`Technology: ${posting.technology}`);

  const tags = extractTags(posting);
  if (tags.length) lines.push(`Skills: ${tags.join(", ")}`);

  const cities = posting.location.places
    .filter((p) => !p.provinceOnly && p.city)
    .map((p) => p.city as string);
  if (cities.length)
    lines.push(`Locations: ${[...new Set(cities)].join(", ")}`);
  if (posting.location.fullyRemote) lines.push("Work type: Remote");
  if (posting.location.hybridDesc)
    lines.push(`Hybrid: ${posting.location.hybridDesc}`);

  return lines.join("\n");
}

/**
 * Pre-filter before sending to Ollama.
 * Keeps: remote OR Gdańsk location, AND not a rejected seniority level.
 */
export function matchesNFJPreFilter(posting: RawNoFluffPosting): boolean {
  // Location gate: remote OR Gdańsk
  const isRemote = posting.location.fullyRemote;
  const hasGdansk = posting.location.places.some(
    (p) =>
      !p.provinceOnly &&
      p.city &&
      (p.city.toLowerCase().includes("gdańsk") ||
        p.city.toLowerCase().includes("gdansk")),
  );

  if (!isRemote && !hasGdansk) return false;

  // Seniority gate: reject explicit junior/mid/intern levels
  const levels = posting.seniority.map((s) => s.toLowerCase());
  if (
    levels.some((l) => config.scraper.rejectLevels.some((r) => l.includes(r)))
  ) {
    return false;
  }

  return true;
}

function normalizePosting(posting: RawNoFluffPosting): JobOffer {
  return {
    id: `nofluffjobs_${posting.reference}`, // use reference for stable unique ID
    title: posting.title,
    company: posting.name,
    url: `${NOFLUFFJOBS_BASE_URL}/pl/praca/${posting.url}`,
    body: buildBody(posting),
    source: "nofluffjobs",
    location: extractLocation(posting),
    salary: extractSalary(posting.salary),
    tags: extractTags(posting),
    scrapedAt: new Date().toISOString(),
  };
}

/**
 * Dedup by reference: same job listed once per location variant → keep best.
 * Priority: remote > has Gdańsk > first seen.
 */
export function deduplicateByReference(
  postings: RawNoFluffPosting[],
): RawNoFluffPosting[] {
  const best = new Map<string, RawNoFluffPosting>();

  for (const posting of postings) {
    const existing = best.get(posting.reference);
    if (!existing) {
      best.set(posting.reference, posting);
      continue;
    }

    const hasGdansk = (p: RawNoFluffPosting) =>
      p.location.places.some(
        (l) =>
          !l.provinceOnly &&
          l.city &&
          (l.city.toLowerCase().includes("gdańsk") ||
            l.city.toLowerCase().includes("gdansk")),
      );

    // Prefer remote variant
    if (posting.location.fullyRemote && !existing.location.fullyRemote) {
      best.set(posting.reference, posting);
      continue;
    }
    // Then prefer Gdańsk variant
    if (hasGdansk(posting) && !hasGdansk(existing)) {
      best.set(posting.reference, posting);
    }
  }

  return Array.from(best.values());
}

// ─── SSR state extractor ──────────────────────────────────────────────────────

/**
 * Read job postings from the Angular SSR transfer state embedded in the page.
 * NFJ embeds the first-page (and cumulative for subsequent pages) search results
 * in <script id="serverApp-state"> so the browser can hydrate without an extra
 * API round-trip.
 *
 * Response shape (confirmed 2026-05):
 *   STORE_KEY.searchResponse.postings   → RawNoFluffPosting[]
 *   STORE_KEY.searchResponse.totalPages → number
 *   STORE_KEY.params.page               → number (current page)
 */
export function extractSsrPostings(html: string): {
  postings: RawNoFluffPosting[];
  totalPages: number;
  currentPage: number;
} {
  // Extract the JSON from <script id="serverApp-state">…</script>
  const match = html.match(
    /<script[^>]+id=["']serverApp-state["'][^>]*>([\s\S]*?)<\/script>/,
  );
  if (!match) return { postings: [], totalPages: 1, currentPage: 1 };

  try {
    const state = JSON.parse(match[1]) as Record<string, unknown>;
    const store = state["STORE_KEY"] as Record<string, unknown> | undefined;
    const searchResponse = store?.["searchResponse"] as
      | Record<string, unknown>
      | undefined;
    const params = store?.["params"] as Record<string, unknown> | undefined;

    const postings = (searchResponse?.["postings"] ??
      []) as RawNoFluffPosting[];
    const totalPages =
      typeof searchResponse?.["totalPages"] === "number"
        ? (searchResponse["totalPages"] as number)
        : 1;
    const currentPage =
      typeof params?.["page"] === "number" ? (params["page"] as number) : 1;

    return { postings, totalPages, currentPage };
  } catch {
    return { postings: [], totalPages: 1, currentPage: 1 };
  }
}

// ─── Main scraper ─────────────────────────────────────────────────────────────

// Safety cap on pages (each SSR page is cumulative, so last page = all results)
const MAX_PAGES = 20;

export async function scrapeNoFluffJobs(): Promise<JobOffer[]> {
  const { page, context } = await openPage();

  try {
    // ── Page 1: discover totalPages and collect first batch ──────────────────
    console.log("[NoFluffJobs] Navigating to JavaScript job listings...");
    const resp1 = await page.goto(NOFLUFFJOBS_SEARCH_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    const html1 = await resp1!.text();
    const { postings: batch1, totalPages } = extractSsrPostings(html1);

    console.log(
      `[NoFluffJobs] Page 1: ${batch1.length} postings (totalPages: ${totalPages})`,
    );

    if (batch1.length === 0) {
      console.warn("[NoFluffJobs] WARNING: 0 postings on page 1.");
      console.warn(
        "[NoFluffJobs] SSR state not found — site structure may have changed.",
      );
      console.warn(
        `[NoFluffJobs] Expected: <script id="${NOFLUFFJOBS_SSR_STATE_SELECTOR.slice(1)}"> with STORE_KEY`,
      );
      return [];
    }

    const cappedTotalPages = Math.min(totalPages, MAX_PAGES);

    // ── NFJ SSR pagination is CUMULATIVE: page N contains items 1..N*pageSize.
    //    Navigating to the last page gives all postings in one shot.
    //    If there is only 1 page, we already have everything.
    let allPostings: RawNoFluffPosting[];

    if (cappedTotalPages <= 1) {
      allPostings = batch1;
    } else {
      console.log(
        `[NoFluffJobs] Fetching last page (${cappedTotalPages}) to get all ${cappedTotalPages} pages cumulatively...`,
      );
      const respLast = await page.goto(
        `${NOFLUFFJOBS_SEARCH_URL}?page=${cappedTotalPages}`,
        { waitUntil: "domcontentloaded", timeout: 60_000 },
      );
      const htmlLast = await respLast!.text();
      const { postings: batchLast } = extractSsrPostings(htmlLast);

      console.log(
        `[NoFluffJobs] Last page: ${batchLast.length} postings (cumulative)`,
      );
      allPostings = batchLast;
    }

    console.log(
      `[NoFluffJobs] Total raw postings collected: ${allPostings.length}`,
    );

    // IMPORTANT: Same job appears N times (once per location variant).
    // Dedup by reference field before filtering/normalizing.
    const uniquePostings = deduplicateByReference(allPostings);
    console.log(
      `[NoFluffJobs] After reference dedup: ${uniquePostings.length}/${allPostings.length} unique jobs`,
    );

    // Pre-filter (location + seniority) before sending to Ollama
    const filtered = uniquePostings.filter(matchesNFJPreFilter);
    console.log(
      `[NoFluffJobs] Pre-filter (location + seniority): ${filtered.length}/${uniquePostings.length} kept`,
    );

    return filtered.map(normalizePosting);
  } finally {
    await context.close();
  }
}
