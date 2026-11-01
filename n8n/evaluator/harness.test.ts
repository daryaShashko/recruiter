import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  computeEvalCacheKey,
  convertVerdictRowToEvalCase,
  EvalResponseCache,
  fetchWrongVerdictsFromNotion,
  HarnessTestCase,
  runHarnessCase,
  validateReasonDeterministically,
} from "./harness";
import type { JobForScoring } from "./scoring";

function makeJob(overrides: Partial<JobForScoring> = {}): JobForScoring {
  return {
    id: "test_job_1",
    title: "Senior Full-Stack Engineer (React / Node.js)",
    company: "ProductLabs",
    url: "https://justjoin.it/job-offer/productlabs-senior-fullstack",
    source: "justjoin",
    location: "Gdańsk",
    salary: "26 000 - 30 000 PLN B2B",
    body: "Senior Full-Stack role in Gdańsk building React and Node.js microservices.",
    ...overrides,
  };
}

describe("validateReasonDeterministically", () => {
  it("accepts a concise, concrete reason mentioning stack and location", () => {
    const res = validateReasonDeterministically(
      "Strong Senior React and Node.js role in Gdańsk with 26-30k PLN B2B salary.",
    );
    expect(res.valid).toBe(true);
    expect(res.error).toBeUndefined();
  });

  it("rejects a reason that is too short (< 15 chars)", () => {
    const res = validateReasonDeterministically("Node.js role");
    expect(res.valid).toBe(false);
    expect(res.error).toMatch(/between 15 and 320/);
  });

  it("rejects generic boilerplate phrases even when they contain words like stack", () => {
    expect(
      validateReasonDeterministically("Does not match the candidate's profile at all."),
    ).toEqual({
      valid: false,
      error: expect.stringContaining("does not match the candidate's profile"),
    });

    expect(
      validateReasonDeterministically(
        "This is a strong match for the candidate's preferred stack and goals.",
      ),
    ).toEqual({
      valid: false,
      error: expect.stringContaining("strong match for the candidate's preferred stack"),
    });

    expect(
      validateReasonDeterministically("Looks like a good fit for the Senior React developer."),
    ).toEqual({
      valid: false,
      error: expect.stringContaining("good fit"),
    });
  });

  it("rejects a non-boilerplate string that lacks any concrete domain token", () => {
    const res = validateReasonDeterministically(
      "The company offers interesting challenges and great team culture for everyone.",
    );
    expect(res.valid).toBe(false);
    expect(res.error).toMatch(/concrete domain token/);
  });
});

describe("computeEvalCacheKey & EvalResponseCache", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-cache-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("produces deterministic SHA-256 hex keys that change when inputs change", () => {
    const k1 = computeEvalCacheKey("sys-a", "user-a", "gemini");
    const k2 = computeEvalCacheKey("sys-a", "user-a", "gemini");
    const k3 = computeEvalCacheKey("sys-b", "user-a", "gemini");

    expect(k1).toBe(k2);
    expect(k1).toMatch(/^[a-f0-9]{64}$/);
    expect(k1).not.toBe(k3);
  });

  it("persists cache entries to disk and hits cache on subsequent runHarnessCase calls", async () => {
    const cacheFile = path.join(tmpDir, ".eval-cache.json");
    const cache = new EvalResponseCache(cacheFile);

    const completeFn = jest.fn().mockResolvedValue({
      content: JSON.stringify({
        overall_score: 88,
        tech_stack_match: 90,
        seniority_match: 90,
        red_flags: [],
        reason: "Senior React and Node.js role in Gdańsk with 26-30k PLN B2B.",
      }),
      provider: "mock-gemini",
    });

    const testCase: HarnessTestCase = {
      id: "case_cache_1",
      description: "Hot match in Gdańsk",
      job: makeJob(),
      expectedMatch: true,
      minScore: 80,
    };

    const run1 = await runHarnessCase(testCase, {
      systemPrompt: "Evaluate job",
      outputSchema: {},
      cache,
      completeFn,
    });
    expect(run1.passed).toBe(true);
    expect(run1.cached).toBe(false);
    expect(completeFn).toHaveBeenCalledTimes(1);

    // Reload from disk to verify persistence
    const reloadedCache = new EvalResponseCache(cacheFile);
    const run2 = await runHarnessCase(testCase, {
      systemPrompt: "Evaluate job",
      outputSchema: {},
      cache: reloadedCache,
      completeFn,
    });
    expect(run2.passed).toBe(true);
    expect(run2.cached).toBe(true);
    expect(run2.provider).toBe("mock-gemini");
    expect(completeFn).toHaveBeenCalledTimes(1);
  });
});

describe("runHarnessCase — pass/fail and scoring.ts hard-reject enforcement", () => {
  it("reports failures when score or match expectations are violated", async () => {
    const completeFn = jest.fn().mockResolvedValue({
      content: JSON.stringify({
        overall_score: 40,
        tech_stack_match: 50,
        seniority_match: 40,
        red_flags: [],
        reason: "Mid-level PHP maintenance role in Warsaw on-site.",
      }),
      provider: "mock-gemini",
    });

    const testCase: HarnessTestCase = {
      id: "case_fail_check",
      description: "Expects hot match but LLM returns 40",
      job: makeJob(),
      expectedMatch: true,
      minScore: 80,
      requiredRedFlags: ["Stack: Legacy/Non-JS"],
    };

    const res = await runHarnessCase(testCase, {
      systemPrompt: "sys",
      outputSchema: {},
      useCache: false,
      completeFn,
    });

    expect(res.passed).toBe(false);
    expect(res.failures.length).toBeGreaterThanOrEqual(3);
  });

  it("overrides a high LLM score to 0 when scoring.ts detects an outsourcing company (Netguru)", async () => {
    const completeFn = jest.fn().mockResolvedValue({
      content: JSON.stringify({
        overall_score: 92,
        tech_stack_match: 95,
        seniority_match: 90,
        red_flags: [],
        reason: "Senior TypeScript and React role in Gdańsk, but at Netguru agency.",
      }),
      provider: "mock-gemini",
    });

    const testCase: HarnessTestCase = {
      id: "case_netguru_hard_reject",
      description: "Netguru agency must be hard-rejected by scoring.ts even if LLM gives 92",
      job: makeJob({ company: "Netguru" }),
      expectedMatch: false,
      maxScore: 0,
      requiredRedFlags: ["Industry: Agency/Outsourcing"],
    };

    const res = await runHarnessCase(testCase, {
      systemPrompt: "sys",
      outputSchema: {},
      useCache: false,
      completeFn,
    });

    expect(res.result.overall_score).toBe(0);
    expect(res.result.match).toBe(false);
    expect(res.passed).toBe(true);
  });

  it("overrides a high LLM score to 0 when scoring.ts detects salary below hard floor", async () => {
    const completeFn = jest.fn().mockResolvedValue({
      content: JSON.stringify({
        overall_score: 85,
        tech_stack_match: 90,
        seniority_match: 85,
        red_flags: [],
        reason: "Senior React and Node.js role in Gdańsk with 14000 PLN B2B salary.",
      }),
      provider: "mock-gemini",
    });

    const testCase: HarnessTestCase = {
      id: "case_low_salary_hard_reject",
      description: "Salary 12 000 - 15 000 PLN B2B must be hard-rejected to 0",
      job: makeJob({ salary: "12 000 - 15 000 PLN B2B" }),
      expectedMatch: false,
      maxScore: 0,
      requiredRedFlags: ["Salary: Below Hard Floor"],
    };

    const res = await runHarnessCase(testCase, {
      systemPrompt: "sys",
      outputSchema: {},
      useCache: false,
      completeFn,
    });

    expect(res.result.overall_score).toBe(0);
    expect(res.result.red_flags).toContain("Salary: Below Hard Floor");
    expect(res.passed).toBe(true);
  });
});

describe("Notion Evaluation Log Data Flywheel", () => {
  it("queries Notion with an OR filter on Human Verdict and converts both Wrong – Should Match and Wrong – Should Reject rows", async () => {
    const mockFetch: typeof fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        results: [
          {
            id: "12345678-aaaa-bbbb-cccc-000000000001",
            properties: {
              "Job Title": {
                title: [{ plain_text: "Senior Node.js Backend Engineer" }],
              },
              Company: {
                rich_text: [{ plain_text: "FinTech ScaleUp" }],
              },
              URL: { url: "https://nofluffjobs.com/job/fintech-node" },
              Source: { select: { name: "nofluffjobs" } },
              "Human Verdict": { select: { name: "Wrong – Should Match" } },
              "LLM Score": { number: 35 },
              "LLM Reason": {
                rich_text: [
                  {
                    plain_text:
                      "Backend-only Node.js and TypeScript role in Gdańsk with 26k PLN B2B.",
                  },
                ],
              },
              "Red Flags": {
                multi_select: [{ name: "Stack: Pure Backend" }],
              },
            },
          },
          {
            id: "87654321-dddd-eeee-ffff-000000000002",
            properties: {
              "Job Title": {
                title: [{ plain_text: "Regular React Developer" }],
              },
              Company: {
                rich_text: [{ plain_text: "CryptoBet Agency" }],
              },
              URL: { url: "https://justjoin.it/job/cryptobet" },
              Source: { select: { name: "justjoin" } },
              "Human Verdict": { select: { name: "Wrong – Should Reject" } },
              "LLM Score": { number: 78 },
              "LLM Reason": {
                rich_text: [{ plain_text: "React and TypeScript role in Web3 casino." }],
              },
              "Red Flags": { multi_select: [] },
            },
          },
        ],
      }),
    } as unknown as Response);

    const rows = await fetchWrongVerdictsFromNotion(
      { token: "secret_test", fetchImpl: mockFetch },
      "db-id-1234-5678",
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = (mockFetch as jest.Mock).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(calledUrl).toBe("https://api.notion.com/v1/databases/dbid12345678/query");
    const parsedBody = JSON.parse(calledInit.body as string) as {
      filter: { or: Array<{ property: string; select: { equals: string } }> };
    };
    expect(parsedBody.filter.or).toEqual([
      { property: "Human Verdict", select: { equals: "Wrong – Should Match" } },
      { property: "Human Verdict", select: { equals: "Wrong – Should Reject" } },
    ]);

    expect(rows).toHaveLength(2);

    const matchCase = convertVerdictRowToEvalCase(rows[0]!);
    expect(matchCase.id).toBe("flywheel_12345678");
    expect(matchCase.expectedMatch).toBe(true);
    expect(matchCase.minScore).toBe(50);
    expect(matchCase.maxScore).toBe(100);

    const rejectCase = convertVerdictRowToEvalCase(rows[1]!);
    expect(rejectCase.id).toBe("flywheel_87654321");
    expect(rejectCase.expectedMatch).toBe(false);
    expect(rejectCase.minScore).toBe(0);
    expect(rejectCase.maxScore).toBe(49);
  });
});
