import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  buildEvaluationPrompt,
  DEFAULT_TEMPLATE_PATH,
  EVALUATOR_OUTPUT_SCHEMA,
  loadSystemPromptTemplate,
} from "./prompt-builder";
import type { JobForScoring } from "./scoring";

describe("evaluator-template.json & loadSystemPromptTemplate", () => {
  it("parses evaluator-template.json as valid JSON and preserves all template placeholders", () => {
    const raw = fs.readFileSync(DEFAULT_TEMPLATE_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Array<{ role: string; content: string }>;

    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.role).toBe("system");
    expect(parsed[0]?.content).toContain("{{profile}}");

    expect(parsed[1]?.role).toBe("user");
    expect(parsed[1]?.content).toContain("{{title}}");
    expect(parsed[1]?.content).toContain("{{company}}");
    expect(parsed[1]?.content).toContain("{{location}}");
    expect(parsed[1]?.content).toContain("{{salary}}");
    expect(parsed[1]?.content).toContain("{{url}}");
    expect(parsed[1]?.content).toContain("{{body}}");
  });

  it("includes EUR/USD foreign currency guidance and all 4 Level-2 calibration examples", () => {
    const systemTemplate = loadSystemPromptTemplate();

    expect(systemTemplate).toContain("{{profile}}");
    expect(systemTemplate).toContain("1 EUR ≈ 4.25 PLN");
    expect(systemTemplate).toContain("1 USD ≈ 3.95 PLN");
    expect(systemTemplate).toContain("**Calibration Examples (Few-Shot Reference):**");
    expect(systemTemplate).toContain("Example 1 (Hot Match — Full-Stack + AI/Product)");
    expect(systemTemplate).toContain("Example 2 (Review Match — Node.js Backend-Only)");
    expect(systemTemplate).toContain(
      "Example 3 (Hot Match — Legacy Migration with Node.js Primary)",
    );
    expect(systemTemplate).toContain(
      "Example 4 (Force Reject — Outsourcing / Body-Leasing)",
    );

    // Calibration section appears before CRITICAL OUTPUT FORMAT RULE
    const calibrationIdx = systemTemplate.indexOf(
      "**Calibration Examples (Few-Shot Reference):**",
    );
    const outputRuleIdx = systemTemplate.indexOf("**CRITICAL OUTPUT FORMAT RULE:**");
    expect(calibrationIdx).toBeGreaterThan(0);
    expect(outputRuleIdx).toBeGreaterThan(calibrationIdx);
  });

  it("throws a clear error when the template file has no system message entry", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "prompt-builder-test-"));
    const invalidPath = path.join(tmpDir, "invalid.json");
    fs.writeFileSync(invalidPath, JSON.stringify([{ role: "user", content: "hi" }]));

    try {
      expect(() => loadSystemPromptTemplate(invalidPath)).toThrow(
        /missing non-empty system message entry/,
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("buildEvaluationPrompt", () => {
  const sampleJob: JobForScoring = {
    id: "justjoin_1",
    title: "Senior Full-Stack Engineer",
    company: "Acme SaaS",
    location: "Remote EU",
    salary: "6 500 EUR B2B/mo",
    url: "https://justjoin.it/offers/acme-saas-senior-fullstack",
    body: "Building TypeScript, React, and NestJS microservices.",
  };

  it("injects profileMarkdown into {{profile}} and formats all JobForScoring fields", () => {
    const profileMarkdown = "# Candidate Profile\n- Primary stack: TypeScript, React, Node.js";
    const built = buildEvaluationPrompt(sampleJob, profileMarkdown);

    expect(built.systemPrompt).toContain(profileMarkdown);
    expect(built.systemPrompt).not.toContain("{{profile}}");

    expect(built.userMessage).toBe(
      [
        "Job Title: Senior Full-Stack Engineer",
        "Company: Acme SaaS",
        "Location: Remote EU",
        "Salary: 6 500 EUR B2B/mo",
        "URL: https://justjoin.it/offers/acme-saas-senior-fullstack",
        "",
        "Job Description:",
        "Building TypeScript, React, and NestJS microservices.",
      ].join("\n"),
    );

    expect(built.outputSchema).toBe(EVALUATOR_OUTPUT_SCHEMA);
  });

  it("uses sensible fallbacks when optional job fields (body, salary, location, title, company) are omitted or blank", () => {
    const minimalJob: JobForScoring = {
      id: "nofluff_2",
      url: "https://nofluffjobs.com/pl/job/minimal",
      body: "   ",
    };

    const built = buildEvaluationPrompt(minimalJob, "Profile Content");

    expect(built.userMessage).toContain("Job Title: Unknown Title");
    expect(built.userMessage).toContain("Company: Unknown Company");
    expect(built.userMessage).toContain("Location: Unspecified");
    expect(built.userMessage).toContain("Salary: Unspecified");
    expect(built.userMessage).toContain("URL: https://nofluffjobs.com/pl/job/minimal");
    expect(built.userMessage).toContain("Job Description:\nNo description available");
  });
});

describe("EVALUATOR_OUTPUT_SCHEMA", () => {
  it("requires all 6 expected evaluation output fields and disallows additional properties", () => {
    expect(EVALUATOR_OUTPUT_SCHEMA.type).toBe("object");
    expect(EVALUATOR_OUTPUT_SCHEMA.additionalProperties).toBe(false);
    expect(EVALUATOR_OUTPUT_SCHEMA.required).toEqual([
      "overall_score",
      "tech_stack_match",
      "seniority_match",
      "red_flags",
      "reason",
      "url",
    ]);
    expect(Object.keys(EVALUATOR_OUTPUT_SCHEMA.properties)).toEqual([
      "overall_score",
      "tech_stack_match",
      "seniority_match",
      "red_flags",
      "reason",
      "url",
    ]);
  });
});
