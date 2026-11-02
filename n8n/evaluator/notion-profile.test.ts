import {
  DEFAULT_CV_ENTRIES,
  DEFAULT_CRITERIA_ENTRIES,
  compileCandidateProfileMarkdown,
  compileDynamicScoringConfig,
  provisionAndSeedNotionControlPlane,
  fetchNotionControlPlaneData,
  resolveParentPageIdFromDatabase,
  getActiveControlPlaneConfig,
  invalidateControlPlaneCache,
  type CvEntry,
  type CriterionEntry,
} from "./notion-profile";
import { evaluateJob } from "./scoring";

describe("notion-profile compiler & Notion API client", () => {
  test("compileCandidateProfileMarkdown includes all active sections and omits inactive entries", () => {
    const customCv: CvEntry[] = [
      ...DEFAULT_CV_ENTRIES,
      {
        id: "cv-inactive",
        title: "Old PHP Internship",
        section: "Key Achievement",
        order: 99,
        highlight: "Should never appear in compiled markdown",
        tags: ["PHP"],
        period: "2016",
        active: false,
      },
    ];

    const customCriteria: CriterionEntry[] = [
      ...DEFAULT_CRITERIA_ENTRIES,
      {
        id: "crit-inactive",
        ruleName: "Disabled Experimental Rule",
        category: "Hard Reject (Red Flag)",
        enforcement: "Prompt Rule (LLM Only)",
        ruleType: "Discard (Score < 50)",
        valueOrKeywords: "experimental",
        description: "Should not appear when active=false",
        order: 99,
        active: false,
      },
    ];

    const markdown = compileCandidateProfileMarkdown(customCv, customCriteria);

    expect(markdown).toContain("# Candidate Profile & Preferences");
    expect(markdown).toContain("## 1. Professional Background & Stack");
    expect(markdown).toContain("JavaScript, TypeScript, React, Next.js, Node.js, NestJS, PostgreSQL");
    expect(markdown).toContain("## 3. Employment & Salary Expectations");
    expect(markdown).toContain("Hard Salary Floor (Min 18k PLN Net / ~22k B2B");
    expect(markdown).toContain("Undisclosed or Zero Salary -> Keep & Flag as Red Flag");
    expect(markdown).toContain("NO Crypto / Web3 / Blockchain");
    expect(markdown).not.toContain("Should never appear in compiled markdown");
    expect(markdown).not.toContain("Disabled Experimental Rule");
  });

  test("compileDynamicScoringConfig extracts keywords and numeric floor from active Hard Gate rules", () => {
    const customCriteria: CriterionEntry[] = [
      {
        id: "crit-salary-floor",
        ruleName: "Hard Salary Floor",
        category: "Salary & Contract",
        enforcement: "Hard Gate (Code + Prompt)",
        ruleType: "Force Reject (Score = 0)",
        valueOrKeywords: "25000 PLN B2B",
        description: "Updated floor",
        order: 1,
        active: true,
      },
      {
        id: "crit-reject-outsourcing",
        ruleName: "NO Agency / Outsourcing",
        category: "Hard Reject (Red Flag)",
        enforcement: "Hard Gate (Code + Prompt)",
        ruleType: "Force Reject (Score = 0)",
        valueOrKeywords: "netguru, stx next, custom-bodyshop",
        description: "Custom agency list",
        order: 2,
        active: true,
      },
    ];

    const cfg = compileDynamicScoringConfig(customCriteria);
    expect(cfg.minB2bPlnFloor).toBe(25000);
    expect(cfg.outsourcingKeywords).toEqual(["netguru", "stx next", "custom-bodyshop"]);
    // Unspecified gates fall back safely to defaults
    expect(cfg.cryptoKeywords).toContain("blockchain");
  });

  test("evaluateJob respects dynamic outsourcing keywords from Notion", () => {
    const cfg = compileDynamicScoringConfig([
      {
        id: "crit-reject-outsourcing",
        ruleName: "NO Agency / Outsourcing",
        category: "Hard Reject (Red Flag)",
        enforcement: "Hard Gate (Code + Prompt)",
        ruleType: "Force Reject (Score = 0)",
        valueOrKeywords: "netguru, customvendor",
        description: "Reject customvendor",
        order: 1,
        active: true,
      },
    ]);

    const rawLlm = JSON.stringify({
      overall_score: 88,
      tech_stack_match: 90,
      seniority_match: 90,
      red_flags: [],
      reason: "Strong Node.js + React role in Gdańsk.",
    });

    const result = evaluateJob(
      rawLlm,
      {
        id: "job_1",
        title: "Senior Full-Stack Engineer",
        company: "CustomVendor Sp. z o.o.",
        location: "Gdańsk",
        url: "https://example.com/1",
      },
      cfg,
    );

    expect(result.overall_score).toBe(0);
    expect(result.match).toBe(false);
    expect(result.red_flags).toContain("Industry: Agency/Outsourcing");
  });

  test("resolveParentPageIdFromDatabase extracts parent page_id from Notion database metadata", async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "db_123",
        parent: { type: "page_id", page_id: "parent_page_abc" },
      }),
    }) as unknown as typeof fetch;

    const parentId = await resolveParentPageIdFromDatabase(
      { token: "test_token", fetchImpl: mockFetch },
      "db-123",
    );
    expect(parentId).toBe("parent_page_abc");
  });

  test("provisionAndSeedNotionControlPlane creates hub page, 2 databases, and seeds rows", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    let counter = 0;

    const mockFetch = jest.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      counter++;
      const parsedBody = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, body: parsedBody });
      return {
        ok: true,
        json: async () => ({
          id: `notion_id_${counter}`,
          url: `https://www.notion.so/notion_id_${counter}`,
        }),
      };
    }) as unknown as typeof fetch;

    const res = await provisionAndSeedNotionControlPlane(
      { token: "test_token", fetchImpl: mockFetch },
      "parent_page_1",
      DEFAULT_CV_ENTRIES.slice(0, 2),
      DEFAULT_CRITERIA_ENTRIES.slice(0, 2),
    );

    expect(res.controlPlanePageId).toBe("parent_page_1");
    expect(res.cvDbId).toBe("notion_id_2");
    expect(res.criteriaDbId).toBe("notion_id_3");
    expect(res.seededCvCount).toBe(2);
    expect(res.seededCriteriaCount).toBe(2);
    // 1 hub page + 2 databases + 2 CV rows + 2 Criteria rows = 7 API calls
    expect(calls).toHaveLength(7);
  });

  test("fetchNotionControlPlaneData queries both databases and compiles profile + config", async () => {
    const mockFetch = jest.fn().mockImplementation(async (url: string) => {
      if (url.includes("cv_db_id")) {
        return {
          ok: true,
          json: async () => ({
            results: [
              {
                id: "row_cv_1",
                properties: {
                  Title: { title: [{ plain_text: "Senior AI & Full-Stack Engineer" }] },
                  Section: { select: { name: "Role & Summary" } },
                  "Highlight / Summary": {
                    rich_text: [{ plain_text: "Senior Engineer focused on TypeScript, Node.js, and AI." }],
                  },
                  "Tech Tags": { multi_select: [{ name: "TypeScript" }, { name: "AI" }] },
                  Period: { rich_text: [{ plain_text: "2026" }] },
                  Order: { number: 1 },
                  Active: { checkbox: true },
                },
              },
            ],
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          results: [
            {
              id: "row_crit_1",
              properties: {
                "Rule Name": { title: [{ plain_text: "Hard Salary Floor" }] },
                Category: { select: { name: "Salary & Contract" } },
                Enforcement: { select: { name: "Hard Gate (Code + Prompt)" } },
                "Rule Type": { select: { name: "Force Reject (Score = 0)" } },
                "Value / Keywords": { rich_text: [{ plain_text: "24000" }] },
                "Rule Description (For Prompt)": {
                  rich_text: [{ plain_text: "Minimum 24,000 PLN B2B." }],
                },
                Order: { number: 1 },
                Active: { checkbox: true },
              },
            },
          ],
        }),
      };
    }) as unknown as typeof fetch;

    const data = await fetchNotionControlPlaneData(
      { token: "test_token", fetchImpl: mockFetch },
      "cv_db_id",
      "crit_db_id",
    );

    expect(data.cvEntries).toHaveLength(1);
    expect(data.criteriaEntries).toHaveLength(1);
    expect(data.profileMarkdown).toContain("Senior Engineer focused on TypeScript, Node.js, and AI.");
    expect(data.profileMarkdown).toContain("Minimum 24,000 PLN B2B.");
    expect(data.scoringConfig.minB2bPlnFloor).toBe(24000);
  });

  test("throws informative error on non-2xx Notion API response", async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => '{"code":"unauthorized","message":"API token is invalid."}',
    }) as unknown as typeof fetch;

    await expect(
      resolveParentPageIdFromDatabase({ token: "bad", fetchImpl: mockFetch }, "db1"),
    ).rejects.toThrow(/Notion API .* failed \(401\)/);
  });
});

describe("getActiveControlPlaneConfig & TTL cache", () => {
  const originalEnv = process.env;
  beforeEach(() => {
    invalidateControlPlaneCache();
    process.env = { ...originalEnv };
    delete process.env["NOTION_TOKEN"];
    delete process.env["NOTION_CV_DB_ID"];
    delete process.env["NOTION_CRITERIA_DB_ID"];
  });

  afterEach(() => {
    invalidateControlPlaneCache();
    process.env = originalEnv;
  });

  test("requires Notion credentials instead of falling back to local profile", async () => {
    await expect(getActiveControlPlaneConfig()).rejects.toThrow(/Notion CV and Matching Criteria credentials/);
  });

  test("fetches live Notion data, caches within TTL, and refreshes after invalidateControlPlaneCache()", async () => {
    process.env["NOTION_CV_DB_ID"] = "cv_db_live";
    process.env["NOTION_CRITERIA_DB_ID"] = "crit_db_live";

    let fetchBatchCount = 0;
    const mockFetch = jest.fn().mockImplementation(async (url: string) => {
      if (url.includes("cv_db_live")) {
        fetchBatchCount++;
        return {
          ok: true,
          json: async () => ({
            results: [
              {
                id: "live_cv_1",
                properties: {
                  Title: { title: [{ plain_text: "Live Notion Role" }] },
                  Section: { select: { name: "Role & Summary" } },
                  "Highlight / Summary": {
                    rich_text: [{ plain_text: `Live Notion Highlight #${fetchBatchCount}` }],
                  },
                  "Tech Tags": { multi_select: [{ name: "Node.js" }] },
                  Period: { rich_text: [{ plain_text: "2026" }] },
                  Order: { number: 1 },
                  Active: { checkbox: true },
                },
              },
            ],
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          results: [
            {
              id: "crit-salary-floor",
              properties: {
                "Rule Name": { title: [{ plain_text: "Hard Salary Floor" }] },
                Category: { select: { name: "Salary & Contract" } },
                Enforcement: { select: { name: "Hard Gate (Code + Prompt)" } },
                "Rule Type": { select: { name: "Force Reject (Score = 0)" } },
                "Value / Keywords": { rich_text: [{ plain_text: "26000" }] },
                "Rule Description (For Prompt)": {
                  rich_text: [{ plain_text: "Live 26k floor" }],
                },
                Order: { number: 1 },
                Active: { checkbox: true },
              },
            },
          ],
        }),
      };
    }) as unknown as typeof fetch;

    const clientOptions = { token: "ntn_live_token", fetchImpl: mockFetch };

    // First call hits Notion (2 parallel DB queries)
    const first = await getActiveControlPlaneConfig({ clientOptions });
    expect(first.source).toBe("notion");
    expect(first.profileMarkdown).toContain("Live Notion Highlight #1");
    expect(first.scoringConfig.minB2bPlnFloor).toBe(26000);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Second consecutive call within TTL returns cached result without calling mockFetch again
    const second = await getActiveControlPlaneConfig({ clientOptions });
    expect(second).toBe(first);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Calling invalidateControlPlaneCache() forces a fresh Notion fetch on next call
    invalidateControlPlaneCache();
    const third = await getActiveControlPlaneConfig({ clientOptions });
    expect(third.profileMarkdown).toContain("Live Notion Highlight #2");
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  test("fails closed when Notion API throws", async () => {
    process.env["NOTION_CV_DB_ID"] = "cv_db_live";
    process.env["NOTION_CRITERIA_DB_ID"] = "crit_db_live";
    const mockFetch = jest.fn().mockRejectedValue(new Error("Notion 503 Service Unavailable")) as unknown as typeof fetch;
    await expect(getActiveControlPlaneConfig({
      clientOptions: { token: "ntn_live_token", fetchImpl: mockFetch },
    })).rejects.toThrow("Notion 503 Service Unavailable");
  });
});
