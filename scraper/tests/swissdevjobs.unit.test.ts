import axios from 'axios';
import { scrapeSwissDevJobs, parseFeed, normalizeJob, RawSwissDevJob } from '../src/scrapers/swissdevjobs';

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
      swissdevjobs: { feedUrl: 'https://swissdevjobs.ch/job_feed.xml' },
    },
  },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayFormatted(daysAgo = 0): string {
  const d = new Date(Date.now() - daysAgo * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

function makeJobXml(overrides: Partial<Record<string, string>> = {}): string {
  const fields: Record<string, string> = {
    id: 'job-1',
    title: 'Senior Full Stack Engineer',
    company: 'Acme AG',
    url: 'https://swissdevjobs.ch/jobs/Acme-Senior-Full-Stack-Engineer',
    city: 'Zürich',
    location: 'Zürich, Switzerland',
    salary: "CHF 120'000 - 140'000 per year",
    description: '<p>We use TypeScript and React.</p>',
    pubdate: todayFormatted(3),
    AdvertiserType: 'Company',
    ...overrides,
  };
  const tags = Object.entries(fields)
    .map(([k, v]) => `<${k}><![CDATA[${v}]]></${k}>`)
    .join('\n');
  return `<job id="x" category="IT">\n${tags}\n</job>`;
}

function makeFeed(jobsXml: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<jobs>\n${jobsXml.join('\n')}\n</jobs>`;
}

// ─── parseFeed ────────────────────────────────────────────────────────────────

describe('parseFeed', () => {
  it('extracts fields from a well-formed job entry', () => {
    const jobs = parseFeed(makeFeed([makeJobXml()]));
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      id: 'job-1',
      title: 'Senior Full Stack Engineer',
      company: 'Acme AG',
      city: 'Zürich',
    });
  });

  it('parses multiple job entries', () => {
    const jobs = parseFeed(
      makeFeed([makeJobXml({ id: 'job-1' }), makeJobXml({ id: 'job-2' })]),
    );
    expect(jobs.map((j) => j.id)).toEqual(['job-1', 'job-2']);
  });

  it('skips an entry missing a required field (no company)', () => {
    const broken = makeJobXml().replace(
      /<company><!\[CDATA\[Acme AG\]\]><\/company>/,
      '',
    );
    const jobs = parseFeed(makeFeed([broken, makeJobXml({ id: 'job-2' })]));
    expect(jobs.map((j) => j.id)).toEqual(['job-2']);
  });

  it('returns [] for an empty feed', () => {
    expect(parseFeed(makeFeed([]))).toEqual([]);
  });

  it('returns [] for garbage input', () => {
    expect(parseFeed('not xml at all')).toEqual([]);
  });
});

// ─── normalizeJob ───────────────────────────────────────────────────────────────

describe('normalizeJob', () => {
  const base: RawSwissDevJob = {
    id: 'job-1',
    title: 'Senior Full Stack Engineer',
    company: 'Acme AG',
    url: 'https://swissdevjobs.ch/jobs/1',
    city: 'Zürich',
    salary: "CHF 120'000 - 140'000 per year",
    description: '<p>Hello</p>',
  };

  it('maps a raw job to a JobOffer', () => {
    const offer = normalizeJob(base);
    expect(offer).toMatchObject({
      id: 'swissdevjobs_job-1',
      title: 'Senior Full Stack Engineer',
      company: 'Acme AG',
      url: 'https://swissdevjobs.ch/jobs/1',
      source: 'swissdevjobs',
      location: 'Zürich',
      salary: "CHF 120'000 - 140'000 per year",
      body: 'Hello',
    });
  });

  it('falls back to "Switzerland" when there is no city or location', () => {
    const offer = normalizeJob({ ...base, city: undefined, location: undefined });
    expect(offer.location).toBe('Switzerland');
  });
});

// ─── scrapeSwissDevJobs ──────────────────────────────────────────────────────────

describe('scrapeSwissDevJobs', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns [] on an empty feed', () => {
    mockedAxios.get.mockResolvedValue({ data: makeFeed([]) });
    return expect(scrapeSwissDevJobs()).resolves.toEqual([]);
  });

  it('returns [] and does not throw on a network/timeout error', () => {
    mockedAxios.get.mockRejectedValue(new Error('timeout'));
    return expect(scrapeSwissDevJobs()).resolves.toEqual([]);
  });

  it('returns [] on malformed/non-XML response', () => {
    mockedAxios.get.mockResolvedValue({ data: '<html>not a feed</html>' });
    return expect(scrapeSwissDevJobs()).resolves.toEqual([]);
  });

  it('keeps a fresh senior JS job and drops a junior one', async () => {
    mockedAxios.get.mockResolvedValue({
      data: makeFeed([
        makeJobXml({ id: 'job-1' }),
        makeJobXml({ id: 'job-2', title: 'Junior Developer' }),
      ]),
    });

    const offers = await scrapeSwissDevJobs();

    expect(offers).toHaveLength(1);
    expect(offers[0].id).toBe('swissdevjobs_job-1');
  });

  it('drops a posting older than maxAgeDays', async () => {
    mockedAxios.get.mockResolvedValue({
      data: makeFeed([makeJobXml({ id: 'job-old', pubdate: todayFormatted(90) })]),
    });

    const offers = await scrapeSwissDevJobs();
    expect(offers).toEqual([]);
  });

  it('drops a posting without a JS/TS stack signal', async () => {
    mockedAxios.get.mockResolvedValue({
      data: makeFeed([
        makeJobXml({
          id: 'job-java',
          title: 'Senior Java Engineer',
          description: '<p>Java, Spring, Kotlin</p>',
        }),
      ]),
    });

    const offers = await scrapeSwissDevJobs();
    expect(offers).toEqual([]);
  });
});
