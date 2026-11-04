import axios from 'axios';
import { scrapeAdzuna, normalizeAdzunaJob, RawAdzunaJob } from '../src/scrapers/adzuna';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

jest.mock('../src/config', () => ({
  config: {
    global: {
      requestDelayMs: 0,
      requestTimeoutMs: 1000,
      maxAgeDays: 60,
      jsSignals: ['typescript', 'react', 'node'],
      seniorTitleSignals: ['senior', 'lead'],
      rejectTitleSignals: ['junior', 'intern'],
      legalBlockers: ['us citizen only'],
      adzuna: {
        apiBaseUrl: 'https://api.adzuna.com/v1/api',
        appId: 'test-id',
        appKey: 'test-key',
        countries: ['gb', 'de'],
        resultsPerPage: 50,
        query: 'typescript react',
        maxDaysOld: 14,
      },
    },
  },
}));

const recent = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

function job(overrides: Partial<RawAdzunaJob> = {}): RawAdzunaJob {
  return {
    id: '1',
    title: 'Senior TypeScript Engineer',
    description: '<p>We use TypeScript and React.</p>',
    created: recent,
    redirect_url: 'https://www.adzuna.co.uk/jobs/land/ad/1',
    company: { display_name: 'Acme' },
    location: { display_name: 'London' },
    salary_min: 90000,
    salary_max: 110000,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('scrapeAdzuna', () => {
  it('happy path: returns normalized offers and dedups across countries', async () => {
    mockedAxios.get
      .mockResolvedValueOnce({ data: { results: [job({ id: '1' }), job({ id: '2', title: 'Lead React Dev' })] } })
      .mockResolvedValueOnce({ data: { results: [job({ id: '2', title: 'Lead React Dev' })] } });

    const offers = await scrapeAdzuna();

    expect(offers.map((o) => o.id)).toEqual(['adzuna_1', 'adzuna_2']);
    expect(offers[0].source).toBe('adzuna');
    expect(offers[0].salary).toContain('90000');
    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
    expect(mockedAxios.get.mock.calls[0][0]).toBe('https://api.adzuna.com/v1/api/jobs/gb/search/1');
    expect(mockedAxios.get.mock.calls[1][0]).toBe('https://api.adzuna.com/v1/api/jobs/de/search/1');
  });

  it('skips without calling the API when keys are missing', async () => {
    jest.resetModules();
    jest.doMock('../src/config', () => ({
      config: {
        global: {
          requestDelayMs: 0,
          requestTimeoutMs: 1000,
          jsSignals: [],
          seniorTitleSignals: [],
          rejectTitleSignals: [],
          legalBlockers: [],
          adzuna: { apiBaseUrl: 'x', appId: '', appKey: '', countries: ['gb'], resultsPerPage: 1, query: 'q', maxDaysOld: 1 },
        },
      },
    }));
    const { scrapeAdzuna: scrapeNoKeys } = await import('../src/scrapers/adzuna');
    const ax = (await import('axios')).default as jest.Mocked<typeof axios>;

    const offers = await scrapeNoKeys();

    expect(offers).toEqual([]);
    expect(ax.get).not.toHaveBeenCalled();
  });

  it('returns [] on timeout / network error', async () => {
    mockedAxios.get.mockRejectedValue(new Error('timeout of 1000ms exceeded'));
    await expect(scrapeAdzuna()).resolves.toEqual([]);
  });

  it('returns [] on empty results', async () => {
    mockedAxios.get.mockResolvedValue({ data: { results: [] } });
    await expect(scrapeAdzuna()).resolves.toEqual([]);
  });

  it('returns [] on structure drift (no results field)', async () => {
    mockedAxios.get.mockResolvedValue({ data: { count: 5 } });
    await expect(scrapeAdzuna()).resolves.toEqual([]);
  });

  it('returns [] on invalid body (non-object)', async () => {
    mockedAxios.get.mockResolvedValue({ data: '<html>blocked</html>' });
    await expect(scrapeAdzuna()).resolves.toEqual([]);
  });

  it('applies the shared pre-filter (drops junior and too-old)', async () => {
    const old = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString();
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        results: [
          job({ id: '1', title: 'Junior TypeScript Dev' }),
          job({ id: '2', created: old }),
          job({ id: '3' }),
        ],
      },
    }).mockResolvedValueOnce({ data: { results: [] } });

    const offers = await scrapeAdzuna();
    expect(offers.map((o) => o.id)).toEqual(['adzuna_3']);
  });
});

describe('normalizeAdzunaJob', () => {
  it('strips HTML and falls back for missing company/location', () => {
    const offer = normalizeAdzunaJob(
      job({ company: undefined, location: undefined, salary_min: undefined, salary_max: undefined }),
      'gb',
    );
    expect(offer.body).toBe('We use TypeScript and React.');
    expect(offer.company).toBe('Unknown');
    expect(offer.location).toBe('Unknown');
    expect(offer.salary).toBeUndefined();
  });
});
