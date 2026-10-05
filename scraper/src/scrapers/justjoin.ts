import axios from "axios";
import { JobOffer } from "../types";
import { config } from "../config";

const JUSTJOIN_BASE_URL = "https://justjoin.it";
// Verified via DevTools — 2025-05; verified reachable via plain HTTP (no
// browser) from a GitHub Actions runner — 2026-10 (see ADR-019).
const JUSTJOIN_API_PATH = "/api/candidate-api/offers";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Raw API types (confirmed from actual response) ──────────────────────────

export interface RawEmploymentType {
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

export interface RawLocation {
  city: string;
  street?: string;
  latitude?: number;
  longitude?: number;
  slug: string;
}

export interface RawSkill {
  name: string;
  level: number; // 1–5
}

export interface RawJustJoinOffer {
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
export function extractSalary(types: RawEmploymentType[]): string | undefined {
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
export function extractLocation(offer: RawJustJoinOffer): string {
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
export function matchesPreFilter(offer: RawJustJoinOffer): boolean {
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

export function normalizeOffer(raw: RawJustJoinOffer): JobOffer {
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
// ADR-019 (2026-10): switched from Playwright XHR interception to a direct
// HTTP GET. The Cloudflare WAF blocking that justified Playwright in ADR-001
// (2024-07) no longer reproduces for this endpoint — verified from both a
// residential network and a GitHub Actions runner (datacenter IP), with and
// without a browser-like User-Agent.

// Safety cap — prevents runaway loops on unexpected totalItems values.
const JUSTJOIN_MAX_PAGES = 30;
const JUSTJOIN_PAGE_SIZE = 100;

interface JustJoinApiResponse {
  data?: RawJustJoinOffer[];
  meta?: { totalItems?: number };
}

async function fetchOffersPage(
  from: number,
): Promise<{ offers: RawJustJoinOffer[]; totalItems: number }> {
  const response = await axios.get<JustJoinApiResponse>(
    `${JUSTJOIN_BASE_URL}${JUSTJOIN_API_PATH}`,
    {
      params: {
        categories: "javascript",
        orderBy: "descending",
        sortBy: "publishedAt",
        from,
        perPage: JUSTJOIN_PAGE_SIZE,
      },
      headers: {
        Accept: "application/json",
        "User-Agent": config.playwright.userAgent,
      },
      timeout: config.playwright.requestTimeout,
    },
  );

  const offers = Array.isArray(response.data?.data) ? response.data.data : [];
  const totalItems =
    typeof response.data?.meta?.totalItems === "number"
      ? response.data.meta.totalItems
      : 0;

  return { offers, totalItems };
}

export async function scrapeJustJoin(): Promise<JobOffer[]> {
  const rawOffers: RawJustJoinOffer[] = [];

  try {
    console.log("[JustJoin] Fetching page 1...");
    const first = await fetchOffersPage(0);
    rawOffers.push(...first.offers);
    console.log(
      `[JustJoin] Page 1: ${first.offers.length} offers (totalItems: ${first.totalItems})`,
    );

    if (first.totalItems > JUSTJOIN_PAGE_SIZE) {
      const totalPages = Math.min(
        Math.ceil(first.totalItems / JUSTJOIN_PAGE_SIZE),
        JUSTJOIN_MAX_PAGES,
      );
      console.log(`[JustJoin] Fetching pages 2..${totalPages}...`);

      for (let pageNum = 2; pageNum <= totalPages; pageNum++) {
        // Polite inter-request delay
        await sleep(300);

        const fromOffset = (pageNum - 1) * JUSTJOIN_PAGE_SIZE;
        const { offers } = await fetchOffersPage(fromOffset);
        rawOffers.push(...offers);
        console.log(
          `[JustJoin] Page ${pageNum}/${totalPages}: ${offers.length} offers (running total: ${rawOffers.length})`,
        );
      }
    }

    console.log(`[JustJoin] Total raw offers collected: ${rawOffers.length}`);

    if (rawOffers.length === 0) {
      console.warn(
        "[JustJoin] WARNING: 0 offers collected — API contract may have changed. " +
          "Re-check via DevTools or scraper/src/debug-urls.ts.",
      );
      return [];
    }

    // Pre-filter before sending to LLM
    const filtered = rawOffers.filter(matchesPreFilter);
    console.log(
      `[JustJoin] Pre-filter (location + seniority): ${filtered.length}/${rawOffers.length} kept`,
    );

    return filtered.map(normalizeOffer);
  } catch (err) {
    console.error("[JustJoin] Scraper failed:", err);
    return [];
  }
}
