import axios from 'axios';
import { scrapeTheHub, normalizeDetail, RawTheHubJobDetail } from '../src/scrapers/thehub';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

jest.mock('../src/config', () => ({
  config: {
    global: {
      requestDelayMs: 0,
      requestTimeoutMs: 1000,
      maxAgeDays: 60,
      jsSignals: ['javascript', 'typescript', 'node', 'react'],
      seniorTitleSignals: ['senior', 'lead', 'staff', 'principal'],
      rejectTitleSignals: ['junior', 'intern'],
      legalBlockers: ['us citizen only', 'security clearance'],
      thehub: {
        apiBaseUrl: 'https://api.thehub.io',
        siteBaseUrl: 'https://thehub.io',
        countries: ['DK', 'SE'],
        maxPagesPerCountry: 5,
        jobRoles: [],
      },
    },
  },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function listResponse(docs: Array<{ id: string; title: string }>, pages = 1) {
  return { data: { total: docs.length, pages, docs } };
}

function makeDetail(overrides: Partial<RawTheHubJobDetail> = {}): RawTheHubJobDetail {
  return {
    id: 'abc123',
    title: 'Senior Full-Stack Engineer',
    company: { name: 'Acme' },
    countryCode: 'DK',
    description: 'We use TypeScript and React.',
    salary: 'competitive',
    status: 'ACTIVE',
    publishedAt: new Date().toISOString(),
    expirationDate: '2099-01-01',
    ...overrides,
  };
}

// ─── normalizeDetail ───────────────────────────────────────────────────────────

describe('normalizeDetail', () => {
  it('maps a detail to a JobOffer', () => {
    const offer = normalizeDetail(makeDetail({ link: 'https://careers.acme.com/1' }));
    expect(offer).toMatchObject({
      id: 'thehub_abc123',
      title: 'Senior Full-Stack Engineer',
      company: 'Acme',
      url: 'https://careers.acme.com/1',
      source: 'thehub',
      location: 'DK',
    });
    expect(offer.salary).toBeUndefined();
  });

  it('falls back to the TheHub listing URL when there is no apply link', () => {
    const offer = normalizeDetail(makeDetail({ link: undefined }));
    expect(offer.url).toBe('https://thehub.io/jobs/abc123');
  });

  it('keeps a real salary string but drops the "competitive" placeholder', () => {
    const offer = normalizeDetail(makeDetail({ salary: 'DKK 50,000/month' }));
    expect(offer.salary).toBe('DKK 50,000/month');
  });

  it('strips HTML from the description', () => {
    const offer = normalizeDetail(makeDetail({ description: '<p>Hello</p><b>World</b>' }));
    expect(offer.body).toBe('Hello\nWorld');
  });
});

// ─── scrapeTheHub ──────────────────────────────────────────────────────────────

describe('scrapeTheHub', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns [] when the list is empty for every country', async () => {
    mockedAxios.get.mockResolvedValue(listResponse([]));
    const offers = await scrapeTheHub();
    expect(offers).toEqual([]);
  });

  it('returns [] and does not throw on a network/timeout error', async () => {
    mockedAxios.get.mockRejectedValue(new Error('timeout'));
    const offers = await scrapeTheHub();
    expect(offers).toEqual([]);
  });

  it('returns [] on malformed JSON shape (missing docs)', async () => {
    mockedAxios.get.mockResolvedValue({ data: { total: 0, pages: 1 } });
    const offers = await scrapeTheHub();
    expect(offers).toEqual([]);
  });

  it('dedupes listing ids shared across countries, fetches each detail once, applies the pre-filter', async () => {
    const list = listResponse([
      { id: 'job-1', title: 'Senior Full-Stack Engineer' },
      { id: 'job-2', title: 'Junior Developer' }, // rejected by pre-filter
    ]);
    mockedAxios.get.mockImplementation((url: string) => {
      if (url.includes('/v2/jobs')) return Promise.resolve(list);
      if (url.includes('job-1')) return Promise.resolve({ data: makeDetail({ id: 'job-1' }) });
      if (url.includes('job-2'))
        return Promise.resolve({
          data: makeDetail({ id: 'job-2', title: 'Junior Developer' }),
        });
      return Promise.reject(new Error('unexpected url'));
    });

    const offers = await scrapeTheHub();

    expect(offers).toHaveLength(1);
    expect(offers[0].id).toBe('thehub_job-1');
    // 2 countries x 1 job each = 2 list calls. job-2 ("Junior Developer") is
    // dropped by the cheap title filter before any detail request, so only
    // job-1 gets a detail fetch: 2 list calls + 1 detail call = 3 total.
    expect(mockedAxios.get).toHaveBeenCalledTimes(3);
  });

  it('skips the detail fetch entirely for listings that fail the title filter', async () => {
    const list = listResponse([{ id: 'job-2', title: 'Junior Developer' }]);
    mockedAxios.get.mockResolvedValue(list);

    const offers = await scrapeTheHub();

    expect(offers).toEqual([]);
    // Only the 2 country list calls — no detail fetch for job-2.
    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
  });

  it('drops a job whose detail fetch fails, keeping the rest', async () => {
    const list = listResponse([{ id: 'job-1', title: 'Senior Engineer' }]);
    mockedAxios.get.mockImplementation((url: string) => {
      if (url.includes('/v2/jobs')) return Promise.resolve(list);
      return Promise.reject(new Error('500'));
    });

    const offers = await scrapeTheHub();
    expect(offers).toEqual([]);
  });

  it('drops an expired posting', async () => {
    const list = listResponse([{ id: 'job-1', title: 'Senior Engineer' }]);
    mockedAxios.get.mockImplementation((url: string) => {
      if (url.includes('/v2/jobs')) return Promise.resolve(list);
      return Promise.resolve({
        data: makeDetail({ id: 'job-1', expirationDate: '2000-01-01' }),
      });
    });

    const offers = await scrapeTheHub();
    expect(offers).toEqual([]);
  });

  it('drops a non-ACTIVE status posting even if it passes the pre-filter', async () => {
    const list = listResponse([{ id: 'job-1', title: 'Senior Engineer' }]);
    mockedAxios.get.mockImplementation((url: string) => {
      if (url.includes('/v2/jobs')) return Promise.resolve(list);
      return Promise.resolve({ data: makeDetail({ id: 'job-1', status: 'CLOSED' }) });
    });

    const offers = await scrapeTheHub();
    expect(offers).toEqual([]);
  });

  it('paginates list pages up to the reported page count', async () => {
    const page1 = { data: { total: 2, pages: 2, docs: [{ id: 'job-1', title: 'Senior Engineer' }] } };
    const page2 = { data: { total: 2, pages: 2, docs: [{ id: 'job-2', title: 'Senior Engineer' }] } };
    let dkCalls = 0;
    mockedAxios.get.mockImplementation((url: string, opts?: any) => {
      if (url.includes('/v2/jobs')) {
        if (opts?.params?.countryCode === 'DK') {
          dkCalls += 1;
          return Promise.resolve(dkCalls === 1 ? page1 : page2);
        }
        return Promise.resolve({ data: { total: 0, pages: 1, docs: [] } });
      }
      return Promise.resolve({ data: makeDetail({ id: url.split('/').pop() }) });
    });

    const offers = await scrapeTheHub();
    expect(offers.map((o) => o.id).sort()).toEqual(['thehub_job-1', 'thehub_job-2']);
  });
});
