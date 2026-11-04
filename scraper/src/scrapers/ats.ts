import axios from "axios";
import { JobOffer } from "../types";
import { config } from "../config";
import {
  evaluateGlobalFilter,
  GlobalFilterReason,
  logFilterStats,
  parseDate,
  passesAgeFilter,
  passesTitleFilter,
  sleep,
  stripHtml,
} from "../utils/global-filter";

const { workable, recruitee, personio } = config.global.atsFeeds;
const timeout = config.global.requestTimeoutMs;

export interface RawWorkableJob {
  shortcode: string;
  title: string;
  url?: string;
  application_url?: string;
  published_on?: string;
  city?: string;
  country?: string;
  telecommuting?: boolean;
}

export interface RawWorkableDetail {
  description?: string;
  requirements?: string;
  location?: { city?: string; country?: string };
}

export interface RawRecruiteeOffer {
  id: number;
  title: string;
  slug: string;
  description?: string;
  requirements?: string;
  careers_url?: string;
  company_name?: string;
  city?: string;
  country?: string;
  country_code?: string;
  remote?: boolean;
  published_at?: string;
  created_at?: string;
  status?: string;
}

export interface RawPersonioPosition {
  id: string;
  name: string;
  subcompany?: string;
  office?: string;
  createdAt?: string;
  descriptions: string[];
}

interface WorkableWidget {
  name?: string;
  jobs?: RawWorkableJob[];
}

interface RecruiteeResponse {
  offers?: RawRecruiteeOffer[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getArray<T>(
  value: unknown,
  key: string,
): T[] {
  if (!isRecord(value) || !Array.isArray(value[key])) {
    throw new Error(`Unexpected API response: expected array field "${key}"`);
  }
  return value[key] as T[];
}

function xmlDecode(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'");
}

function extractPersonioTag(block: string, tag: string): string | undefined {
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(
    `<${escapedTag}>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))<\\/${escapedTag}>`,
  ).exec(block);
  if (match?.[1] !== undefined) {
    return match[1].trim();
  }
  return match?.[2] === undefined
    ? undefined
    : xmlDecode(match[2].trim());
}

function extractPersonioDescriptions(block: string): string[] {
  const descriptions: string[] = [];
  const descriptionBlocks = block.matchAll(
    /<jobDescription\b[^>]*>([\s\S]*?)<\/jobDescription>/g,
  );
  for (const descriptionBlock of descriptionBlocks) {
    const value = extractPersonioTag(descriptionBlock[1], "value");
    if (value) {
      descriptions.push(value);
    }
  }
  return descriptions;
}

export function parsePersonioXml(xml: string): RawPersonioPosition[] {
  if (!/<workzag-jobs(?:\s[^>]*)?>/i.test(xml)) {
    return [];
  }

  const positions: RawPersonioPosition[] = [];
  for (const match of xml.matchAll(/<position\b[^>]*>([\s\S]*?)<\/position>/g)) {
    const block = match[1];
    const id = extractPersonioTag(block, "id");
    const name = extractPersonioTag(block, "name");
    if (!id || !name) {
      continue;
    }
    positions.push({
      id,
      name,
      subcompany: extractPersonioTag(block, "subcompany"),
      office: extractPersonioTag(block, "office"),
      createdAt: extractPersonioTag(block, "createdAt"),
      descriptions: extractPersonioDescriptions(block),
    });
  }
  return positions;
}

export function normalizeWorkable(
  slug: string,
  company: string,
  job: RawWorkableJob,
  detail?: RawWorkableDetail,
): JobOffer {
  const body =
    stripHtml(
      [detail?.description, detail?.requirements]
        .filter((part): part is string => Boolean(part))
        .join("\n"),
    ) || job.title;
  const location = [
    detail?.location?.city ?? job.city,
    detail?.location?.country ?? job.country,
  ]
    .filter((part): part is string => Boolean(part))
    .join(", ");

  return {
    id: `workable_${slug}_${job.shortcode}`,
    title: job.title,
    company,
    url:
      job.application_url ??
      job.url ??
      `https://apply.workable.com/${slug}/j/${job.shortcode}/`,
    body,
    source: "workable",
    location: location || (job.telecommuting ? "Remote" : "Unknown"),
    scrapedAt: new Date().toISOString(),
  };
}

export function normalizeRecruitee(
  slug: string,
  offer: RawRecruiteeOffer,
): JobOffer {
  const body =
    stripHtml(
      [offer.description, offer.requirements]
        .filter((part): part is string => Boolean(part))
        .join("\n"),
    ) || offer.title;
  const location = [offer.city, offer.country]
    .filter((part): part is string => Boolean(part))
    .join(", ");

  return {
    id: `recruitee_${slug}_${offer.id}`,
    title: offer.title,
    company: offer.company_name ?? slug,
    url:
      offer.careers_url ??
      `https://${slug}.recruitee.com/o/${offer.slug}`,
    body,
    source: "recruitee",
    location: location || (offer.remote ? "Remote" : "Unknown"),
    scrapedAt: new Date().toISOString(),
  };
}

export function normalizePersonio(
  slug: string,
  position: RawPersonioPosition,
): JobOffer {
  return {
    id: `personio_${slug}_${position.id}`,
    title: position.name,
    company: position.subcompany ?? slug,
    url: `https://${slug}.jobs.personio.de/job/${position.id}`,
    body: stripHtml(position.descriptions.join("\n")) || position.name,
    source: "personio",
    location: position.office ?? "Unknown",
    scrapedAt: new Date().toISOString(),
  };
}

function passesFilter(
  title: string,
  description: string,
  publishedAt: unknown,
): GlobalFilterReason {
  return evaluateGlobalFilter({
    title,
    description: stripHtml(description),
    publishedAt: parseDate(publishedAt),
  });
}

async function scrapeWorkableSlug(slug: string): Promise<JobOffer[]> {
  const response = await axios.get<WorkableWidget>(
    `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(slug)}`,
    { timeout },
  );
  const jobs = getArray<RawWorkableJob>(response.data, "jobs");
  const company =
    isRecord(response.data) && typeof response.data.name === "string"
      ? response.data.name
      : slug;
  const offers: JobOffer[] = [];
  const reasons: GlobalFilterReason[] = [];

  for (const job of jobs) {
    if (!job || typeof job.title !== "string" || !job.shortcode) {
      continue;
    }
    if (!passesTitleFilter(job.title)) {
      continue;
    }
    if (!passesAgeFilter(parseDate(job.published_on))) {
      continue;
    }

    await sleep(config.global.requestDelayMs);
    let detail: RawWorkableDetail | undefined;
    try {
      const detailResponse = await axios.get<RawWorkableDetail>(
        `https://apply.workable.com/api/v2/accounts/${encodeURIComponent(slug)}/jobs/${encodeURIComponent(job.shortcode)}`,
        { timeout },
      );
      detail = detailResponse.data;
    } catch (error) {
      console.warn(
        `[ATS:workable:${slug}] Detail unavailable for ${job.shortcode}:`,
        error,
      );
    }

    const reason = passesFilter(
      job.title,
      [detail?.description, detail?.requirements]
        .filter((part): part is string => Boolean(part))
        .join("\n"),
      job.published_on,
    );
    reasons.push(reason);
    if (reason === "ok") {
      offers.push(normalizeWorkable(slug, company, job, detail));
    }
  }

  logFilterStats(`ATS:workable:${slug}`, reasons);
  return offers;
}

async function scrapeRecruiteeSlug(slug: string): Promise<JobOffer[]> {
  const response = await axios.get<RecruiteeResponse>(
    `https://${encodeURIComponent(slug)}.recruitee.com/api/offers/`,
    { timeout },
  );
  const offers = getArray<RawRecruiteeOffer>(response.data, "offers");
  const reasons: GlobalFilterReason[] = [];
  const kept: JobOffer[] = [];

  for (const offer of offers) {
    if (
      !offer ||
      typeof offer.title !== "string" ||
      typeof offer.id !== "number" ||
      typeof offer.slug !== "string"
    ) {
      continue;
    }
    const reason = passesFilter(
      offer.title,
      [offer.description, offer.requirements]
        .filter((part): part is string => Boolean(part))
        .join("\n"),
      offer.published_at ?? offer.created_at,
    );
    reasons.push(reason);
    if (reason === "ok") {
      kept.push(normalizeRecruitee(slug, offer));
    }
  }

  logFilterStats(`ATS:recruitee:${slug}`, reasons);
  return kept;
}

async function scrapePersonioSlug(slug: string): Promise<JobOffer[]> {
  const response = await axios.get<unknown>(
    `https://${encodeURIComponent(slug)}.jobs.personio.de/xml?language=en`,
    { timeout, responseType: "text" },
  );
  if (typeof response.data !== "string") {
    throw new Error("Personio feed response was not XML text");
  }

  const positions = parsePersonioXml(response.data);
  const reasons: GlobalFilterReason[] = [];
  const kept: JobOffer[] = [];
  for (const position of positions) {
    const reason = passesFilter(
      position.name,
      position.descriptions.join("\n"),
      position.createdAt,
    );
    reasons.push(reason);
    if (reason === "ok") {
      kept.push(normalizePersonio(slug, position));
    }
  }

  logFilterStats(`ATS:personio:${slug}`, reasons);
  return kept;
}

async function scrapeSlugs(
  family: string,
  slugs: readonly string[],
  scrapeSlug: (slug: string) => Promise<JobOffer[]>,
): Promise<JobOffer[]> {
  const results: JobOffer[] = [];
  for (const slug of slugs) {
    try {
      await sleep(config.global.requestDelayMs);
      results.push(...(await scrapeSlug(slug)));
    } catch (error) {
      console.error(`[ATS:${family}:${slug}] Failed:`, error);
    }
  }
  return results;
}

export async function scrapeAts(): Promise<JobOffer[]> {
  try {
    const [workableOffers, recruiteeOffers, personioOffers] = await Promise.all([
      scrapeSlugs("workable", workable, scrapeWorkableSlug),
      scrapeSlugs("recruitee", recruitee, scrapeRecruiteeSlug),
      scrapeSlugs("personio", personio, scrapePersonioSlug),
    ]);
    const offers = [
      ...workableOffers,
      ...recruiteeOffers,
      ...personioOffers,
    ];
    console.log(`[ATS] ${offers.length} offers from Workable, Recruitee, Personio`);
    return offers;
  } catch (error) {
    console.error("[ATS] Scraper failed:", error);
    return [];
  }
}
