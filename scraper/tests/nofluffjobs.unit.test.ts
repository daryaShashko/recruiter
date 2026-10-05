import {
  extractPostingsBatch,
  deduplicateByReference,
  RawNoFluffPosting,
} from '../src/scrapers/nofluffjobs';

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
});
