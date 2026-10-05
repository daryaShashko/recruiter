import { evaluateJob, JobForScoring } from "./scoring";

function makeJob(overrides: Partial<JobForScoring> = {}): JobForScoring {
  return {
    id: "justjoin_test",
    title: "Senior Full-Stack Developer",
    company: "Acme Tech",
    url: "https://justjoin.it/job-offer/acme-tech",
    source: "justjoin",
    location: "Remote",
    salary: "25000-30000 PLN B2B",
    body: "Fully remote role, Node.js and React.",
    scrapedAt: "2026-10-05T00:00:00.000Z",
    fingerprint: "abc123",
    ...overrides,
  };
}

function rawLlm(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    overall_score: 85,
    tech_stack_match: 90,
    seniority_match: 90,
    red_flags: [],
    reason: "Great match.",
    ...overrides,
  });
}

describe("evaluateJob — happy path", () => {
  it("passes through a clean hot-match evaluation for a Tricity job (no location penalty)", () => {
    const result = evaluateJob(rawLlm(), makeJob({ location: "Gdańsk", body: "Office in Gdańsk, Node.js and React." }));

    expect(result.overall_score).toBe(85);
    expect(result.tech_stack_match).toBe(90);
    expect(result.seniority_match).toBe(90);
    expect(result.red_flags).toEqual([]);
    expect(result.match).toBe(true);
    expect(result.id).toBe("justjoin_test");
    expect(result.fingerprint).toBe("abc123");
  });

  it("marks match=false for a score below 50", () => {
    const result = evaluateJob(rawLlm({ overall_score: 40 }), makeJob({ location: "Gdańsk" }));
    expect(result.match).toBe(false);
  });

  it("surprising-but-real: even a fully remote job gets a 10-point penalty unless its location literally mentions the Tricity — ported verbatim from the live node, not a hard reject", () => {
    const result = evaluateJob(rawLlm({ overall_score: 85 }), makeJob({ location: "Remote", body: "Fully remote role, Node.js and React." }));

    expect(result.overall_score).toBe(75);
    expect(result.red_flags).toContain("Location: Relocation Required");
  });
});

describe("evaluateJob — pipeline failure fallbacks", () => {
  it("returns a Pipeline: Parse Error fallback on empty content", () => {
    const result = evaluateJob("", makeJob());
    expect(result.overall_score).toBe(0);
    expect(result.red_flags).toEqual(["Pipeline: Parse Error"]);
    expect(result.match).toBe(false);
  });

  it("returns a Pipeline: Parse Error fallback on invalid JSON", () => {
    const result = evaluateJob("not valid json", makeJob());
    expect(result.overall_score).toBe(0);
    expect(result.red_flags).toEqual(["Pipeline: Parse Error"]);
    expect(result.reason).toMatch(/^Error: JSON parse failed/);
  });
});

describe("evaluateJob — location heuristic (no hard reject, penalty only)", () => {
  it("applies a 10-point penalty for a non-Tricity but remote-friendly job", () => {
    const result = evaluateJob(rawLlm({ overall_score: 80 }), makeJob({ location: "Warszawa", body: "Hybrid, 2 days office" }));
    expect(result.overall_score).toBe(70);
    expect(result.red_flags).toContain("Location: Relocation Required");
  });

  it("applies a 20-point penalty for a non-Tricity, fully on-site job", () => {
    const result = evaluateJob(rawLlm({ overall_score: 80 }), makeJob({ location: "Warszawa", body: "On-site only; office presence required." }));
    expect(result.overall_score).toBe(60);
  });

  it("does not penalize a Tricity location", () => {
    const result = evaluateJob(rawLlm({ overall_score: 80 }), makeJob({ location: "Gdańsk", body: "Office in Gdańsk." }));
    expect(result.overall_score).toBe(80);
    expect(result.red_flags).not.toContain("Location: Relocation Required");
  });

  it("never drops the score below 0 from the penalty", () => {
    const result = evaluateJob(rawLlm({ overall_score: 5 }), makeJob({ location: "Warszawa", body: "On-site only." }));
    expect(result.overall_score).toBe(0);
  });
});

describe("evaluateJob — programmatic hard-reject rules", () => {
  it("force-zeroes an outsourcing/agency company by name", () => {
    const result = evaluateJob(rawLlm({ overall_score: 90 }), makeJob({ company: "EPAM Systems" }));
    expect(result.overall_score).toBe(0);
    expect(result.red_flags).toContain("Industry: Agency/Outsourcing");
  });

  it("force-zeroes crypto/web3 jobs and also zeroes tech_stack_match", () => {
    const result = evaluateJob(
      rawLlm({ overall_score: 90, tech_stack_match: 95 }),
      makeJob({ title: "Senior Blockchain Engineer" }),
    );
    expect(result.overall_score).toBe(0);
    expect(result.tech_stack_match).toBe(0);
    expect(result.red_flags).toContain("Industry: Crypto/Web3");
  });

  it("force-zeroes gambling/betting jobs", () => {
    const result = evaluateJob(rawLlm({ overall_score: 90 }), makeJob({ body: "Join our sports-betting platform." }));
    expect(result.overall_score).toBe(0);
    expect(result.red_flags).toContain("Industry: Gambling/Betting");
  });

  it("force-zeroes via a CRITICAL_FLAGS tag the LLM reports itself (soft salary floor)", () => {
    // There is no programmatic numeric salary check — only the LLM's own red_flag,
    // once mapped to the "Salary: Below Hard Floor" tag, triggers the zero-out.
    const result = evaluateJob(
      rawLlm({ overall_score: 90, red_flags: ["Salary below the absolute hard floor"] }),
      makeJob({ location: "Gdańsk" }),
    );
    expect(result.overall_score).toBe(0);
    expect(result.red_flags).toContain("Salary: Below Hard Floor");
  });
});

describe("evaluateJob — red flag tag mapping", () => {
  it("maps an object-shaped red flag via its reason/category field", () => {
    const result = evaluateJob(
      rawLlm({ red_flags: [{ reason: "Pure backend role, no frontend" }] }),
      makeJob({ location: "Gdańsk" }),
    );
    expect(result.red_flags).toContain("Stack: Pure Backend");
  });

  it("deduplicates red flags that map to the same standard tag", () => {
    const result = evaluateJob(
      rawLlm({ red_flags: ["crypto startup", "blockchain focused role"] }),
      makeJob({ location: "Gdańsk" }),
    );
    expect(result.red_flags.filter((f) => f === "Industry: Crypto/Web3")).toHaveLength(1);
  });

  it("falls back to a cleaned, truncated raw tag when nothing else matches", () => {
    const result = evaluateJob(
      rawLlm({ red_flags: ["**some very long and oddly specific unmapped complaint here**"] }),
      makeJob({ location: "Gdańsk" }),
    );
    expect(result.red_flags[0]).not.toMatch(/[*]/);
    expect(result.red_flags[0].split(" ").length).toBeLessThanOrEqual(5);
  });
});
