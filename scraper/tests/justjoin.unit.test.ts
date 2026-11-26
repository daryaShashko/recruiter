import axios from 'axios';
import {
  extractSalary,
  extractLocation,
  fetchOfferDetail,
  fetchOffersPage,
  matchesPreFilter,
  normalizeOffer,
  scrapeJustJoin,
  JUSTJOIN_MAX_PAGES,
  RawEmploymentType,
  RawJustJoinOffer,
} from '../src/scrapers/justjoin';
import { enrichMissingSalaries } from '../src/utils/salary-enricher';
import { JobOffer } from '../src/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeOffer(overrides: Partial<RawJustJoinOffer> = {}): RawJustJoinOffer {
  return {
    guid: 'test-guid',
    slug: 'senior-developer-test-co',
    title: 'Senior Developer',
    workplaceType: 'remote',
    workingTime: 'full_time',
    experienceLevel: 'senior',
    city: '',
    companyName: 'Test Co',
    publishedAt: new Date().toISOString(),
    locations: [],
    employmentTypes: [],
    requiredSkills: [],
    niceToHaveSkills: [],
    ...overrides,
  };
}

function makePlnB2bMonthly(from: number, to: number): RawEmploymentType {
  return {
    from,
    to,
    currency: 'PLN',
    currencySource: 'original',
    type: 'b2b',
    unit: 'Month',
    gross: false,
  };
}

// ─── extractSalary ────────────────────────────────────────────────────────────

describe('extractSalary', () => {
  it('returns a salary string for b2b PLN monthly', () => {
    const result = extractSalary([makePlnB2bMonthly(800, 950)]);
    expect(result).toBeDefined();
    expect(result).toContain('PLN');
    expect(result).toContain('B2B');
    expect(result).toContain('/mo');
  });

  it('returns a salary string for EUR original B2B monthly offer when no PLN original entry exists', () => {
    const types: RawEmploymentType[] = [{
      from: 4000,
      to: 6000,
      currency: 'EUR',
      currencySource: 'original',
      type: 'b2b',
      unit: 'Month',
      gross: false,
    }];
    const result = extractSalary(types);
    expect(result).toBeDefined();
    expect(result).toContain('EUR');
    expect(result).toContain('B2B/mo');
  });

  it('returns a salary string for USD original permanent/uop monthly offer', () => {
    const types: RawEmploymentType[] = [{
      from: 5000,
      to: 7000,
      currency: 'usd',
      currencySource: 'original',
      type: 'uop',
      unit: 'Month',
      gross: true,
    }];
    const result = extractSalary(types);
    expect(result).toBeDefined();
    expect(result).toContain('USD');
    expect(result).toContain('UOP/mo');
  });

  it('prefers PLN original B2B monthly over EUR conversion entry when both exist', () => {
    const types: RawEmploymentType[] = [
      {
        from: 4500,
        to: 5500,
        currency: 'EUR',
        currencySource: 'conversion',
        type: 'b2b',
        unit: 'Month',
        gross: false,
      },
      makePlnB2bMonthly(20000, 24000),
    ];
    const result = extractSalary(types);
    expect(result).toBeDefined();
    expect(result).toContain('PLN');
    expect(result).not.toContain('EUR');
    expect(result).toContain('B2B/mo');
  });

  it('falls back to conversion entry when only conversion entries have from/to', () => {
    const types: RawEmploymentType[] = [
      {
        currency: 'PLN',
        currencySource: 'original',
        type: 'b2b',
        unit: 'Month',
        gross: false,
      },
      {
        from: 18000,
        to: 22000,
        currency: 'PLN',
        currencySource: 'conversion',
        type: 'b2b',
        unit: 'Month',
        gross: false,
      },
    ];
    const result = extractSalary(types);
    expect(result).toBeDefined();
    expect(result).toContain('PLN');
    expect(result).toContain('B2B/mo');
  });

  it('returns undefined for empty array', () => {
    expect(extractSalary([])).toBeUndefined();
  });

  it('returns undefined when from/to are absent', () => {
    const types: RawEmploymentType[] = [{
      currency: 'PLN',
      currencySource: 'original',
      type: 'b2b',
      unit: 'Month',
      gross: false,
    }];
    expect(extractSalary(types)).toBeUndefined();
  });

  it('uses /h suffix for hourly rate', () => {
    const types: RawEmploymentType[] = [{
      from: 100,
      to: 150,
      currency: 'PLN',
      currencySource: 'original',
      type: 'b2b',
      unit: 'Hour',
      gross: false,
    }];
    const result = extractSalary(types);
    expect(result).toBeDefined();
    expect(result).toContain('/h');
    expect(result).not.toContain('/mo');
  });

  it('matches lowercase unit "hour" and "month" case-insensitively', () => {
    const hourly = extractSalary([{
      from: 130,
      to: 145,
      currency: 'PLN',
      currencySource: 'original',
      type: 'b2b',
      unit: 'hour',
      gross: false,
    }]);
    expect(hourly).toBeDefined();
    expect(hourly).toContain('/h');
    expect(hourly).not.toContain('/mo');
  });

  it('prefers fromPerUnit/toPerUnit for hourly rate when JustJoin precomputes monthly from/to', () => {
    const types: RawEmploymentType[] = [{
      from: 15120,
      to: 16800,
      fromPerUnit: 90,
      toPerUnit: 100,
      currency: 'PLN',
      currencySource: 'original',
      type: 'b2b',
      unit: 'Hour',
      gross: false,
    }];
    const result = extractSalary(types);
    expect(result).toBe('90–100 PLN B2B/h');
  });

  it('divides precomputed monthly from/to by 168 when fromPerUnit is absent for hourly offer', () => {
    const types: RawEmploymentType[] = [{
      from: 15120,
      to: 16800,
      currency: 'PLN',
      currencySource: 'original',
      type: 'b2b',
      unit: 'Hour',
      gross: false,
    }];
    const result = extractSalary(types);
    expect(result).toBe('90–100 PLN B2B/h');
  });
});

// ─── extractLocation ──────────────────────────────────────────────────────────

describe('extractLocation', () => {
  it('returns "Remote" for workplaceType remote', () => {
    const offer = makeOffer({ workplaceType: 'remote' });
    expect(extractLocation(offer)).toBe('Remote');
  });

  it('returns "Gdańsk" when Gdańsk appears in locations', () => {
    const offer = makeOffer({
      workplaceType: 'office',
      locations: [{ city: 'Gdańsk', slug: 'gdansk' }],
    });
    expect(extractLocation(offer)).toBe('Gdańsk');
  });

  it('returns city from locations when no Gdańsk present', () => {
    const offer = makeOffer({
      workplaceType: 'office',
      city: '',
      locations: [{ city: 'Kraków', slug: 'krakow' }],
    });
    expect(extractLocation(offer)).toBe('Kraków');
  });

  it('returns "Unknown" when locations are empty and city is empty', () => {
    const offer = makeOffer({
      workplaceType: 'office',
      city: '',
      locations: [],
    });
    expect(extractLocation(offer)).toBe('Unknown');
  });
});

// ─── matchesPreFilter ─────────────────────────────────────────────────────────

describe('matchesPreFilter', () => {
  it('allows remote + senior', () => {
    expect(matchesPreFilter(makeOffer({ workplaceType: 'remote', experienceLevel: 'senior' }))).toBe(true);
  });

  it('allows office + Gdańsk + senior', () => {
    const offer = makeOffer({
      workplaceType: 'office',
      experienceLevel: 'senior',
      locations: [{ city: 'Gdańsk', slug: 'gdansk' }],
    });
    expect(matchesPreFilter(offer)).toBe(true);
  });

  it('rejects office + non-Gdańsk city (Warszawa)', () => {
    const offer = makeOffer({
      workplaceType: 'office',
      experienceLevel: 'senior',
      locations: [{ city: 'Warszawa', slug: 'warszawa' }],
    });
    expect(matchesPreFilter(offer)).toBe(false);
  });

  it('rejects remote + junior', () => {
    expect(matchesPreFilter(makeOffer({ workplaceType: 'remote', experienceLevel: 'junior' }))).toBe(false);
  });

  it('rejects remote + mid', () => {
    expect(matchesPreFilter(makeOffer({ workplaceType: 'remote', experienceLevel: 'mid' }))).toBe(false);
  });

  it('allows remote + expert (not in rejectLevels)', () => {
    expect(matchesPreFilter(makeOffer({ workplaceType: 'remote', experienceLevel: 'expert' }))).toBe(true);
  });

  it('allows remote + unknown level', () => {
    expect(matchesPreFilter(makeOffer({ workplaceType: 'remote', experienceLevel: 'unknown' }))).toBe(true);
  });

  it('rejects postings older than maxAgeDays', () => {
    expect(
      matchesPreFilter(
        makeOffer({ workplaceType: 'remote', publishedAt: '2024-01-01T00:00:00Z' }),
      ),
    ).toBe(false);
  });

  it('allows remote + empty experienceLevel string', () => {
    expect(matchesPreFilter(makeOffer({ workplaceType: 'remote', experienceLevel: '' }))).toBe(true);
  });
});

// ─── normalizeOffer edge cases ────────────────────────────────────────────────

describe('normalizeOffer', () => {
  it('produces salary: undefined when employmentTypes is empty', () => {
    const result = normalizeOffer(makeOffer({ employmentTypes: [] }));
    expect(result.salary).toBeUndefined();
  });

  it('produces empty tags when requiredSkills and niceToHaveSkills are empty', () => {
    const result = normalizeOffer(makeOffer({ requiredSkills: [], niceToHaveSkills: [] }));
    expect(result.tags).toEqual([]);
  });

  it('does not throw when niceToHaveSkills is undefined', () => {
    const offer = makeOffer({ requiredSkills: [], niceToHaveSkills: undefined as any });
    expect(() => normalizeOffer(offer)).not.toThrow();
    expect(normalizeOffer(offer).tags).toEqual([]);
  });
});

describe('enrichMissingSalaries — cross-platform salary lookup', () => {
  it('fills missing JustJoin salary from matching NoFluffJobs offer for the same company and role', () => {
    const jjOffer: JobOffer = {
      id: 'justjoin_acme-senior-fullstack',
      title: 'Senior Full-Stack Engineer (React / Node.js)',
      company: 'Acme Software Sp. z o.o.',
      url: 'https://justjoin.it/job-offer/acme-senior-fullstack',
      body: 'React + Node.js',
      source: 'justjoin',
      location: 'Remote',
      salary: undefined,
      tags: ['react', 'node.js'],
      scrapedAt: '2026-10-29T18:00:00.000Z',
    };

    const nfjOffer: JobOffer = {
      id: 'nofluffjobs_acme-123',
      title: 'Senior Full-Stack Developer (React / Node.js)',
      company: 'Acme Software',
      url: 'https://nofluffjobs.com/pl/praca/acme-123',
      body: 'React + Node.js',
      source: 'nofluffjobs',
      location: 'Remote',
      salary: '6 000–7 500 EUR B2B/mo',
      tags: ['react', 'node.js'],
      scrapedAt: '2026-10-29T18:00:00.000Z',
    };

    const { offers, enrichedCount } = enrichMissingSalaries([jjOffer, nfjOffer]);
    expect(enrichedCount).toBe(1);
    expect(offers[0]?.salary).toBe('6 000–7 500 EUR B2B/mo (via nofluffjobs)');
  });
});

// ─── Cursor pagination tests ─────────────────────────────────────────────────

describe('fetchOffersPage & scrapeJustJoin pagination', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('fetchOffersPage sends cursor in "from" param and returns nextCursor from meta', async () => {
    jest.spyOn(axios, 'get').mockResolvedValueOnce({
      data: {
        data: [makeOffer({ slug: 'offer-1' })],
        meta: {
          totalItems: 35,
          next: { cursor: 10 },
        },
      },
    });

    const result = await fetchOffersPage(0);
    expect(axios.get).toHaveBeenCalledWith(
      expect.stringContaining('/api/candidate-api/offers'),
      expect.objectContaining({
        params: expect.objectContaining({
          from: 0,
          perPage: 10,
          categories: 'javascript',
        }),
      }),
    );
    expect(result.offers).toHaveLength(1);
    expect(result.totalItems).toBe(35);
    expect(result.nextCursor).toBe(10);
  });

  it('scrapeJustJoin iterates through cursors (0 -> 10 -> 20) until nextCursor is null', async () => {
    const page1Offer = makeOffer({ slug: 'offer-1', workplaceType: 'remote', experienceLevel: 'senior' });
    const page2Offer = makeOffer({ slug: 'offer-2', workplaceType: 'remote', experienceLevel: 'senior' });
    const page3Offer = makeOffer({ slug: 'offer-3', workplaceType: 'remote', experienceLevel: 'senior' });

    jest.spyOn(axios, 'get').mockImplementation((url: string, reqConfig?: { params?: { from?: number } }) => {
      if (url.endsWith('/api/candidate-api/offers')) {
        const cursor = reqConfig?.params?.from ?? 0;
        if (cursor === 0) {
          return Promise.resolve({
            data: { data: [page1Offer], meta: { totalItems: 30, next: { cursor: 10 } } },
          });
        }
        if (cursor === 10) {
          return Promise.resolve({
            data: { data: [page2Offer], meta: { totalItems: 30, next: { cursor: 20 } } },
          });
        }
        if (cursor === 20) {
          return Promise.resolve({
            data: { data: [page3Offer], meta: { totalItems: 30, next: { cursor: null } } },
          });
        }
      }
      return Promise.resolve({ data: { body: '<p>Detail body</p>' } });
    });

    const offers = await scrapeJustJoin();
    expect(offers).toHaveLength(3);
    expect(offers.map((o) => o.id)).toEqual([
      'justjoin_offer-1',
      'justjoin_offer-2',
      'justjoin_offer-3',
    ]);
    // 3 page GETs + 3 detail GETs (1 per filtered offer) = 6 calls
    expect(axios.get).toHaveBeenCalledTimes(6);
  });

  it('scrapeJustJoin stops pagination when all offers on a page are older than maxAgeDays', async () => {
    const expiredOffer1 = makeOffer({
      slug: 'expired-offer-1',
      publishedAt: '2023-01-01T00:00:00.000Z',
      workplaceType: 'remote',
      experienceLevel: 'senior',
    });
    const expiredOffer2 = makeOffer({
      slug: 'expired-offer-2',
      publishedAt: '2023-01-02T00:00:00.000Z',
      workplaceType: 'remote',
      experienceLevel: 'senior',
    });

    jest.spyOn(axios, 'get')
      .mockResolvedValueOnce({
        data: {
          data: [expiredOffer1, expiredOffer2],
          meta: { totalItems: 100, next: { cursor: 10 } },
        },
      })
      .mockResolvedValueOnce({
        data: {
          data: [makeOffer({ slug: 'should-not-be-called' })],
          meta: { totalItems: 100, next: { cursor: 20 } },
        },
      });

    const offers = await scrapeJustJoin();
    // Only 1 page fetched because all offers on the page were older than maxAgeDays (30d)
    expect(axios.get).toHaveBeenCalledTimes(1);
    expect(offers).toHaveLength(0);
  });

  it('scrapeJustJoin stops when JUSTJOIN_MAX_PAGES is reached', async () => {
    const spy = jest.spyOn(axios, 'get').mockImplementation((url: string, reqConfig?: { params?: { from?: number } }) => {
      if (url.endsWith('/api/candidate-api/offers')) {
        const cursor = reqConfig?.params?.from ?? 0;
        const pageIdx = cursor / 10;
        return Promise.resolve({
          data: {
            data: [makeOffer({ slug: `offer-${pageIdx}`, workplaceType: 'remote', experienceLevel: 'senior' })],
            meta: { totalItems: 1000, next: { cursor: cursor + 10 } },
          },
        });
      }
      return Promise.resolve({ data: { body: '<p>Detail body</p>' } });
    });

    const offers = await scrapeJustJoin();
    // 50 page GETs + 50 detail GETs (1 offer per page) = 100 calls
    expect(spy).toHaveBeenCalledTimes(JUSTJOIN_MAX_PAGES * 2);
    expect(offers).toHaveLength(JUSTJOIN_MAX_PAGES);
  });

  it('scrapeJustJoin handles empty response gracefully', async () => {
    jest.spyOn(axios, 'get').mockResolvedValueOnce({
      data: {
        data: [],
        meta: { totalItems: 0, next: null },
      },
    });

    const offers = await scrapeJustJoin();
    expect(offers).toEqual([]);
  });
});

// ─── Detail enrichment & mixed-page pagination (WP-1.1a) ─────────────────────

describe('JustJoin Scraper (WP-1.1a)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('fetchOfferDetail & body enrichment', () => {
    it('fetches detail endpoint, strips HTML, and returns clean description text', async () => {
      const longHtml = `
        <div>
          <h2>About the role</h2>
          <p>We are looking for a Senior Fullstack Engineer with deep expertise in TypeScript, React, and Node.js to build scalable cloud-native distributed systems.</p>
          <ul>
            <li>Design and implement event-driven microservices and modern frontend applications</li>
            <li>Collaborate with product managers and designers across international teams</li>
            <li>Own architecture decisions, observability, CI/CD pipelines, and production reliability</li>
          </ul>
        </div>
      `;

      jest.spyOn(axios, 'get').mockResolvedValueOnce({
        data: {
          body: longHtml,
        },
      });

      const detail = await fetchOfferDetail('acme-senior-fullstack-engineer');
      expect(detail).toBeDefined();
      expect(detail).toContain('About the role');
      expect(detail).toContain('Senior Fullstack Engineer with deep expertise');
      expect(detail).not.toContain('<div>');
      expect(detail).not.toContain('<p>');
      expect(axios.get).toHaveBeenCalledWith(
        'https://justjoin.it/api/candidate-api/offers/acme-senior-fullstack-engineer',
        expect.objectContaining({
          headers: expect.objectContaining({
            Accept: 'application/json',
          }),
        }),
      );
    });

    it('enriches offer.body in scrapeJustJoin with stripped HTML description (> 300 chars) and only fetches detail for pre-filtered offers', async () => {
      const matchingOffer = makeOffer({
        slug: 'matching-senior-ts',
        title: 'Senior TypeScript Engineer',
        workplaceType: 'remote',
        experienceLevel: 'senior',
      });
      const rejectedOffer = makeOffer({
        slug: 'rejected-junior-office',
        title: 'Junior Developer',
        workplaceType: 'office',
        experienceLevel: 'junior',
        city: 'Kraków',
        locations: [{ city: 'Kraków', slug: 'krakow' }],
      });

      const richDetailHtml = `
        <section>
          <h3>Role Responsibilities</h3>
          <p>Join our core platform engineering group building high-throughput TypeScript and Node.js services deployed on AWS with React frontends.</p>
          <p>You will lead architectural initiatives, mentor engineers, optimize PostgreSQL queries, and work closely with product stakeholders.</p>
          <p>Requirements include 5+ years of production experience with TypeScript, Node.js, React, Docker, and modern testing practices.</p>
        </section>
      `;

      const spy = jest.spyOn(axios, 'get').mockImplementation((url: string) => {
        if (url.endsWith('/api/candidate-api/offers')) {
          return Promise.resolve({
            data: {
              data: [matchingOffer, rejectedOffer],
              meta: { totalItems: 2, next: { cursor: null } },
            },
          });
        }
        if (url.endsWith('/api/candidate-api/offers/matching-senior-ts')) {
          return Promise.resolve({
            data: {
              data: {
                body: richDetailHtml,
              },
            },
          });
        }
        return Promise.reject(new Error(`Unexpected URL: ${url}`));
      });

      const results = await scrapeJustJoin();

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('justjoin_matching-senior-ts');
      expect(results[0].body).toContain('Position: Senior TypeScript Engineer');
      expect(results[0].body).toContain('Role Responsibilities');
      expect(results[0].body).toContain('high-throughput TypeScript and Node.js services');
      expect(results[0].body.length).toBeGreaterThan(300);

      // List call + 1 detail call (rejectedOffer was not fetched)
      expect(spy).toHaveBeenCalledTimes(2);
    });

    it('falls back gracefully to synthetic buildBody when detail fetch fails or returns empty', async () => {
      const offer1 = makeOffer({
        slug: 'offer-network-error',
        title: 'Senior Node.js Engineer',
      });
      const offer2 = makeOffer({
        slug: 'offer-empty-body',
        title: 'Senior React Engineer',
      });

      jest.spyOn(axios, 'get').mockImplementation((url: string) => {
        if (url.endsWith('/api/candidate-api/offers')) {
          return Promise.resolve({
            data: {
              data: [offer1, offer2],
              meta: { totalItems: 2, next: { cursor: null } },
            },
          });
        }
        if (url.endsWith('/api/candidate-api/offers/offer-network-error')) {
          return Promise.reject(new Error('Request failed with status code 404'));
        }
        if (url.endsWith('/api/candidate-api/offers/offer-empty-body')) {
          return Promise.resolve({
            data: { body: '   <p>  </p>  ' },
          });
        }
        return Promise.reject(new Error(`Unexpected URL: ${url}`));
      });

      const results = await scrapeJustJoin();

      expect(results).toHaveLength(2);
      expect(results[0].body).toBe(normalizeOffer(offer1).body);
      expect(results[1].body).toBe(normalizeOffer(offer2).body);
    });
  });

  describe('Pagination stop condition (offers.every)', () => {
    it('continues pagination when a page has a mix of 1 old offer and 1 fresh offer, and stops when all offers on a page are expired', async () => {
      const freshDate = new Date().toISOString();
      const expiredDate = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString();

      const page1PinnedOld = makeOffer({
        slug: 'pinned-old-offer',
        title: 'Senior Fullstack Pinned',
        publishedAt: expiredDate,
      });
      const page1Fresh = makeOffer({
        slug: 'page1-fresh-offer',
        title: 'Senior Fullstack Page 1',
        publishedAt: freshDate,
      });
      const page2Fresh = makeOffer({
        slug: 'page2-fresh-offer',
        title: 'Senior Fullstack Page 2',
        publishedAt: freshDate,
      });
      const page3Old1 = makeOffer({
        slug: 'page3-old-1',
        title: 'Senior Fullstack Old 1',
        publishedAt: expiredDate,
      });
      const page3Old2 = makeOffer({
        slug: 'page3-old-2',
        title: 'Senior Fullstack Old 2',
        publishedAt: expiredDate,
      });

      jest.spyOn(axios, 'get').mockImplementation((url: string, reqConfig?: { params?: { from?: number } }) => {
        if (url.endsWith('/api/candidate-api/offers')) {
          const cursor = reqConfig?.params?.from ?? 0;
          if (cursor === 0) {
            return Promise.resolve({
              data: {
                data: [page1PinnedOld, page1Fresh],
                meta: { totalItems: 6, next: { cursor: 10 } },
              },
            });
          }
          if (cursor === 10) {
            return Promise.resolve({
              data: {
                data: [page2Fresh],
                meta: { totalItems: 6, next: { cursor: 20 } },
              },
            });
          }
          if (cursor === 20) {
            return Promise.resolve({
              data: {
                data: [page3Old1, page3Old2],
                meta: { totalItems: 6, next: { cursor: 30 } },
              },
            });
          }
          if (cursor === 30) {
            throw new Error('Should not fetch cursor 30 after all-expired page 3');
          }
        }
        // Detail endpoint calls
        return Promise.resolve({
          data: { body: '<p>Detailed description from detail endpoint.</p>' },
        });
      });

      const results = await scrapeJustJoin();

      expect(results.map((r) => r.id)).toEqual([
        'justjoin_page1-fresh-offer',
        'justjoin_page2-fresh-offer',
      ]);
    });
  });
});
