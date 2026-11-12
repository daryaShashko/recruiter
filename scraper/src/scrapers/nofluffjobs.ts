import axios from "axios";
import { CompanyMetadata, JobOffer } from "../types";
import { config } from "../config";
import { normalizeCompanyUrl } from "../utils/company";

export {
  buildCompanySearchUrl,
  getCompanySearchUrl,
  getCompanyUrl,
  normalizeCompanyUrl,
} from "../types";

const NOFLUFFJOBS_BASE_URL = "https://nofluffjobs.com";
// 2025-05: POST /api/search/posting (XHR-intercepted) — same endpoint as today.
// 2026-05: NFJ briefly appeared to move pagination to Angular SSR
//          (<script id="serverApp-state">, ?page=N). That no longer returns
//          real data: ?page=N echoes the page number back but the embedded
//          postings never change, and the true last page returns a null
//          searchResponse. A real browser hits the same wall — this was a
//          site-side change, not a Playwright-vs-HTTP issue.
// 2026-10: switched to calling /api/search/posting directly — this is the
//          exact endpoint the site's own "Pokaż kolejne oferty" (load more)
//          button calls, captured via DevTools. Paginated with the `pageTo`
//          query param; each call is a plain POST, no session/cookies
//          required. Verified reachable without a browser (see ADR-019).
const NOFLUFFJOBS_SEARCH_API_URL = `${NOFLUFFJOBS_BASE_URL}/api/search/posting`;
const NOFLUFFJOBS_CATEGORY_URL = `${NOFLUFFJOBS_BASE_URL}/pl/praca/javascript`;
const NOFLUFFJOBS_PAGE_SIZE = 20;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
  companySize?: string | number;
  company_size?: string | number;
  companyUrl?: string;
  company_url?: string;
  company?: {
    size?: string | number;
    url?: string;
  };
  advertiserType?: string;
  industry?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Extract salary string.
 * NoFluffJobs salary is always monthly (no 'unit' field), so just use from/to directly.
 */
export function extractSalary(salary?: RawNFJSalary): string | undefined {
  if (!salary) return undefined;
  if (salary.disclosedAt !== "VISIBLE") return undefined;
  const fromVal = salary.from && salary.from > 0 ? salary.from : undefined;
  const toVal = salary.to && salary.to > 0 ? salary.to : undefined;
  if (!fromVal && !toVal) return undefined;

  const typeLabel = salary.type === "b2b" ? "B2B" : salary.type.toUpperCase();
  const rangeStr =
    fromVal && toVal && fromVal !== toVal
      ? `${fromVal.toLocaleString("pl-PL")}–${toVal.toLocaleString("pl-PL")}`
      : `${(fromVal ?? toVal)!.toLocaleString("pl-PL")}`;
  return `${rangeStr} ${salary.currency.toUpperCase()} ${typeLabel}/mo`;
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

export function normalizePosting(posting: RawNoFluffPosting): JobOffer {
  const rawSize =
    posting.companySize ?? posting.company_size ?? posting.company?.size;
  const rawUrl =
    posting.companyUrl ?? posting.company_url ?? posting.company?.url;
  const size =
    rawSize !== undefined && rawSize !== null && String(rawSize).trim().length > 0
      ? String(rawSize).trim()
      : undefined;
  const companyUrl = normalizeCompanyUrl(
    typeof rawUrl === "string" ? rawUrl : undefined,
  );
  const advertiserType =
    typeof posting.advertiserType === "string" && posting.advertiserType.trim().length > 0
      ? posting.advertiserType.trim()
      : undefined;
  const industry =
    typeof posting.industry === "string" && posting.industry.trim().length > 0
      ? posting.industry.trim()
      : undefined;

  const companyMeta: CompanyMetadata | undefined =
    size || companyUrl || advertiserType || industry
      ? {
          ...(size ? { size } : {}),
          ...(companyUrl ? { companyUrl } : {}),
          ...(advertiserType ? { advertiserType } : {}),
          ...(industry ? { industry } : {}),
        }
      : undefined;

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
    ...(companyMeta ? { companyMeta } : {}),
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

    // Merge company metadata across location variants if one had it and other didn't
    const size =
      posting.companySize ??
      posting.company_size ??
      posting.company?.size ??
      existing.companySize ??
      existing.company_size ??
      existing.company?.size;
    const url =
      posting.companyUrl ??
      posting.company_url ??
      posting.company?.url ??
      existing.companyUrl ??
      existing.company_url ??
      existing.company?.url;
    const advertiserType =
      posting.advertiserType ?? existing.advertiserType;
    const industry =
      posting.industry ?? existing.industry;

    if (size !== undefined) {
      posting.companySize = size;
      existing.companySize = size;
    }
    if (url !== undefined) {
      posting.companyUrl = url;
      existing.companyUrl = url;
    }
    if (advertiserType !== undefined) {
      posting.advertiserType = advertiserType;
      existing.advertiserType = advertiserType;
    }
    if (industry !== undefined) {
      posting.industry = industry;
      existing.industry = industry;
    }

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

// ─── Search API client ────────────────────────────────────────────────────────

export interface NfjSearchResponse {
  postings: RawNoFluffPosting[];
  totalPages?: number;
  // Present when results are split by the site's "Salary Match" feature —
  // the actual next batch of postings lives here instead of in `postings`.
  additionalSearch?: { postings: RawNoFluffPosting[] }[];
}

/**
 * Pick the real postings batch out of a search response. The top-level
 * `postings` field is used for a plain result set; when the site segments
 * results by salary match, the batch instead shows up in
 * `additionalSearch[0].postings`.
 */
export function extractPostingsBatch(
  data: NfjSearchResponse,
): RawNoFluffPosting[] {
  if (data.postings.length > 0) return data.postings;
  return data.additionalSearch?.[0]?.postings ?? [];
}

async function fetchPostingsPage(
  pageTo: number,
): Promise<{ postings: RawNoFluffPosting[]; totalPages: number }> {
  const response = await axios.post<NfjSearchResponse>(
    NOFLUFFJOBS_SEARCH_API_URL,
    {
      criteria: "",
      url: { searchParam: "praca", searchParam2: "javascript" },
      rawSearch: "praca javascript",
      pageSize: NOFLUFFJOBS_PAGE_SIZE,
      withSalaryMatch: true,
    },
    {
      params: {
        withSalaryMatch: true,
        pageTo,
        pageSize: NOFLUFFJOBS_PAGE_SIZE,
        salaryCurrency: "original",
        salaryPeriod: "original",
        region: "pl",
        language: "pl-PL",
      },
      headers: {
        Accept: "application/json, text/plain, */*",
        // The server distinguishes a fresh search (full snapshot in the
        // top-level `postings`) from a "load more" continuation (the real
        // next batch in `additionalSearch[0].postings`) by this content
        // type — it's what the site's own infinite-scroll button sends.
        // A plain "application/json" silently falls back to re-sending the
        // full (duplicated) first-page snapshot on every page.
        "Content-Type": "application/infiniteSearch+json",
        Referer: NOFLUFFJOBS_CATEGORY_URL,
        "User-Agent": config.playwright.userAgent,
      },
      timeout: config.playwright.requestTimeout,
    },
  );

  return {
    postings: extractPostingsBatch(response.data),
    totalPages: response.data.totalPages ?? 1,
  };
}

// ─── Main scraper ─────────────────────────────────────────────────────────────

// Safety cap on pages (each page is a distinct ~20-item batch)
const MAX_PAGES = 20;

export async function scrapeNoFluffJobs(): Promise<JobOffer[]> {
  try {
    console.log("[NoFluffJobs] Fetching JavaScript job listings...");
    const first = await fetchPostingsPage(1);

    console.log(
      `[NoFluffJobs] Page 1: ${first.postings.length} postings (totalPages: ${first.totalPages})`,
    );

    if (first.postings.length === 0) {
      console.warn("[NoFluffJobs] WARNING: 0 postings on page 1.");
      console.warn(
        "[NoFluffJobs] /api/search/posting contract may have changed — " +
          "re-check via DevTools (watch the 'Pokaż kolejne oferty' button's request).",
      );
      return [];
    }

    const cappedTotalPages = Math.min(first.totalPages, MAX_PAGES);
    const allPostings: RawNoFluffPosting[] = [...first.postings];

    for (let pageTo = 2; pageTo <= cappedTotalPages; pageTo++) {
      // Polite inter-request delay — rapid back-to-back calls were observed
      // to make the server fall back to repeating page 1's data instead of
      // returning the next batch (see ADR-019).
      await sleep(500);

      const { postings } = await fetchPostingsPage(pageTo);
      allPostings.push(...postings);
      console.log(
        `[NoFluffJobs] Page ${pageTo}/${cappedTotalPages}: ${postings.length} postings (running total: ${allPostings.length})`,
      );
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
  } catch (err) {
    console.error("[NoFluffJobs] Scraper failed:", err);
    return [];
  }
}
