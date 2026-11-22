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

describe("deduplicateOffers — Smart Cross-Board Merge", () => {
  it("lists every disclosed salary with the boards where it was mentioned", () => {
    const jj = makeOffer({ id: "justjoin_1", source: "justjoin", fingerprint: "fp1", salary: "25 000 - 30 000 PLN B2B" });
    const nfj = makeOffer({ id: "nofluffjobs_1", source: "nofluffjobs", fingerprint: "fp1", salary: "24 000 - 31 000 PLN B2B" });
    const ats = makeOffer({ id: "greenhouse_1", source: "greenhouse", fingerprint: "fp1", salary: "25 000 - 30 000 PLN B2B" });
    const noSalary = makeOffer({ id: "thehub_1", source: "thehub", fingerprint: "fp1", salary: undefined });

    const [merged] = deduplicateOffers([jj, nfj, ats, noSalary]);
    expect(merged.salary).toBe(
      "25 000 - 30 000 PLN B2B (via justjoin, greenhouse) | 24 000 - 31 000 PLN B2B (via nofluffjobs)",
    );
  });

  it("keeps the richest body, a direct URL, freshest publishedAt and the union of tags", () => {
    const jj = makeOffer({
      id: "justjoin_1", source: "justjoin", fingerprint: "fp1", body: "short tags",
      url: "https://justjoin.it/job/1", publishedAt: "2026-11-01T00:00:00.000Z", tags: ["Node.js"],
    });
    const adzuna = makeOffer({
      id: "adzuna_1", source: "adzuna", fingerprint: "fp1", body: "A much longer full description of the product and tasks",
      url: "https://adzuna.example/redirect?x=1", publishedAt: "2026-11-20T00:00:00.000Z", tags: ["TypeScript"],
    });

    const [merged] = deduplicateOffers([jj, adzuna]);
    expect(merged.body).toBe(adzuna.body);
    expect(merged.url).toBe("https://justjoin.it/job/1");
    expect(merged.publishedAt).toBe("2026-11-20T00:00:00.000Z");
    expect(merged.tags).toEqual(["Node.js", "TypeScript"]);
  });

  it("leaves salary undefined when no board disclosed it", () => {
    const a = makeOffer({ id: "justjoin_1", fingerprint: "fp1", salary: "0" });
    const b = makeOffer({ id: "nofluffjobs_1", source: "nofluffjobs", fingerprint: "fp1", salary: undefined });
    const [merged] = deduplicateOffers([a, b]);
    expect(merged.salary).toBeUndefined();
  });
});
