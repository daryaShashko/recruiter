import {
  extractSsrPostings,
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

function makeHtml(state: unknown): string {
  return `<html><body><script id="serverApp-state">${JSON.stringify(state)}</script></body></html>`;
}

// ─── extractSsrPostings ───────────────────────────────────────────────────────

describe('extractSsrPostings', () => {
  it('extracts postings, totalPages and currentPage from valid HTML', () => {
    const posting = makePosting();
    const html = makeHtml({
      STORE_KEY: {
        searchResponse: { postings: [posting], totalPages: 3 },
        params: { page: 2 },
      },
    });

    const result = extractSsrPostings(html);
    expect(result.postings).toHaveLength(1);
    expect(result.totalPages).toBe(3);
    expect(result.currentPage).toBe(2);
  });

  it('returns empty defaults when <script id="serverApp-state"> is absent', () => {
    const html = '<html><body><p>No state here</p></body></html>';
    const result = extractSsrPostings(html);
    expect(result).toEqual({ postings: [], totalPages: 1, currentPage: 1 });
  });

  it('returns empty defaults when JSON inside the script tag is invalid', () => {
    const html = '<html><body><script id="serverApp-state">NOT_VALID_JSON</script></body></html>';
    const result = extractSsrPostings(html);
    expect(result).toEqual({ postings: [], totalPages: 1, currentPage: 1 });
  });

  it('returns empty postings when the postings array is empty', () => {
    const html = makeHtml({
      STORE_KEY: {
        searchResponse: { postings: [], totalPages: 1 },
        params: { page: 1 },
      },
    });

    const result = extractSsrPostings(html);
    expect(result.postings).toEqual([]);
    expect(result.totalPages).toBe(1);
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
