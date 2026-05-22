import { scrapeNoFluffJobs } from '../src/scrapers/nofluffjobs';
import { JobOffer } from '../src/types';

// NOTE: This is a live integration test. It requires network access.
// Run with: npm run test:nofluffjobs

describe('NoFluffJobs Scraper', () => {
  let offers: JobOffer[];

  beforeAll(async () => {
    offers = await scrapeNoFluffJobs();
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
      expect(offer.source).toBe('nofluffjobs');
      expect(offer.scrapedAt).toBeTruthy();
    });
  });

  it('URLs should be valid nofluffjobs links', () => {
    offers.forEach((offer) => {
      expect(offer.url).toMatch(/nofluffjobs\.com/);
    });
  });

  it('IDs should be unique', () => {
    const ids = offers.map((o) => o.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });
});
