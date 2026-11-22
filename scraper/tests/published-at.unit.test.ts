import { normalizeOffer, RawJustJoinOffer } from '../src/scrapers/justjoin';
import { normalizePosting, RawNoFluffPosting } from '../src/scrapers/nofluffjobs';
import { normalizeDetail, RawTheHubJobDetail } from '../src/scrapers/thehub';
import { normalizeJob, RawSwissDevJob } from '../src/scrapers/swissdevjobs';
import { normalizeAdzunaJob, RawAdzunaJob } from '../src/scrapers/adzuna';
import {
  normalizeWorkable,
  normalizeRecruitee,
  normalizePersonio,
  normalizeGreenhouse,
  normalizeLever,
  normalizeAshby,
  RawWorkableJob,
  RawRecruiteeOffer,
  RawPersonioPosition,
  RawGreenhouseJob,
  RawLeverPosting,
  RawAshbyJob,
} from '../src/scrapers/ats';

function makeJustJoinOffer(overrides: Partial<RawJustJoinOffer> = {}): RawJustJoinOffer {
  return {
    guid: 'jj-1',
    slug: 'senior-ts-dev',
    title: 'Senior TypeScript Developer',
    workplaceType: 'remote',
    workingTime: 'full_time',
    experienceLevel: 'senior',
    city: 'Warsaw',
    companyName: 'Acme',
    publishedAt: '2026-11-01T10:30:00Z',
    locations: [],
    employmentTypes: [],
    requiredSkills: [],
    niceToHaveSkills: [],
    ...overrides,
  };
}

function makeNoFluffPosting(overrides: Partial<RawNoFluffPosting> = {}): RawNoFluffPosting {
  return {
    id: 'nfj-1',
    name: 'Acme',
    title: 'Senior Developer',
    url: 'senior-developer-acme',
    reference: 'REF-1',
    posted: 1700000000000,
    technology: 'typescript',
    category: 'fullstack',
    seniority: ['Senior'],
    location: { places: [], fullyRemote: true, covidTimeRemotely: false },
    fullyRemote: true,
    ...overrides,
  };
}

function makeTheHubDetail(overrides: Partial<RawTheHubJobDetail> = {}): RawTheHubJobDetail {
  return {
    id: 'hub-1',
    title: 'Senior Engineer',
    company: { name: 'Acme' },
    countryCode: 'DK',
    description: 'TypeScript',
    publishedAt: '2026-11-02T08:00:00+02:00',
    ...overrides,
  };
}

function makeSwissDevJob(overrides: Partial<RawSwissDevJob> = {}): RawSwissDevJob {
  return {
    id: 'sdj-1',
    title: 'Senior Engineer',
    company: 'Acme AG',
    url: 'https://swissdevjobs.ch/jobs/acme',
    pubdate: '04.10.2023',
    ...overrides,
  };
}

function makeAdzunaJob(overrides: Partial<RawAdzunaJob> = {}): RawAdzunaJob {
  return {
    id: 'adz-1',
    title: 'Senior Engineer',
    company: { display_name: 'Acme' },
    created: '2026-11-05T14:20:00Z',
    ...overrides,
  };
}

function makeWorkableJob(overrides: Partial<RawWorkableJob> = {}): RawWorkableJob {
  return {
    shortcode: 'W1',
    title: 'Senior Engineer',
    published_on: '2026-11-01',
    ...overrides,
  };
}

function makeRecruiteeOffer(overrides: Partial<RawRecruiteeOffer> = {}): RawRecruiteeOffer {
  return {
    id: 1,
    title: 'Senior Engineer',
    slug: 'senior-engineer',
    published_at: '2026-11-03T12:00:00Z',
    ...overrides,
  };
}

function makePersonioPosition(overrides: Partial<RawPersonioPosition> = {}): RawPersonioPosition {
  return {
    id: 'p1',
    name: 'Senior Engineer',
    createdAt: '2026-11-04T09:15:00+01:00',
    descriptions: ['TypeScript'],
    ...overrides,
  };
}

function makeGreenhouseJob(overrides: Partial<RawGreenhouseJob> = {}): RawGreenhouseJob {
  return {
    id: 42,
    title: 'Senior Engineer',
    first_published: '2026-11-06T11:00:00-05:00',
    ...overrides,
  };
}

function makeLeverPosting(overrides: Partial<RawLeverPosting> = {}): RawLeverPosting {
  return {
    id: 'l1',
    text: 'Senior Engineer',
    createdAt: 1700000000000,
    ...overrides,
  };
}

function makeAshbyJob(overrides: Partial<RawAshbyJob> = {}): RawAshbyJob {
  return {
    id: 'a1',
    title: 'Senior Engineer',
    publishedAt: '2026-11-07T16:45:00.123Z',
    ...overrides,
  };
}

describe('JobOffer.publishedAt extraction across all scrapers', () => {
  it('JustJoin: converts publishedAt to ISO-8601 and returns null when invalid/missing', () => {
    expect(normalizeOffer(makeJustJoinOffer()).publishedAt).toBe('2026-11-01T10:30:00.000Z');
    expect(normalizeOffer(makeJustJoinOffer({ publishedAt: '' })).publishedAt).toBeNull();
    expect(normalizeOffer(makeJustJoinOffer({ publishedAt: 'not-a-date' })).publishedAt).toBeNull();
  });

  it('NoFluffJobs: converts posted epoch ms to ISO-8601 and returns null when missing/invalid', () => {
    expect(normalizePosting(makeNoFluffPosting()).publishedAt).toBe(
      new Date(1700000000000).toISOString(),
    );
    expect(normalizePosting(makeNoFluffPosting({ posted: undefined })).publishedAt).toBeNull();
    expect(normalizePosting(makeNoFluffPosting({ posted: Number.NaN })).publishedAt).toBeNull();
  });

  it('TheHub: converts publishedAt (or approvedAt fallback) to ISO-8601 and returns null when absent', () => {
    expect(normalizeDetail(makeTheHubDetail()).publishedAt).toBe('2026-11-02T06:00:00.000Z');
    expect(
      normalizeDetail(
        makeTheHubDetail({ publishedAt: undefined, approvedAt: '2026-11-01T00:00:00Z' }),
      ).publishedAt,
    ).toBe('2026-11-01T00:00:00.000Z');
    expect(
      normalizeDetail(makeTheHubDetail({ publishedAt: undefined, approvedAt: undefined }))
        .publishedAt,
    ).toBeNull();
  });

  it('SwissDevJobs: converts dd.mm.yyyy pubdate to ISO-8601 and returns null when absent/invalid', () => {
    expect(normalizeJob(makeSwissDevJob()).publishedAt).toBe('2023-10-04T00:00:00.000Z');
    expect(normalizeJob(makeSwissDevJob({ pubdate: undefined })).publishedAt).toBeNull();
    expect(normalizeJob(makeSwissDevJob({ pubdate: 'bad-date' })).publishedAt).toBeNull();
  });

  it('Adzuna: converts created to ISO-8601 and returns null when absent/invalid', () => {
    expect(normalizeAdzunaJob(makeAdzunaJob(), 'gb').publishedAt).toBe('2026-11-05T14:20:00.000Z');
    expect(normalizeAdzunaJob(makeAdzunaJob({ created: undefined }), 'gb').publishedAt).toBeNull();
    expect(normalizeAdzunaJob(makeAdzunaJob({ created: 'invalid' }), 'gb').publishedAt).toBeNull();
  });

  it('ATS Workable: converts published_on to ISO-8601 and returns null when absent/invalid', () => {
    expect(normalizeWorkable('acme', 'Acme', makeWorkableJob()).publishedAt).toBe(
      '2026-11-01T00:00:00.000Z',
    );
    expect(
      normalizeWorkable('acme', 'Acme', makeWorkableJob({ published_on: undefined })).publishedAt,
    ).toBeNull();
  });

  it('ATS Recruitee: converts published_at (or created_at fallback) to ISO-8601 and returns null when absent', () => {
    expect(normalizeRecruitee('acme', makeRecruiteeOffer()).publishedAt).toBe(
      '2026-11-03T12:00:00.000Z',
    );
    expect(
      normalizeRecruitee(
        'acme',
        makeRecruiteeOffer({ published_at: undefined, created_at: '2026-11-02T12:00:00Z' }),
      ).publishedAt,
    ).toBe('2026-11-02T12:00:00.000Z');
    expect(
      normalizeRecruitee('acme', makeRecruiteeOffer({ published_at: undefined, created_at: undefined }))
        .publishedAt,
    ).toBeNull();
  });

  it('ATS Personio: converts createdAt to ISO-8601 and returns null when absent', () => {
    expect(normalizePersonio('acme', makePersonioPosition()).publishedAt).toBe(
      '2026-11-04T08:15:00.000Z',
    );
    expect(
      normalizePersonio('acme', makePersonioPosition({ createdAt: undefined })).publishedAt,
    ).toBeNull();
  });

  it('ATS Greenhouse: converts first_published (or updated_at fallback) to ISO-8601 and returns null when absent', () => {
    expect(normalizeGreenhouse('acme', makeGreenhouseJob()).publishedAt).toBe(
      '2026-11-06T16:00:00.000Z',
    );
    expect(
      normalizeGreenhouse(
        'acme',
        makeGreenhouseJob({ first_published: undefined, updated_at: '2026-11-05T10:00:00Z' }),
      ).publishedAt,
    ).toBe('2026-11-05T10:00:00.000Z');
    expect(
      normalizeGreenhouse(
        'acme',
        makeGreenhouseJob({ first_published: undefined, updated_at: undefined }),
      ).publishedAt,
    ).toBeNull();
  });

  it('ATS Lever: converts createdAt to ISO-8601 and returns null when absent', () => {
    expect(normalizeLever('acme', makeLeverPosting()).publishedAt).toBe(
      new Date(1700000000000).toISOString(),
    );
    expect(normalizeLever('acme', makeLeverPosting({ createdAt: undefined })).publishedAt).toBeNull();
  });

  it('ATS Ashby: converts publishedAt to ISO-8601 and returns null when absent/invalid', () => {
    expect(normalizeAshby('acme', makeAshbyJob()).publishedAt).toBe('2026-11-07T16:45:00.123Z');
    expect(normalizeAshby('acme', makeAshbyJob({ publishedAt: undefined })).publishedAt).toBeNull();
    expect(normalizeAshby('acme', makeAshbyJob({ publishedAt: 'bad' })).publishedAt).toBeNull();
  });
});
