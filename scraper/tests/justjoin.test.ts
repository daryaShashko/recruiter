import { scrapeJustJoin } from '../src/scrapers/justjoin';
import { JobOffer } from '../src/types';

// NOTE: This is a live integration test. It requires network access
// and a working Playwright setup. Run with: npm run test:justjoin

describe('JustJoin Scraper', () => {
  let offers: JobOffer[];

  beforeAll(async () => {
    // Allow extra time for browser launch and page load
    offers = await scrapeJustJoin();
  }, 60_000);

  it('should return a non-empty array', () => {
    expect(Array.isArray(offers)).toBe(true);
    expect(offers.length).toBeGreaterThan(0);
  });

  it('each offer should have required fields', () => {
    offers.forEach((offer) => {
      expect(offer.id).toBeTruthy();
      expect(offer.title).toBeTruthy();
      expect(offer.url).toBeTruthy();
      expect(offer.source).toBe('justjoin');
      expect(offer.scrapedAt).toBeTruthy();
    });
  });

  it('URLs should be valid justjoin.it links', () => {
    offers.forEach((offer) => {
      expect(offer.url).toMatch(/https:\/\/justjoin\.it\//);
    });
  });

  it('IDs should be unique', () => {
    const ids = offers.map((o) => o.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });
});
