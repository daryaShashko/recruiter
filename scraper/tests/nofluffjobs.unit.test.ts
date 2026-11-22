import axios from 'axios';
import {
  extractPostingsBatch,
  extractSalary,
  fetchPostingDetail,
  matchesNFJPreFilter,
  normalizePosting,
  scrapeNoFluffJobs,
  deduplicateByReference,
  RawNoFluffPosting,
} from '../src/scrapers/nofluffjobs';

const DAY_MS = 24 * 60 * 60 * 1000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePosting(overrides: Partial<RawNoFluffPosting> = {}): RawNoFluffPosting {
  return {
    id: 'test-id-1',
    name: 'Test Company',
    title: 'Senior Developer',
    url: 'senior-developer-test-co',
    reference: 'REF001',
    posted: 1700000000000,
    technology: 'javascript',
    category: 'frontend',
    seniority: ['Senior'],
    location: {
      places: [],
      fullyRemote: false,
      covidTimeRemotely: false,
    },
    fullyRemote: false,
    ...overrides,
  };
}

// ─── extractPostingsBatch ──────────────────────────────────────────────────────

describe('extractPostingsBatch', () => {
  it('returns the top-level postings when present', () => {
    const posting = makePosting();
    const result = extractPostingsBatch({ postings: [posting], totalPages: 3 });
    expect(result).toEqual([posting]);
  });

  it('falls back to additionalSearch[0].postings when top-level postings is empty', () => {
    const posting = makePosting({ id: 'from-additional-search' });
    const result = extractPostingsBatch({
      postings: [],
      additionalSearch: [{ postings: [posting] }],
    });
    expect(result).toEqual([posting]);
  });

  it('returns an empty array when both postings and additionalSearch are empty/absent', () => {
    expect(extractPostingsBatch({ postings: [] })).toEqual([]);
    expect(extractPostingsBatch({ postings: [], additionalSearch: [] })).toEqual([]);
  });
});

// ─── deduplicateByReference ───────────────────────────────────────────────────

describe('deduplicateByReference', () => {
  it('keeps the remote variant when two postings share the same reference', () => {
    const remote = makePosting({
      id: 'remote-id',
      reference: 'REF001',
      location: { places: [], fullyRemote: true, covidTimeRemotely: false },
    });
    const office = makePosting({
      id: 'office-id',
      reference: 'REF001',
      location: {
        places: [{ city: 'Warszawa', url: 'warszawa' }],
        fullyRemote: false,
        covidTimeRemotely: false,
      },
    });

    // office is seen first (would normally win), but remote should override it
    const result = deduplicateByReference([office, remote]);
    expect(result).toHaveLength(1);
    expect(result[0].location.fullyRemote).toBe(true);
  });

  it('keeps the Gdańsk variant over a non-Gdańsk variant with the same reference', () => {
    const gdansk = makePosting({
      id: 'gdansk-id',
      reference: 'REF002',
      location: {
        places: [{ city: 'Gdańsk', url: 'gdansk' }],
        fullyRemote: false,
        covidTimeRemotely: false,
      },
    });
    const krakow = makePosting({
      id: 'krakow-id',
      reference: 'REF002',
      location: {
        places: [{ city: 'Kraków', url: 'krakow' }],
        fullyRemote: false,
        covidTimeRemotely: false,
      },
    });

    // krakow is seen first; gdansk should override it because it has priority
    const result = deduplicateByReference([krakow, gdansk]);
    expect(result).toHaveLength(1);
    expect(result[0].location.places[0].city).toBe('Gdańsk');
  });

  it('keeps all postings when every reference is unique', () => {
    const p1 = makePosting({ id: 'id-1', reference: 'REF001' });
    const p2 = makePosting({ id: 'id-2', reference: 'REF002' });
    const p3 = makePosting({ id: 'id-3', reference: 'REF003' });

    const result = deduplicateByReference([p1, p2, p3]);
    expect(result).toHaveLength(3);
  });

  it('merges company metadata across variants without mutating input objects in place', () => {
    const warsawVariant = makePosting({
      reference: 'REF-IMMUTABLE',
      location: {
        places: [{ city: 'Warsaw', url: '/warsaw' }],
        fullyRemote: false,
        covidTimeRemotely: false,
      },
      companySize: '100-250',
      companyUrl: undefined,
      industry: 'FinTech',
    });

    const remoteVariant = makePosting({
      reference: 'REF-IMMUTABLE',
      location: {
        places: [{ city: 'Krakow', url: '/krakow' }],
        fullyRemote: true,
        covidTimeRemotely: false,
      },
      companySize: undefined,
      companyUrl: 'https://acme.example.com',
      advertiserType: 'direct',
      industry: undefined,
    });

    const warsawSnapshot = JSON.parse(JSON.stringify(warsawVariant)) as unknown;
    const remoteSnapshot = JSON.parse(JSON.stringify(remoteVariant)) as unknown;

    const deduped = deduplicateByReference([warsawVariant, remoteVariant]);

    // Input objects must remain completely untouched
    expect(warsawVariant).toEqual(warsawSnapshot);
    expect(remoteVariant).toEqual(remoteSnapshot);
    expect(warsawVariant.companyUrl).toBeUndefined();
    expect(remoteVariant.companySize).toBeUndefined();
    expect(remoteVariant.industry).toBeUndefined();

    // Deduped output has merged metadata and preferred remote variant
    expect(deduped).toHaveLength(1);
    expect(deduped[0]).not.toBe(warsawVariant);
    expect(deduped[0]).not.toBe(remoteVariant);
    expect(deduped[0].location.fullyRemote).toBe(true);
    expect(deduped[0].companySize).toBe('100-250');
    expect(deduped[0].companyUrl).toBe('https://acme.example.com');
    expect(deduped[0].advertiserType).toBe('direct');
    expect(deduped[0].industry).toBe('FinTech');
  });
});

// ─── Detail enrichment & renewed freshness (WP-1.1b) ─────────────────────────

describe('nofluffjobs scraper (WP-1.1b)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('fetchPostingDetail & scrapeNoFluffJobs detail enrichment', () => {
    it('enriches offer.body with detailed description text (body.length > 300) and only fetches detail for pre-filtered postings', async () => {
      const validPosting = makePosting({
        reference: 'REF-KEEP',
        url: '/senior-ts-dev-acme-123',
        posted: Date.now() - 2 * DAY_MS,
        location: {
          places: [{ city: 'Warsaw', url: '/warsaw' }],
          fullyRemote: true,
          covidTimeRemotely: false,
        },
        fullyRemote: true,
        tiles: {
          values: [
            { value: 'React', type: 'requirement' },
            { value: 'TypeScript', type: 'requirement' },
          ],
        },
      });
      const rejectedJuniorPosting = makePosting({
        reference: 'REF-REJECT-JUNIOR',
        url: '/junior-ts-dev-acme-456',
        posted: Date.now() - 2 * DAY_MS,
        seniority: ['Junior'],
        location: {
          places: [],
          fullyRemote: true,
          covidTimeRemotely: false,
        },
        fullyRemote: true,
      });

      jest.spyOn(axios, 'post').mockResolvedValueOnce({
        data: {
          postings: [validPosting, rejectedJuniorPosting],
          totalPages: 1,
        },
      });

      const getSpy = jest.spyOn(axios, 'get').mockResolvedValueOnce({
        data: {
          specs: {
            dailyTasks: [
              'Architect and build modern web applications using React 18 and TypeScript.',
              {
                value:
                  'Collaborate closely with product managers, designers, and backend engineers across distributed teams.',
              },
            ],
          },
          body: {
            sections: [
              {
                body: '<p>We are looking for a pragmatic Senior Frontend Engineer to lead our customer-facing platform architecture and mentor engineers.</p>',
              },
            ],
            requirements: {
              description:
                '<p>At least 5+ years of production experience building SPA and SSR applications.</p>',
              musts: [
                { value: 'Deep knowledge of TypeScript and modern JavaScript' },
                { text: 'State management and performance optimization' },
              ],
              nices: ['Experience with GraphQL and micro-frontends'],
            },
            details: {
              description:
                '<div>100% remote work within Poland or EU timezone with flexible hours.</div>',
            },
          },
        },
      });

      const offers = await scrapeNoFluffJobs();

      expect(offers).toHaveLength(1);
      expect(getSpy).toHaveBeenCalledTimes(1);
      expect(getSpy).toHaveBeenCalledWith(
        'https://nofluffjobs.com/api/posting/senior-ts-dev-acme-123',
        expect.objectContaining({
          headers: expect.objectContaining({
            Accept: 'application/json, text/plain, */*',
          }),
        }),
      );

      const offer = offers[0];
      expect(offer.body.length).toBeGreaterThan(300);
      expect(offer.body).toContain('Position: Senior Developer');
      expect(offer.body).toContain(
        'Architect and build modern web applications using React 18 and TypeScript.',
      );
      expect(offer.body).toContain(
        'We are looking for a pragmatic Senior Frontend Engineer',
      );
      expect(offer.body).toContain(
        'Deep knowledge of TypeScript and modern JavaScript',
      );
      expect(offer.body).toContain('Experience with GraphQL and micro-frontends');
      expect(offer.body).not.toContain('<p>');
      expect(offer.body).not.toContain('<div>');
    });

    it('gracefully falls back to buildBody(posting) when detail GET fails or returns empty data', async () => {
      const posting1 = makePosting({
        reference: 'REF-ERR',
        url: 'senior-frontend-err-1',
        posted: Date.now() - 2 * DAY_MS,
        location: { places: [], fullyRemote: true, covidTimeRemotely: false },
        fullyRemote: true,
      });
      const posting2 = makePosting({
        reference: 'REF-EMPTY',
        url: 'senior-frontend-empty-2',
        posted: Date.now() - 2 * DAY_MS,
        location: { places: [], fullyRemote: true, covidTimeRemotely: false },
        fullyRemote: true,
      });

      jest.spyOn(axios, 'post').mockResolvedValueOnce({
        data: {
          postings: [posting1, posting2],
          totalPages: 1,
        },
      });

      jest
        .spyOn(axios, 'get')
        .mockRejectedValueOnce(new Error('Request failed with status code 404'))
        .mockResolvedValueOnce({ data: {} });

      const offers = await scrapeNoFluffJobs();

      expect(offers).toHaveLength(2);
      const expectedFallback1 = normalizePosting(posting1).body;
      const expectedFallback2 = normalizePosting(posting2).body;

      expect(offers[0].body).toBe(expectedFallback1);
      expect(offers[1].body).toBe(expectedFallback2);
    });

    it('fetchPostingDetail returns undefined on network error', async () => {
      jest.spyOn(axios, 'get').mockRejectedValueOnce(new Error('Network Error'));
      const detail = await fetchPostingDetail('some-slug');
      expect(detail).toBeUndefined();
    });
  });

  describe('posting.renewed freshness and publishedAt precedence', () => {
    it('takes precedence over an old posting.posted in matchesNFJPreFilter and normalizePosting', () => {
      const oldPosted = Date.now() - 120 * DAY_MS; // 120 days ago (> 30-day maxAgeDays)
      const freshRenewed = Date.now() - 3 * DAY_MS; // 3 days ago

      const stalePosting = makePosting({
        posted: oldPosted,
        renewed: undefined,
        location: { places: [], fullyRemote: true, covidTimeRemotely: false },
        fullyRemote: true,
      });
      expect(matchesNFJPreFilter(stalePosting)).toBe(false);

      const renewedPosting = makePosting({
        posted: oldPosted,
        renewed: freshRenewed,
        location: { places: [], fullyRemote: true, covidTimeRemotely: false },
        fullyRemote: true,
      });
      expect(matchesNFJPreFilter(renewedPosting)).toBe(true);

      const normalized = normalizePosting(renewedPosting);
      expect(normalized.publishedAt).toBe(new Date(freshRenewed).toISOString());
    });
  });

  describe('extractSalary', () => {
    it('formats visible B2B salary range', () => {
      expect(
        extractSalary({
          from: 20000,
          to: 28000,
          type: 'b2b',
          currency: 'PLN',
          disclosedAt: 'VISIBLE',
          flexibleUpperBound: false,
        }),
      ).toContain('PLN B2B/mo');
    });
  });
});
