import axios from "axios";
import { JobOffer } from "../types";
import { config } from "../config";
import {
  evaluateGlobalFilter,
  GlobalFilterReason,
  logFilterStats,
  parseDate,
  sleep,
  stripHtml,
} from "../utils/global-filter";

const { apiBaseUrl, appId, appKey, countries, resultsPerPage, query, maxDaysOld } =
  config.global.adzuna;

// Raw shape from GET /v1/api/jobs/{country}/search/1 (verified 2026-11-04).
// `description` is a ~500-char snippet on this API, not the full text.
export interface RawAdzunaJob {
  id: string;
  title: string;
  description?: string;
  created?: string;
  redirect_url?: string;
  company?: { display_name?: string };
  location?: { display_name?: string };
  salary_min?: number;
  salary_max?: number;
}

export interface RawAdzunaSearchResponse {
  count?: number;
  results?: RawAdzunaJob[];
}

async function fetchCountry(country: string): Promise<RawAdzunaJob[]> {
  const response = await axios.get<RawAdzunaSearchResponse>(
    `${apiBaseUrl}/jobs/${country}/search/1`,
    {
      params: {
        app_id: appId,
        app_key: appKey,
        what_and: query,
        max_days_old: maxDaysOld,
        results_per_page: resultsPerPage,
      },
      headers: { Accept: "application/json" },
      timeout: config.global.requestTimeoutMs,
    },
  );
  return response.data.results ?? [];
}

export function normalizeAdzunaJob(
  job: RawAdzunaJob,
  country: string,
): JobOffer {
  const salary =
    job.salary_min && job.salary_max
      ? `${Math.round(job.salary_min)}–${Math.round(job.salary_max)} (${country.toUpperCase()}, Adzuna)`
      : undefined;
  return {
    id: `adzuna_${job.id}`,
    title: job.title,
    company: job.company?.display_name ?? "Unknown",
    // redirect_url is Adzuna's tracking link; it leads to the original posting.
    url: job.redirect_url ?? "",
    body: stripHtml(job.description ?? ""),
    source: "adzuna",
    location: job.location?.display_name ?? "Unknown",
    salary,
    scrapedAt: new Date().toISOString(),
  };
}

export async function scrapeAdzuna(): Promise<JobOffer[]> {
  if (!appId || !appKey) {
    console.warn(
      "[Adzuna] ADZUNA_APP_ID / ADZUNA_APP_KEY not set, skipping",
    );
    return [];
  }

  try {
    console.log(`[Adzuna] Searching ${countries.join(", ")}...`);
    const seen = new Map<string, { job: RawAdzunaJob; country: string }>();

    for (const country of countries) {
      const jobs = await fetchCountry(country);
      for (const job of jobs) {
        if (!seen.has(job.id)) {
          seen.set(job.id, { job, country });
        }
      }
      await sleep(config.global.requestDelayMs);
    }

    if (seen.size === 0) {
      console.warn(
        "[Adzuna] WARNING: 0 results. Check keys, quota, or the api contract.",
      );
      return [];
    }

    const reasons: GlobalFilterReason[] = [];
    const kept: JobOffer[] = [];
    for (const { job, country } of seen.values()) {
      const reason = evaluateGlobalFilter({
        title: job.title,
        description: job.description,
        publishedAt: parseDate(job.created),
      });
      reasons.push(reason);
      if (reason === "ok") {
        kept.push(normalizeAdzunaJob(job, country));
      }
    }
    logFilterStats("Adzuna", reasons);
    return kept;
  } catch (err) {
    console.error("[Adzuna] Scraper failed:", err);
    return [];
  }
}
