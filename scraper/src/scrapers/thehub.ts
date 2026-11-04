import axios from "axios";
import { JobOffer } from "../types";
import { config } from "../config";
import {
  evaluateGlobalFilter,
  GlobalFilterReason,
  logFilterStats,
  parseDate,
  passesTitleFilter,
  sleep,
  stripHtml,
} from "../utils/global-filter";

// api.thehub.io/v2/jobs and /jobs/single/{id} are the Nordic startup board
// TheHub's own frontend calls — found via its Nuxt JS bundles, 2026-11-04.
// No auth, no robots.txt block on these paths. countryCode filters the list;
// isRemote on the list items is unreliable (see ADR-020 research), so this
// scraper relies on per-country pagination rather than a remote-only query.
const { apiBaseUrl, siteBaseUrl, countries, maxPagesPerCountry } =
  config.global.thehub;
const LIST_PAGE_SIZE = 100;

export interface RawTheHubListItem {
  id: string;
  title: string;
  company?: { name?: string };
}

export interface RawTheHubListResponse {
  total: number;
  pages: number;
  docs: RawTheHubListItem[];
}

export interface RawTheHubJobDetail {
  id: string;
  title: string;
  company?: { name?: string };
  countryCode?: string;
  description?: string;
  salary?: string;
  status?: string;
  link?: string;
  publishedAt?: string;
  approvedAt?: string;
  expirationDate?: string;
}

async function fetchListPage(
  countryCode: string,
  page: number,
): Promise<RawTheHubListResponse> {
  const response = await axios.get<RawTheHubListResponse>(
    `${apiBaseUrl}/v2/jobs`,
    {
      params: { countryCode, page, limit: LIST_PAGE_SIZE },
      timeout: config.global.requestTimeoutMs,
    },
  );
  return response.data;
}

async function fetchJobDetail(
  id: string,
): Promise<RawTheHubJobDetail | undefined> {
  try {
    const response = await axios.get<RawTheHubJobDetail>(
      `${apiBaseUrl}/jobs/single/${id}`,
      { timeout: config.global.requestTimeoutMs },
    );
    return response.data;
  } catch (err) {
    console.error(`[TheHub] Failed to fetch detail for ${id}:`, err);
    return undefined;
  }
}

async function fetchAllListItemsForCountry(
  countryCode: string,
): Promise<RawTheHubListItem[]> {
  const first = await fetchListPage(countryCode, 1);
  const items = [...first.docs];
  const pages = Math.min(first.pages, maxPagesPerCountry);

  for (let page = 2; page <= pages; page++) {
    await sleep(config.global.requestDelayMs);
    const next = await fetchListPage(countryCode, page);
    items.push(...next.docs);
  }
  return items;
}

export function normalizeDetail(detail: RawTheHubJobDetail): JobOffer {
  const description = stripHtml(detail.description ?? "");
  return {
    id: `thehub_${detail.id}`,
    title: detail.title,
    company: detail.company?.name ?? "Unknown",
    // Fall back to the TheHub listing itself when the posting has no
    // external apply link (some postings only expose a contact email).
    url: detail.link ?? `${siteBaseUrl}/jobs/${detail.id}`,
    body: description,
    source: "thehub",
    location: detail.countryCode ?? "Unknown",
    salary:
      detail.salary && detail.salary !== "competitive"
        ? detail.salary
        : undefined,
    scrapedAt: new Date().toISOString(),
  };
}

export async function scrapeTheHub(): Promise<JobOffer[]> {
  try {
    console.log(`[TheHub] Fetching listings for ${countries.join(", ")}...`);

    const listItemsByCountry = await Promise.all(
      countries.map((country) => fetchAllListItemsForCountry(country)),
    );
    const listItems = listItemsByCountry.flat();
    const uniqueItems = [...new Map(listItems.map((j) => [j.id, j])).values()];

    console.log(
      `[TheHub] ${uniqueItems.length} unique listings across ${countries.length} countries`,
    );

    if (uniqueItems.length === 0) {
      console.warn(
        "[TheHub] WARNING: 0 listings. api.thehub.io/v2/jobs contract may have changed.",
      );
      return [];
    }

    // Cheap title-only filter on list data BEFORE spending a detail request
    // per job — detail fetches are one HTTP call each and would otherwise
    // make this scraper take tens of minutes across 4 countries (~1000 jobs).
    const candidates = uniqueItems.filter((item) =>
      passesTitleFilter(item.title),
    );
    console.log(
      `[TheHub] Title pre-filter: ${candidates.length}/${uniqueItems.length} candidates for detail fetch`,
    );

    const details: RawTheHubJobDetail[] = [];
    for (const item of candidates) {
      await sleep(config.global.requestDelayMs);
      const detail = await fetchJobDetail(item.id);
      if (detail) {
        details.push(detail);
      }
    }
    console.log(`[TheHub] Fetched ${details.length}/${candidates.length} details`);

    const reasons: GlobalFilterReason[] = [];
    const filtered = details.filter((detail) => {
      const reason = evaluateGlobalFilter({
        title: detail.title,
        description: detail.description
          ? stripHtml(detail.description)
          : undefined,
        publishedAt: parseDate(detail.publishedAt ?? detail.approvedAt),
        expiresAt: parseDate(detail.expirationDate),
      });
      reasons.push(reason);
      return reason === "ok" && detail.status === "ACTIVE";
    });
    logFilterStats("TheHub", reasons);

    return filtered.map(normalizeDetail);
  } catch (err) {
    console.error("[TheHub] Scraper failed:", err);
    return [];
  }
}
