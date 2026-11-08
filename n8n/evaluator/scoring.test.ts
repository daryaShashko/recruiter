import { evaluateJob, extractMaxMonthlyPln, JobForScoring } from "./scoring";

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

  it("does not penalize a fully remote job in any country unless remote work is US-only", () => {
    for (const location of ["Remote", "Remote (Denmark)", "Remote (US)", "London, UK (Remote)", "Tokyo — fully remote"]) {
      const result = evaluateJob(rawLlm({ overall_score: 85 }), makeJob({ location, body: "Node.js and React." }));
      expect(result.overall_score).toBe(85);
      expect(result.red_flags).not.toContain("Location: Relocation Required");
      expect(result.red_flags).not.toContain("Location: Remote Region Restricted");
    }

    const usOnly = evaluateJob(
      rawLlm({ overall_score: 85 }),
      makeJob({ location: "Remote — US only", body: "Node.js and React." }),
    );
    expect(usOnly.overall_score).toBe(75);
    expect(usOnly.red_flags).toContain("Location: Remote Region Restricted");

    const residenceRequired = evaluateJob(
      rawLlm({ overall_score: 85 }),
      makeJob({ location: "Remote", body: "Must reside in the United States. Node.js and React." }),
    );
    expect(residenceRequired.overall_score).toBe(75);
    expect(residenceRequired.red_flags).toContain("Location: Remote Region Restricted");

    const canadaOnly = evaluateJob(
      rawLlm({ overall_score: 85 }),
      makeJob({ location: "Remote (Canada only)", body: "Node.js and React." }),
    );
    expect(canadaOnly.overall_score).toBe(75);
    expect(canadaOnly.red_flags).toContain("Location: Remote Region Restricted");
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

describe("evaluateJob — location heuristic (no hard reject, relocation penalty only)", () => {
  it("flags and applies a 10-point penalty for a hybrid job outside the Tricity", () => {
    const result = evaluateJob(rawLlm({ overall_score: 80 }), makeJob({ location: "Warszawa", body: "Hybrid, 2 days office" }));
    expect(result.overall_score).toBe(70);
    expect(result.red_flags).toContain("Location: Relocation Required");
  });

  it("applies the same 10-point penalty for an on-site job abroad (not a reject)", () => {
    const result = evaluateJob(
      rawLlm({ overall_score: 80 }),
      makeJob({ location: "Copenhagen, Denmark", body: "On-site only; office presence required." }),
    );
    expect(result.overall_score).toBe(70);
    expect(result.match).toBe(true);
    expect(result.red_flags).toContain("Location: Relocation Required");
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

  it("does not false-positive on words containing 'defi' (defining, define, definition)", () => {
    const result = evaluateJob(
      rawLlm({ overall_score: 92, tech_stack_match: 95, seniority_match: 95 }),
      makeJob({
        title: "Staff Platform Engineer",
        body: "We are in a defining moment of our journey. Help us define architecture and the definition of done.",
      }),
    );
    expect(result.overall_score).toBe(92);
    expect(result.red_flags).not.toContain("Industry: Crypto/Web3");
  });

  it("force-zeroes actual DeFi jobs", () => {
    const result = evaluateJob(
      rawLlm({ overall_score: 90, tech_stack_match: 90 }),
      makeJob({ body: "Experience building DeFi protocols and smart contracts." }),
    );
    expect(result.overall_score).toBe(0);
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

describe("evaluateJob — non-JS stack rules", () => {
  it("does not treat a JavaScript red flag as Java/legacy", () => {
    const result = evaluateJob(
      rawLlm({ overall_score: 82, red_flags: ["JavaScript only no TypeScript"] }),
      makeJob({ location: "Gdańsk" }),
    );
    expect(result.red_flags).not.toContain("Stack: Legacy/Non-JS");
    expect(result.overall_score).toBe(82);
  });

  it("keeps the job when a non-JS language is only nice-to-have", () => {
    const result = evaluateJob(
      rawLlm({ overall_score: 80, red_flags: ["Java nice to have", "Python is a plus"] }),
      makeJob({ location: "Gdańsk" }),
    );
    expect(result.red_flags).toContain("Stack: Non-JS Nice-to-have");
    expect(result.red_flags).not.toContain("Stack: Legacy/Non-JS");
    expect(result.overall_score).toBe(80);
  });

  it("force-zeroes when a non-JS language is required", () => {
    for (const flag of ["Java primary stack", "Non-JS required"]) {
      const result = evaluateJob(rawLlm({ overall_score: 70, red_flags: [flag] }), makeJob({ location: "Gdańsk" }));
      expect(result.red_flags).toContain("Stack: Legacy/Non-JS");
      expect(result.overall_score).toBe(0);
    }
  });

  it("does not reject a pure Node.js backend role", () => {
    const result = evaluateJob(
      rawLlm({ overall_score: 70, red_flags: ["Pure backend role, no frontend"] }),
      makeJob({ location: "Gdańsk" }),
    );
    expect(result.red_flags).toContain("Stack: Pure Backend");
    expect(result.overall_score).toBe(70);
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

describe("extractMaxMonthlyPln — salary parsing", () => {
  it("parses standard PLN monthly B2B ranges", () => {
    expect(extractMaxMonthlyPln("14 000–18 000 PLN B2B/mo")).toBe(18000);
  });

  it("parses PLN ranges with non-breaking spaces from toLocaleString('pl-PL')", () => {
    expect(extractMaxMonthlyPln("22\u00a0000–28\u00a0000 PLN")).toBe(28000);
  });

  it("parses EUR monthly ranges and converts to PLN (* 4.25)", () => {
    expect(extractMaxMonthlyPln("4,000 - 5,500 EUR B2B/mo")).toBe(Math.round(5500 * 4.25));
  });

  it("parses USD monthly ranges and converts to PLN (* 3.95)", () => {
    expect(extractMaxMonthlyPln("5,000 - 6,000 USD B2B/mo")).toBe(Math.round(6000 * 3.95));
  });

  it("parses GBP monthly ranges and converts to PLN (* 5.0)", () => {
    expect(extractMaxMonthlyPln("4,500 - 5,000 GBP B2B/mo")).toBe(25000);
  });

  it("parses PLN hourly /h rates and multiplies by 160 hours/month", () => {
    expect(extractMaxMonthlyPln("100–120 PLN B2B/h")).toBe(19200);
  });

  it("parses CHF, daily (/day), annual (/year), and 'k' shorthand salary strings", () => {
    expect(extractMaxMonthlyPln("6 000–7 000 CHF B2B/mo")).toBe(Math.round(7000 * 4.55));
    expect(extractMaxMonthlyPln("300–350 EUR/day B2B")).toBe(Math.round(350 * 20 * 4.25));
    expect(extractMaxMonthlyPln("$96,000 - $120,000 USD/year")).toBe(Math.round((120000 / 12) * 3.95));
    expect(extractMaxMonthlyPln("6k - 7.5k EUR B2B")).toBe(Math.round(7500 * 4.25));
  });

  it("returns undefined for missing, empty, zero ('0', '0 PLN'), or non-numeric salary strings", () => {
    expect(extractMaxMonthlyPln(undefined)).toBeUndefined();
    expect(extractMaxMonthlyPln("")).toBeUndefined();
    expect(extractMaxMonthlyPln("0")).toBeUndefined();
    expect(extractMaxMonthlyPln("0 PLN")).toBeUndefined();
    expect(extractMaxMonthlyPln("0–0 EUR B2B/mo")).toBeUndefined();
    expect(extractMaxMonthlyPln("Undisclosed")).toBeUndefined();
    expect(extractMaxMonthlyPln("N/A")).toBeUndefined();
  });

  it("returns undefined for an unknown or absent currency instead of assuming PLN 1:1", () => {
    expect(extractMaxMonthlyPln("10 000 XYZ")).toBeUndefined();
    expect(extractMaxMonthlyPln("25000-30000")).toBeUndefined();
    expect(extractMaxMonthlyPln("40 000 kr/month")).toBeUndefined(); // SEK/NOK/DKK ambiguous
  });

  it("converts Scandinavian, Asian and other currencies to PLN", () => {
    expect(extractMaxMonthlyPln("55 000–65 000 SEK/mo")).toBe(Math.round(65000 * 0.38));
    expect(extractMaxMonthlyPln("60 000 DKK per month")).toBe(Math.round(60000 * 0.57));
    expect(extractMaxMonthlyPln("70000 NOK/mo")).toBe(Math.round(70000 * 0.37));
    expect(extractMaxMonthlyPln("S$9,000–12,000/month")).toBe(Math.round(12000 * 2.95));
    expect(extractMaxMonthlyPln("30,000 AED/mo")).toBe(Math.round(30000 * 1.08));
    expect(extractMaxMonthlyPln("6000EUR B2B/mo")).toBe(Math.round(6000 * 4.25));
  });

  it("does not mistake US$ for SGD or CA$ for AUD", () => {
    expect(extractMaxMonthlyPln("US$7,000/mo")).toBe(Math.round(7000 * 3.95));
    expect(extractMaxMonthlyPln("CA$10,000/mo")).toBe(Math.round(10000 * 2.85));
  });

  it("parses Japanese annual salaries (¥, M shorthand, implicit annual)", () => {
    expect(extractMaxMonthlyPln("¥8,000,000 - ¥12,000,000 per year")).toBe(Math.round((12_000_000 / 12) * 0.026));
    expect(extractMaxMonthlyPln("8M - 12M JPY")).toBe(Math.round((12_000_000 / 12) * 0.026));
  });

  it("infers annual salaries without an explicit period and parses Swiss apostrophe separators", () => {
    expect(extractMaxMonthlyPln("CHF 120'000 - 140'000")).toBe(Math.round((140000 * 4.55) / 12));
    expect(extractMaxMonthlyPln("€70,000 – €90,000")).toBe(Math.round((90000 * 4.25) / 12));
  });
});

describe("evaluateJob — expanded outsourcing & deterministic salary floor guardrails", () => {
  it("keeps jobs with missing or zero salary ('0', undefined, 'Undisclosed'), adds 'Salary: Low/Unspecified' red flag, and prevents false hard-floor zeroing", () => {
    const undisclosedJob = makeJob({ location: "Gdańsk", salary: undefined });
    const res1 = evaluateJob(rawLlm({ overall_score: 84, red_flags: [] }), undisclosedJob);
    expect(res1.overall_score).toBe(84);
    expect(res1.match).toBe(true);
    expect(res1.red_flags).toContain("Salary: Low/Unspecified");
    expect(res1.red_flags).not.toContain("Salary: Below Hard Floor");

    // Even if LLM mistakenly emits 'Below hard floor' and score=0 for a '0' salary, code recovers score & downgrades flag
    const zeroSalaryJob = makeJob({ location: "Gdańsk", salary: "0" });
    const res2 = evaluateJob(
      rawLlm({
        overall_score: 0,
        tech_stack_match: 90,
        seniority_match: 85,
        red_flags: ["Salary below hard floor"],
      }),
      zeroSalaryJob,
    );
    expect(res2.overall_score).toBeGreaterThanOrEqual(50);
    expect(res2.match).toBe(true);
    expect(res2.red_flags).toContain("Salary: Low/Unspecified");
    expect(res2.red_flags).not.toContain("Salary: Below Hard Floor");
  });

  it("prevents LLM currency-conversion mistakes from rejecting a foreign-currency salary that is above the PLN floor", () => {
    const usdJob = makeJob({ location: "Gdańsk", salary: "6 500–8 000 USD B2B/mo" });
    const res = evaluateJob(
      rawLlm({
        overall_score: 0,
        tech_stack_match: 90,
        seniority_match: 90,
        red_flags: ["Salary below hard floor"],
      }),
      usdJob,
    );
    expect(res.overall_score).toBeGreaterThanOrEqual(50);
    expect(res.match).toBe(true);
    expect(res.red_flags).not.toContain("Salary: Below Hard Floor");
  });
  it("rejects newly added Polish software houses (Netguru, STX Next) by company name", () => {
    const netguru = evaluateJob(rawLlm({ overall_score: 90 }), makeJob({ company: "Netguru S.A.", location: "Gdańsk" }));
    expect(netguru.overall_score).toBe(0);
    expect(netguru.match).toBe(false);
    expect(netguru.red_flags).toContain("Industry: Agency/Outsourcing");

    const stx = evaluateJob(rawLlm({ overall_score: 88 }), makeJob({ company: "STX Next", location: "Gdańsk" }));
    expect(stx.overall_score).toBe(0);
    expect(stx.match).toBe(false);
    expect(stx.red_flags).toContain("Industry: Agency/Outsourcing");
  });

  it("rejects jobs with body outsourcing markers like 'working for our client' or 'body leasing'", () => {
    const result = evaluateJob(
      rawLlm({ overall_score: 85 }),
      makeJob({
        company: "Some Tech",
        location: "Gdańsk",
        body: "You will be working for our client in the banking sector on a long-term body leasing basis.",
      }),
    );
    expect(result.overall_score).toBe(0);
    expect(result.match).toBe(false);
    expect(result.red_flags).toContain("Industry: Agency/Outsourcing");
  });

  it("deterministically rejects a B2B salary below the 22,000 PLN floor even when LLM returns 85 and no red flags", () => {
    const result = evaluateJob(
      rawLlm({ overall_score: 85, red_flags: [] }),
      makeJob({ location: "Gdańsk", salary: "14 000–17 000 PLN B2B/mo" }),
    );
    expect(result.overall_score).toBe(0);
    expect(result.match).toBe(false);
    expect(result.red_flags).toContain("Salary: Below Hard Floor");
  });

  it("passes a high EUR salary ('5 500–7 000 EUR B2B/mo') and respects custom dynamicConfig.minB2bPlnFloor", () => {
    const highEurJob = makeJob({ location: "Gdańsk", salary: "5 500–7 000 EUR B2B/mo" });
    const passResult = evaluateJob(rawLlm({ overall_score: 88, red_flags: [] }), highEurJob);
    expect(passResult.overall_score).toBe(88);
    expect(passResult.match).toBe(true);
    expect(passResult.red_flags).not.toContain("Salary: Below Hard Floor");

    // 7000 EUR * 4.25 = 29,750 PLN -> rejected if custom minB2bPlnFloor is set to 32,000 PLN
    const customFloorReject = evaluateJob(rawLlm({ overall_score: 88, red_flags: [] }), highEurJob, {
      cryptoKeywords: [],
      gamblingKeywords: [],
      outsourcingKeywords: [],
      tricityKeywords: ["gdańsk"],
      minB2bPlnFloor: 32000,
    });
    expect(customFloorReject.overall_score).toBe(0);
    expect(customFloorReject.match).toBe(false);
    expect(customFloorReject.red_flags).toContain("Salary: Below Hard Floor");
  });
});
