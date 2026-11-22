/**
 * Prompt builder for the LLM Evaluator (Phase P13-4, ADR-017 Level 2 Few-Shot Calibration).
 *
 * Loads the canonical system prompt template from `n8n/prompts/evaluator-template.json`,
 * injects the candidate profile markdown into `{{profile}}`, formats the vacancy user
 * message, and exports the structured JSON Schema required from the LLM.
 */

import * as fs from "fs";
import * as path from "path";
import type { JobForScoring } from "./scoring";

export const DEFAULT_TEMPLATE_PATH = path.resolve(
  __dirname,
  "../prompts/evaluator-template.json",
);

export const EVALUATOR_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    overall_score: {
      type: "integer",
      minimum: 0,
      maximum: 100,
      description: "Overall match score from 0 to 100.",
    },
    tech_stack_match: {
      type: "integer",
      minimum: 0,
      maximum: 100,
      description: "Tech stack alignment score from 0 to 100.",
    },
    seniority_match: {
      type: "integer",
      minimum: 0,
      maximum: 100,
      description: "Seniority alignment score from 0 to 100.",
    },
    red_flags: {
      type: "array",
      items: { type: "string" },
      description: "Short 2-4 word red flag tags without commas.",
    },
    reason: {
      type: "string",
      description: "One-sentence concrete explanation citing specific job details.",
    },
    url: {
      type: "string",
      description: "Original job offer URL.",
    },
    company_dossier: {
      type: "string",
      description:
        "1-2 concise sentences in Russian: product, business model (B2B/B2C), and company scale without hallucination.",
    },
    project_summary: {
      type: "string",
      description:
        "Product/domain, business model (B2B/B2C/SaaS), and scale summary in Russian, without fluff or hallucination.",
    },
    tasks_summary: {
      type: "array",
      items: { type: "string" },
      description:
        "2-3 concrete Russian bullet strings describing what the engineer will build/do hands-on.",
    },
    match_pros: {
      type: "array",
      items: { type: "string" },
      description: "Concrete pros in Russian for this candidate's profile.",
    },
    match_cons: {
      type: "array",
      items: { type: "string" },
      description: "Concrete cons or risks in Russian for this candidate's profile.",
    },
    pitch_hook: {
      type: "string",
      description:
        "1 Russian sentence on which specific experience from the candidate's CV will hook the company/recruiter.",
    },
  },
  required: [
    "overall_score",
    "tech_stack_match",
    "seniority_match",
    "red_flags",
    "reason",
    "url",
    "company_dossier",
    "project_summary",
    "tasks_summary",
    "match_pros",
    "match_cons",
    "pitch_hook",
  ],
  additionalProperties: false,
} as const;

export const EVALUATOR_OUTPUT_SCHEMA_WITH_DOSSIER = EVALUATOR_OUTPUT_SCHEMA;

interface PromptTemplateEntry {
  readonly role: string;
  readonly content: string;
}

function isPromptTemplateEntry(value: unknown): value is PromptTemplateEntry {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v["role"] === "string" && typeof v["content"] === "string";
}

/**
 * Reads `n8n/prompts/evaluator-template.json`, validates the system message entry,
 * and returns its raw `content` string (including `{{profile}}`).
 */
export function loadSystemPromptTemplate(
  templatePath: string = DEFAULT_TEMPLATE_PATH,
): string {
  const raw = fs.readFileSync(templatePath, "utf-8");
  const parsed: unknown = JSON.parse(raw);

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(
      `Invalid prompt template at ${templatePath}: expected a non-empty JSON array of messages`,
    );
  }

  const systemEntry = parsed.find(
    (item): item is PromptTemplateEntry =>
      isPromptTemplateEntry(item) && item.role === "system",
  );

  if (!systemEntry || systemEntry.content.trim().length === 0) {
    throw new Error(
      `Invalid prompt template at ${templatePath}: missing non-empty system message entry`,
    );
  }

  return systemEntry.content;
}

export interface BuiltEvaluationPrompt {
  readonly systemPrompt: string;
  readonly userMessage: string;
  readonly outputSchema: typeof EVALUATOR_OUTPUT_SCHEMA;
}

/**
 * Replaces `{{profile}}` in the system prompt template with `profileMarkdown` and
 * formats the user message for `job` with safe fallbacks for optional fields.
 */
export function buildEvaluationPrompt(
  job: JobForScoring,
  profileMarkdown: string,
  templatePath: string = DEFAULT_TEMPLATE_PATH,
): BuiltEvaluationPrompt {
  const rawSystemPrompt = loadSystemPromptTemplate(templatePath);
  const systemPrompt = rawSystemPrompt.replaceAll("{{profile}}", profileMarkdown);

  const title = job.title?.trim() || "Unknown Title";
  const company = job.company?.trim() || "Unknown Company";
  const location = job.location?.trim() || "Unspecified";
  const salary = job.salary?.trim() || "Unspecified";
  const url = job.url.trim();
  const body = job.body?.trim() || "No description available";

  const userMessage = [
    `Job Title: ${title}`,
    `Company: ${company}`,
    `Location: ${location}`,
    `Salary: ${salary}`,
    `URL: ${url}`,
    "",
    "Job Description:",
    body,
  ].join("\n");

  return {
    systemPrompt,
    userMessage,
    outputSchema: EVALUATOR_OUTPUT_SCHEMA,
  };
}
