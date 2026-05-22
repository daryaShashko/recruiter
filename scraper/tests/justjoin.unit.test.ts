import {
  extractSalary,
  extractLocation,
  matchesPreFilter,
  normalizeOffer,
  RawEmploymentType,
  RawJustJoinOffer,
} from '../src/scrapers/justjoin';

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

  it('returns undefined when no PLN entries exist', () => {
    const types: RawEmploymentType[] = [{
      from: 800,
      to: 950,
      currency: 'USD',
      currencySource: 'original',
      type: 'b2b',
      unit: 'Month',
      gross: false,
    }];
    expect(extractSalary(types)).toBeUndefined();
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
