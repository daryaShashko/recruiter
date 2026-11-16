import {
  FunnelTracker,
  normalizeSourceKey,
  CANONICAL_SOURCES,
} from "../src/utils/funnel";
import { JobOffer } from "../src/types";

describe("FunnelTracker", () => {
  let tracker: FunnelTracker;

  beforeEach(() => {
    tracker = new FunnelTracker();
  });

  describe("normalizeSourceKey", () => {
    it("normalizes standard source names regardless of casing", () => {
      expect(normalizeSourceKey("JustJoin")).toBe("justjoin");
      expect(normalizeSourceKey("NoFluffJobs")).toBe("nofluffjobs");
      expect(normalizeSourceKey("TheHub")).toBe("thehub");
      expect(normalizeSourceKey("SwissDevJobs")).toBe("swissdevjobs");
      expect(normalizeSourceKey("Adzuna")).toBe("adzuna");
      expect(normalizeSourceKey("ATS")).toBe("ats");
    });

    it("normalizes ATS sub-sources and prefixes to ats", () => {
      expect(normalizeSourceKey("greenhouse")).toBe("ats");
      expect(normalizeSourceKey("lever")).toBe("ats");
      expect(normalizeSourceKey("ashby")).toBe("ats");
      expect(normalizeSourceKey("workable")).toBe("ats");
      expect(normalizeSourceKey("recruitee")).toBe("ats");
      expect(normalizeSourceKey("personio")).toBe("ats");
      expect(normalizeSourceKey("ATS:greenhouse:gitlab")).toBe("ats");
      expect(normalizeSourceKey("ATS:workable:grecotel")).toBe("ats");
    });
  });

  describe("stage counter tracking", () => {
    it("initializes with 0 for all canonical sources", () => {
      const stats = tracker.getStats();
      for (const source of CANONICAL_SOURCES) {
        expect(stats[source]).toEqual({
          collected: 0,
          dropped: 0,
          passed: 0,
          sent: 0,
        });
      }
      expect(stats.total).toEqual({
        collected: 0,
        dropped: 0,
        passed: 0,
        sent: 0,
      });
    });

    it("records individual stages accurately", () => {
      tracker.recordCollected("justjoin", 100);
      tracker.recordDropped("justjoin", 70);
      tracker.recordPassed("justjoin", 30);
      tracker.recordSent("justjoin", 25);

      const jj = tracker.getSourceStats("justjoin");
      expect(jj).toEqual({
        collected: 100,
        dropped: 70,
        passed: 30,
        sent: 25,
      });
    });

    it("records batch filter stats via recordFilterStats", () => {
      tracker.recordFilterStats("TheHub", 50, 40, 10);
      const hub = tracker.getSourceStats("thehub");
      expect(hub).toEqual({
        collected: 50,
        dropped: 40,
        passed: 10,
        sent: 0,
      });
    });

    it("aggregates multiple ATS board batches under the ats source", () => {
      tracker.recordFilterStats("ATS:greenhouse:gitlab", 100, 80, 20);
      tracker.recordFilterStats("ATS:ashby:linear", 50, 30, 20);

      const ats = tracker.getSourceStats("ats");
      expect(ats.collected).toBe(150);
      expect(ats.dropped).toBe(110);
      expect(ats.passed).toBe(40);
    });
  });

  describe("finalizeSent", () => {
    it("computes sent per source from enriched offers and updates total", () => {
      tracker.recordPassed("justjoin", 2);
      tracker.recordPassed("ats", 2);

      const mockOffers: JobOffer[] = [
        {
          id: "jj-1",
          title: "Frontend Engineer",
          company: "Acme",
          url: "https://example.com/1",
          body: "React",
          source: "justjoin",
          scrapedAt: new Date().toISOString(),
        },
        {
          id: "jj-2",
          title: "Fullstack Engineer",
          company: "Acme",
          url: "https://example.com/2",
          body: "TypeScript",
          source: "justjoin",
          scrapedAt: new Date().toISOString(),
        },
        {
          id: "linear-1",
          title: "Product Engineer",
          company: "Linear",
          url: "https://example.com/3",
          body: "TypeScript React",
          source: "ashby",
          scrapedAt: new Date().toISOString(),
        },
      ];

      const stats = tracker.finalizeSent(mockOffers);

      expect(stats.justjoin.sent).toBe(2);
      expect(stats.ats.sent).toBe(1);
      expect(stats.total.sent).toBe(3);
    });

    it("reconciles collected counts if scrapers only reported passed offers", () => {
      tracker.recordPassed("nofluffjobs", 15);
      const stats = tracker.finalizeSent([]);

      expect(stats.nofluffjobs.collected).toBe(15);
      expect(stats.nofluffjobs.passed).toBe(15);
    });

    it("does not double-count passed offers or inflate collected when filter stats are recorded", () => {
      // Source with pre-filter stats (e.g. SwissDevJobs: 20 collected, 15 dropped, 5 passed)
      tracker.recordFilterStats("SwissDevJobs", 20, 15, 5);
      expect(tracker.hasFilterStats("SwissDevJobs")).toBe(true);

      // Attempt to recordPassed again (as previously happened in index.ts)
      tracker.recordPassed("SwissDevJobs", 5);

      // Source without pre-filter stats (e.g. JustJoin: 10 offers)
      expect(tracker.hasFilterStats("JustJoin")).toBe(false);
      tracker.recordPassed("JustJoin", 10);

      // Confirm pre-finalize counts: passed is NOT doubled for SwissDevJobs
      const swissBefore = tracker.getSourceStats("SwissDevJobs");
      expect(swissBefore.collected).toBe(20);
      expect(swissBefore.dropped).toBe(15);
      expect(swissBefore.passed).toBe(5);

      const jjBefore = tracker.getSourceStats("JustJoin");
      expect(jjBefore.collected).toBe(0);
      expect(jjBefore.dropped).toBe(0);
      expect(jjBefore.passed).toBe(10);

      // Finalize sent with mock offers (3 for SwissDevJobs, 7 for JustJoin)
      const mockOffers: JobOffer[] = [
        ...Array.from({ length: 3 }, (_, i) => ({
          id: `sdj-${i}`,
          title: "Senior Backend Developer",
          company: "SwissTech",
          url: `https://swissdevjobs.ch/job/${i}`,
          body: "TypeScript, Node.js",
          source: "swissdevjobs" as const,
          scrapedAt: new Date().toISOString(),
        })),
        ...Array.from({ length: 7 }, (_, i) => ({
          id: `jj-${i}`,
          title: "Fullstack Developer",
          company: "JJTech",
          url: `https://justjoin.it/job/${i}`,
          body: "React, Node.js",
          source: "justjoin" as const,
          scrapedAt: new Date().toISOString(),
        })),
      ];

      const finalized = tracker.finalizeSent(mockOffers);

      // For SwissDevJobs: collected is NOT inflated to 25 (15 dropped + 10 doubled passed)
      // It stays exactly 20 (15 dropped + 5 passed), passed stays 5, sent is 3
      expect(finalized.swissdevjobs.collected).toBe(20);
      expect(finalized.swissdevjobs.dropped).toBe(15);
      expect(finalized.swissdevjobs.passed).toBe(5);
      expect(finalized.swissdevjobs.sent).toBe(3);

      // For JustJoin: collected is reconciled to 10 (0 dropped + 10 passed), passed is 10, sent is 7
      expect(finalized.justjoin.collected).toBe(10);
      expect(finalized.justjoin.dropped).toBe(0);
      expect(finalized.justjoin.passed).toBe(10);
      expect(finalized.justjoin.sent).toBe(7);

      // Check total
      expect(finalized.total.collected).toBe(30);
      expect(finalized.total.dropped).toBe(15);
      expect(finalized.total.passed).toBe(15);
      expect(finalized.total.sent).toBe(10);
    });

    it("simulates index.ts dispatch flow avoiding double-counting", () => {
      // Simulate scrapers results as in index.ts
      const scrapersData = [
        { name: "SwissDevJobs", hasFilter: true, collected: 20, dropped: 15, passed: 5 },
        { name: "JustJoin", hasFilter: false, collected: 0, dropped: 0, passed: 8 },
      ];

      // Scraper run phase
      for (const s of scrapersData) {
        if (s.hasFilter) {
          tracker.recordFilterStats(s.name, s.collected, s.dropped, s.passed);
        }
      }

      // index.ts aggregation phase
      for (const s of scrapersData) {
        const stats = tracker.getSourceStats(s.name);
        const hasFilterStats =
          tracker.hasFilterStats(s.name) ||
          stats.passed > 0 ||
          stats.dropped > 0;
        if (!hasFilterStats) {
          tracker.recordPassed(s.name, s.passed);
        }
      }

      const swiss = tracker.getSourceStats("SwissDevJobs");
      expect(swiss.collected).toBe(20);
      expect(swiss.dropped).toBe(15);
      expect(swiss.passed).toBe(5);

      const jj = tracker.getSourceStats("JustJoin");
      expect(jj.passed).toBe(8);

      const finalized = tracker.finalizeSent([]);
      expect(finalized.swissdevjobs.collected).toBe(20);
      expect(finalized.swissdevjobs.passed).toBe(5);
      expect(finalized.justjoin.collected).toBe(8);
      expect(finalized.justjoin.passed).toBe(8);
    });
  });

  describe("summary table output", () => {
    it("generates summary table rows including all canonical sources and TOTAL", () => {
      tracker.recordCollected("justjoin", 10);
      tracker.recordPassed("justjoin", 5);
      tracker.recordSent("justjoin", 4);

      const table = tracker.getSummaryTable();
      expect(table).toHaveLength(CANONICAL_SOURCES.length + 1);

      const jjRow = table.find((r) => r.Source === "justjoin");
      expect(jjRow).toBeDefined();
      expect(jjRow?.Collected).toBe(10);
      expect(jjRow?.Passed).toBe(5);
      expect(jjRow?.Sent).toBe(4);

      const totalRow = table.find((r) => r.Source === "TOTAL");
      expect(totalRow).toBeDefined();
      expect(totalRow?.Collected).toBe(10);
      expect(totalRow?.Passed).toBe(5);
      expect(totalRow?.Sent).toBe(4);
    });

    it("printSummaryTable logs without error", () => {
      const consoleSpy = jest.spyOn(console, "table").mockImplementation(() => {});
      tracker.printSummaryTable();
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe("reset", () => {
    it("resets all counters back to zero", () => {
      tracker.recordCollected("adzuna", 50);
      tracker.reset();
      expect(tracker.getSourceStats("adzuna").collected).toBe(0);
      expect(tracker.getStats().total.collected).toBe(0);
    });
  });
});
