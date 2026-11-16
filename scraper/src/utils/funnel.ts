import { FunnelStats, JobOffer, SourceFunnelStats } from "../types";

export const CANONICAL_SOURCES = [
  "justjoin",
  "nofluffjobs",
  "thehub",
  "swissdevjobs",
  "ats",
  "adzuna",
] as const;

export type CanonicalSource = (typeof CANONICAL_SOURCES)[number];

const ATS_SUBSOURCES = new Set([
  "ats",
  "greenhouse",
  "lever",
  "ashby",
  "workable",
  "recruitee",
  "personio",
]);

/**
 * Normalizes any scraper name, sub-source, or prefixed identifier
 * into one of the 6 canonical funnel sources.
 */
export function normalizeSourceKey(source: string): string {
  const s = source.toLowerCase().trim();
  if (s.startsWith("ats") || ATS_SUBSOURCES.has(s)) {
    return "ats";
  }
  if (s === "justjoin") return "justjoin";
  if (s === "nofluffjobs") return "nofluffjobs";
  if (s === "thehub") return "thehub";
  if (s === "swissdevjobs") return "swissdevjobs";
  if (s === "adzuna") return "adzuna";
  return s;
}

/**
 * Helper to record and summarize funnel statistics (collected -> dropped -> passed -> sent)
 * across all job sources.
 */
export class FunnelTracker {
  private stats: Record<string, SourceFunnelStats>;
  private filterStatsRecorded: Set<string>;

  constructor() {
    this.stats = {};
    this.filterStatsRecorded = new Set();
    this.reset();
  }

  private ensureSource(source: string): SourceFunnelStats {
    const key = normalizeSourceKey(source);
    if (!this.stats[key]) {
      this.stats[key] = {
        collected: 0,
        dropped: 0,
        passed: 0,
        sent: 0,
      };
    }
    return this.stats[key];
  }

  /**
   * Reset all counters to zero for all canonical sources.
   */
  public reset(): void {
    this.stats = {};
    this.filterStatsRecorded = new Set();
    for (const source of CANONICAL_SOURCES) {
      this.stats[source] = {
        collected: 0,
        dropped: 0,
        passed: 0,
        sent: 0,
      };
    }
  }

  public recordCollected(source: string, count: number = 1): void {
    const entry = this.ensureSource(source);
    entry.collected += count;
  }

  public recordDropped(source: string, count: number = 1): void {
    const entry = this.ensureSource(source);
    entry.dropped += count;
  }

  public recordPassed(source: string, count: number = 1): void {
    const key = normalizeSourceKey(source);
    const entry = this.ensureSource(source);
    // If filter stats were already recorded for this source (e.g. via logFilterStats / recordFilterStats)
    // and passed offers were already registered, do not double-count passed offers.
    if (
      (this.filterStatsRecorded.has(key) || entry.dropped > 0) &&
      entry.passed > 0
    ) {
      return;
    }
    entry.passed += count;
  }

  public recordSent(source: string, count: number = 1): void {
    const entry = this.ensureSource(source);
    entry.sent += count;
  }

  /**
   * Record batch results from a pre-filter pass (e.g. from logFilterStats).
   */
  public recordFilterStats(
    source: string,
    collected: number,
    dropped: number,
    passed: number,
  ): void {
    const key = normalizeSourceKey(source);
    this.filterStatsRecorded.add(key);
    const entry = this.ensureSource(source);
    entry.collected += collected;
    entry.dropped += dropped;
    entry.passed += passed;
  }

  /**
   * Check whether pre-filter stats have already been recorded for a source.
   */
  public hasFilterStats(source: string): boolean {
    const key = normalizeSourceKey(source);
    return this.filterStatsRecorded.has(key);
  }

  public setStats(source: string, partial: Partial<SourceFunnelStats>): void {
    const entry = this.ensureSource(source);
    if (partial.collected !== undefined) entry.collected = partial.collected;
    if (partial.dropped !== undefined) entry.dropped = partial.dropped;
    if (partial.passed !== undefined) entry.passed = partial.passed;
    if (partial.sent !== undefined) entry.sent = partial.sent;
  }

  public getSourceStats(source: string): SourceFunnelStats {
    const entry = this.ensureSource(source);
    return { ...entry };
  }

  /**
   * Finalize sent counts based on the deduplicated and verified offers
   * and reconcile collected counts if scrapers did not record pre-filter drops.
   */
  public finalizeSent(enrichedOffers: JobOffer[]): FunnelStats {
    // Reset sent counters across all known sources
    for (const key of Object.keys(this.stats)) {
      this.stats[key].sent = 0;
    }

    for (const offer of enrichedOffers) {
      const sourceKey = normalizeSourceKey(offer.source);
      this.recordSent(sourceKey, 1);
    }

    // Reconcile collected/passed if collected is not tracked or less than passed+dropped
    for (const key of Object.keys(this.stats)) {
      const s = this.stats[key];
      if (s.collected === 0 && s.passed > 0) {
        s.collected = s.passed + s.dropped;
      } else if (s.collected < s.passed + s.dropped) {
        s.collected = s.passed + s.dropped;
      }
    }

    return this.getStats();
  }

  /**
   * Return a snapshot of all funnel statistics including the 'total' aggregate.
   */
  public getStats(): FunnelStats {
    const result: FunnelStats = {};
    const total: SourceFunnelStats = {
      collected: 0,
      dropped: 0,
      passed: 0,
      sent: 0,
    };

    for (const source of CANONICAL_SOURCES) {
      const entry = this.stats[source] ?? {
        collected: 0,
        dropped: 0,
        passed: 0,
        sent: 0,
      };
      result[source] = { ...entry };
      total.collected += entry.collected;
      total.dropped += entry.dropped;
      total.passed += entry.passed;
      total.sent += entry.sent;
    }

    result.total = total;
    return result;
  }

  /**
   * Return tabular rows formatted for console.table.
   */
  public getSummaryTable(): Array<{
    Source: string;
    Collected: number;
    Dropped: number;
    Passed: number;
    Sent: number;
  }> {
    const stats = this.getStats();
    const rows: Array<{
      Source: string;
      Collected: number;
      Dropped: number;
      Passed: number;
      Sent: number;
    }> = CANONICAL_SOURCES.map((source) => ({
      Source: source,
      Collected: stats[source]?.collected ?? 0,
      Dropped: stats[source]?.dropped ?? 0,
      Passed: stats[source]?.passed ?? 0,
      Sent: stats[source]?.sent ?? 0,
    }));

    rows.push({
      Source: "TOTAL",
      Collected: stats.total?.collected ?? 0,
      Dropped: stats.total?.dropped ?? 0,
      Passed: stats.total?.passed ?? 0,
      Sent: stats.total?.sent ?? 0,
    });

    return rows;
  }

  /**
   * Print a formatted ASCII summary table before exit.
   */
  public printSummaryTable(): void {
    console.log("\n=== Scraping Funnel Summary ===");
    console.table(this.getSummaryTable());
  }
}

export const funnelTracker = new FunnelTracker();
