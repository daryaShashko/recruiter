import {
  extractSalary,
  extractLocation,
  matchesPreFilter,
  normalizeOffer,
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
    publishedAt: '2024-01-01T00:00:00Z',
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
