import { deduplicateOffers } from "../src/utils/deduplicateOffers";
import { JobOffer } from "../src/types";

function makeOffer(overrides: Partial<JobOffer> = {}): JobOffer {
  return {
    id: "offer-1",
    title: "Senior TypeScript Engineer",
    company: "Acme Corp",
    url: "https://example.com/jobs/1",
    body: "Build distributed systems",
    source: "justjoin",
    scrapedAt: "2026-11-22T00:00:00.000Z",
    ...overrides,
  };
}

describe("deduplicateOffers", () => {
  it("deduplicates offers with the same fingerprint even when ids differ", () => {
    const first = makeOffer({
      id: "justjoin_1",
      source: "justjoin",
      fingerprint: "a1b2c3d4e5f60001",
    });
    const duplicate = makeOffer({
      id: "nofluffjobs_99",
      source: "nofluffjobs",
      fingerprint: "a1b2c3d4e5f60001",
    });

    const result = deduplicateOffers([first, duplicate]);
    expect(result).toEqual([first]);
  });

  it("keeps offers with distinct fingerprints even when ids match", () => {
    const first = makeOffer({
      id: "shared-1",
      fingerprint: "a1b2c3d4e5f60001",
    });
    const second = makeOffer({
      id: "shared-1",
      fingerprint: "a1b2c3d4e5f60002",
    });

    const result = deduplicateOffers([first, second]);
    expect(result).toEqual([first, second]);
  });

  it("falls back to id deduplication when fingerprint is missing or empty", () => {
    const first = makeOffer({ id: "justjoin_1", fingerprint: undefined });
    const dupUndefined = makeOffer({ id: "justjoin_1" });
    const dupEmpty = makeOffer({ id: "justjoin_1", fingerprint: "" });
    const distinct = makeOffer({ id: "justjoin_2", fingerprint: "" });

    const result = deduplicateOffers([first, dupUndefined, dupEmpty, distinct]);
    expect(result).toEqual([first, distinct]);
  });

  it("deduplicates a fallback-by-id offer against an earlier fingerprinted offer with the same id", () => {
    const fingerprinted = makeOffer({
      id: "justjoin_1",
      fingerprint: "a1b2c3d4e5f60001",
    });
    const withoutFingerprint = makeOffer({
      id: "justjoin_1",
      fingerprint: undefined,
    });

    const result = deduplicateOffers([fingerprinted, withoutFingerprint]);
    expect(result).toEqual([fingerprinted]);
  });
});
