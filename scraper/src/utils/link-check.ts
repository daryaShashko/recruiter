import axios from "axios";
import { config } from "../config";
import { JobOffer } from "../types";

type Source = JobOffer["source"];

/**
 * Sources whose dead links still answer HTTP 200 (generic listing / error page)
 * but whose live pages put the vacancy title in <title>. Verified live 2026-11.
 */
const TITLE_CHECKED: ReadonlySet<Source> = new Set([
  "justjoin",
  "nofluffjobs",
  "greenhouse",
  "lever",
  "ashby",
  "workable",
  "thehub",
]);

/**
 * Sources without a usable <title> (or with redirect links): only a hard
 * 404/410 marks the link dead. Blocks (403/429) and 5xx are not "dead".
 */
const STATUS_CHECKED: ReadonlySet<Source> = new Set([
  "recruitee",
  "personio",
  "swissdevjobs",
  "adzuna",
]);

const CONCURRENCY = 5;

function normalize(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * True when the page behind `offer.url` is that exact vacancy: HTTP 200 and the
 * page <title> contains the offer title. Dead or expired postings on both boards
 * still answer 200 but render a generic listing/error title, which fails here.
 */
export async function isOfferLinkValid(offer: JobOffer): Promise<boolean> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await axios.get<string>(offer.url, {
        headers: { "User-Agent": config.playwright.userAgent },
        timeout: config.global.requestTimeoutMs,
        responseType: "text",
        maxRedirects: 3,
        validateStatus: () => true,
      });
      if (STATUS_CHECKED.has(offer.source)) {
        return res.status !== 404 && res.status !== 410;
      }
      if (res.status !== 200) return false;
      const match = /<title>([^<]*)<\/title>/i.exec(res.data);
      if (!match) return false;
      return normalize(match[1]).includes(normalize(offer.title));
    } catch {
      // retry once on network error, then treat as not verified
    }
  }
  return false;
}

/** Drops offers whose link does not open the exact vacancy. `linkedin`/`manual` pass through untouched. */
export async function filterValidLinks(offers: JobOffer[]): Promise<JobOffer[]> {
  const result = Array.from({ length: offers.length }, () => true);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < offers.length) {
      const i = next++;
      if (
        TITLE_CHECKED.has(offers[i].source) ||
        STATUS_CHECKED.has(offers[i].source)
      ) {
        result[i] = await isOfferLinkValid(offers[i]);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const dropped = offers.filter((_, i) => !result[i]);
  if (dropped.length > 0) {
    console.log(
      `[LinkCheck] Dropped ${dropped.length} offers with dead/mismatched links`,
    );
    dropped
      .slice(0, 10)
      .forEach((o) => console.log(`  [LinkCheck] ✗ ${o.url}`));
  }
  return offers.filter((_, i) => result[i]);
}
