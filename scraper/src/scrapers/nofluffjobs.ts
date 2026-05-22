import { JobOffer } from '../types';
import { openPage } from '../utils/browser';

// TODO P1-11: Research actual XHR endpoint via DevTools before implementing
// Observed pattern: POST https://nofluffjobs.com/api/search/posting
const NOFLUFFJOBS_BASE_URL = 'https://nofluffjobs.com';
const NOFLUFFJOBS_API = 'https://nofluffjobs.com/api/search/posting';

interface RawNoFluffOffer {
  id: string;
  name: string; // job title
  title?: { orig: string };
  url: string;
  posted: string;
  salary?: {
    from: number;
    to: number;
    currency: string;
    type: string;
  };
  location?: {
    places?: Array<{ city?: string }>;
    fullyRemote?: boolean;
  };
  technology?: string;
  seniority?: string[];
  requirement?: {
    skills?: Array<{ value: string }>;
  };
  body?: string;
}

function normalizeOffer(raw: RawNoFluffOffer): JobOffer {
  const salaryStr = raw.salary
    ? `${raw.salary.from}–${raw.salary.to} ${raw.salary.currency} (${raw.salary.type})`
    : undefined;

  const location = raw.location?.fullyRemote
    ? 'Remote'
    : raw.location?.places?.map((p) => p.city).filter(Boolean).join(', ') ?? 'Unknown';

  const tags = [
    raw.technology?.toLowerCase(),
    ...(raw.requirement?.skills?.map((s) => s.value.toLowerCase()) ?? []),
    ...(raw.seniority ?? []),
  ].filter((t): t is string => Boolean(t));

  return {
    id: `nofluffjobs_${raw.id}`,
    title: raw.title?.orig ?? raw.name,
    company: '', // populated below if available in raw
    url: raw.url.startsWith('http') ? raw.url : `${NOFLUFFJOBS_BASE_URL}${raw.url}`,
    body: raw.body ?? raw.name,
    source: 'nofluffjobs',
    location,
    salary: salaryStr,
    tags,
    scrapedAt: new Date().toISOString(),
  };
}

/**
 * Intercept the NoFluffJobs search API response.
 */
export async function scrapeNoFluffJobs(): Promise<JobOffer[]> {
  const { page, context } = await openPage();
  const rawOffers: RawNoFluffOffer[] = [];

  try {
    console.log('[NoFluffJobs] Setting up response interceptor...');

    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('nofluffjobs.com/api/search/posting')) {
        try {
          const json = await response.json();
          const offers: RawNoFluffOffer[] =
            json.postings ?? json.items ?? json.data ?? json ?? [];
          if (Array.isArray(offers)) {
            rawOffers.push(...offers);
            console.log(`[NoFluffJobs] Intercepted ${offers.length} offers`);
          }
        } catch {
          // Not JSON, ignore
        }
      }
    });

    console.log('[NoFluffJobs] Navigating to job listings...');
    await page.goto(
      `${NOFLUFFJOBS_BASE_URL}/pl/praca/javascript?criteria=seniority%3Dsenior%2Clead`,
      { waitUntil: 'networkidle' }
    );

    await page.waitForTimeout(3_000);

    console.log(`[NoFluffJobs] Total raw offers collected: ${rawOffers.length}`);

    if (rawOffers.length === 0) {
      console.warn(
        '[NoFluffJobs] WARNING: No offers intercepted. API endpoint may have changed.'
      );
    }

    return rawOffers.map(normalizeOffer);
  } finally {
    await context.close();
  }
}
