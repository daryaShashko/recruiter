import axios from "axios";
import { JobOffer } from "../types";
import { config } from "../config";
import {
  evaluateGlobalFilter,
  GlobalFilterReason,
  logFilterStats,
  parseDate,
  stripHtml,
} from "../utils/global-filter";

// SwissDevJobs publishes a plain XML feed meant for job aggregators (the
// data is public already, no auth/robots.txt block). No XML parser
// dependency is added — the feed is a flat, non-nested <job> record per
// entry, so a conservative regex extractor is enough and keeps this scraper
// dependency-free, matching the rest of scraper/src/scrapers/*.
const { feedUrl } = config.global.swissdevjobs;

export interface RawSwissDevJob {
  id: string;
  title: string;
  company: string;
  url: string;
  location?: string;
  city?: string;
  salary?: string;
  description?: string;
  pubdate?: string; // dd.mm.yyyy
  advertiserType?: string; // 'Company' | 'Agency'
}

const JOB_BLOCK_RE = /<job\b[^>]*>([\s\S]*?)<\/job>/g;

function extractTag(block: string, tag: string): string | undefined {
  const match = new RegExp(
    `<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`,
  ).exec(block);
  return match ? match[1].trim() : undefined;
}

export function parseFeed(xml: string): RawSwissDevJob[] {
  const jobs: RawSwissDevJob[] = [];
  let match: RegExpExecArray | null;
  while ((match = JOB_BLOCK_RE.exec(xml)) !== null) {
    const block = match[1];
    const id = extractTag(block, "id");
    const title = extractTag(block, "title");
    const company = extractTag(block, "company");
    const url = extractTag(block, "url") ?? extractTag(block, "link");
    if (!id || !title || !company || !url) {
      continue; // skip malformed entries rather than throw
    }
    jobs.push({
      id,
      title,
      company,
      url,
      location: extractTag(block, "location"),
      city: extractTag(block, "city"),
      salary: extractTag(block, "salary"),
      description: extractTag(block, "description"),
      pubdate: extractTag(block, "pubdate"),
      advertiserType: extractTag(block, "AdvertiserType"),
    });
  }
  return jobs;
}

export function normalizeJob(job: RawSwissDevJob): JobOffer {
  return {
    id: `swissdevjobs_${job.id}`,
    title: job.title,
    company: job.company,
    url: job.url,
    body: stripHtml(job.description ?? ""),
    source: "swissdevjobs",
    location: job.city || job.location || "Switzerland",
    salary: job.salary,
    scrapedAt: new Date().toISOString(),
  };
}

export async function scrapeSwissDevJobs(): Promise<JobOffer[]> {
  try {
    console.log("[SwissDevJobs] Fetching job feed...");
    const response = await axios.get<string>(feedUrl, {
      timeout: config.global.requestTimeoutMs,
      responseType: "text",
    });

    const jobs = parseFeed(response.data);
    console.log(`[SwissDevJobs] Parsed ${jobs.length} jobs from feed`);

    if (jobs.length === 0) {
      console.warn(
        "[SwissDevJobs] WARNING: 0 jobs parsed. job_feed.xml structure may have changed.",
      );
      return [];
    }

    const reasons: GlobalFilterReason[] = [];
    const filtered = jobs.filter((job) => {
      const description = stripHtml(job.description ?? "");
      const reason = evaluateGlobalFilter({
        title: job.title,
        description,
        publishedAt: parseDate(job.pubdate),
      });
      reasons.push(reason);
      return reason === "ok";
    });
    logFilterStats("SwissDevJobs", reasons);

    return filtered.map(normalizeJob);
  } catch (err) {
    console.error("[SwissDevJobs] Scraper failed:", err);
    return [];
  }
}
