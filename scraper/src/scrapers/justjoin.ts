import { Page } from 'playwright';
import { JobOffer } from '../types';
import { openPage } from '../utils/browser';
import { config } from '../config';

// TODO P1-6: Research actual XHR endpoint via DevTools before implementing
// Observed pattern: GET https://api.justjoin.it/v2/user-panel/offers?...
const JUSTJOIN_BASE_URL = 'https://justjoin.it';
const JUSTJOIN_API = 'https://api.justjoin.it/v2/user-panel/offers';

interface RawJustJoinOffer {
  id: string;
  slug: string;
  title: string;
  companyName: string;
  city: string | null;
  workplaceType: string;
  salaryFrom?: number;
  salaryTo?: number;
  salaryCurrency?: string;
  requiredSkills?: Array<{ name: string; level: number }>;
  body?: string;
  // NOTE: full body may require a separate detail request
}

function buildApiUrl(): string {
  const params = new URLSearchParams({
    page: '1',
    perPage: '100',
    sortBy: 'newest',
    orderBy: 'DESC',
    withSalary: 'false',
  });
  return `${JUSTJOIN_API}?${params.toString()}`;
}

function normalizeOffer(raw: RawJustJoinOffer): JobOffer {
  const salaryStr =
    raw.salaryFrom && raw.salaryTo
      ? `${raw.salaryFrom}–${raw.salaryTo} ${raw.salaryCurrency ?? 'PLN'}`
      : undefined;

  return {
    id: `justjoin_${raw.slug ?? raw.id}`,
    title: raw.title,
    company: raw.companyName,
    url: `${JUSTJOIN_BASE_URL}/job-offer/${raw.slug ?? raw.id}`,
    body: raw.body ?? raw.title, // body populated by fetchDetails()
    source: 'justjoin',
    location: raw.city ?? (raw.workplaceType === 'remote' ? 'Remote' : 'Unknown'),
    salary: salaryStr,
    tags: raw.requiredSkills?.map((s) => s.name.toLowerCase()) ?? [],
    scrapedAt: new Date().toISOString(),
  };
}

/**
 * Intercept the JustJoin API response by navigating to the site
 * and capturing the XHR call that loads the job listings.
 */
export async function scrapeJustJoin(): Promise<JobOffer[]> {
  const { page, context } = await openPage();
  const rawOffers: RawJustJoinOffer[] = [];

  try {
    console.log('[JustJoin] Setting up response interceptor...');

    // Intercept API responses
    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('api.justjoin.it') && url.includes('/offers')) {
        try {
          const json = await response.json();
          const offers: RawJustJoinOffer[] = json.data ?? json.offers ?? json ?? [];
          if (Array.isArray(offers)) {
            rawOffers.push(...offers);
            console.log(`[JustJoin] Intercepted ${offers.length} offers from ${url}`);
          }
        } catch {
          // Response might not be JSON, ignore
        }
      }
    });

    // Navigate to the JavaScript jobs page in Gdansk
    // This triggers the API call internally
    console.log('[JustJoin] Navigating to job listings...');
    await page.goto(
      `${JUSTJOIN_BASE_URL}/job-offers/all-locations/javascript?with-salary=false&orderBy=DESC&sortBy=newest`,
      { waitUntil: 'networkidle' }
    );

    // Wait a bit for lazy-loaded content
    await page.waitForTimeout(3_000);

    console.log(`[JustJoin] Total raw offers collected: ${rawOffers.length}`);

    if (rawOffers.length === 0) {
      console.warn('[JustJoin] WARNING: No offers intercepted. API endpoint may have changed.');
    }

    return rawOffers.map(normalizeOffer);
  } finally {
    await context.close();
  }
}
