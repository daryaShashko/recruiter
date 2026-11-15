#!/usr/bin/env ts-node
/**
 * CLI for the Notion Live Control Plane (Candidate CV & Matching Criteria).
 *
 * Commands:
 *   ts-node evaluator/notion-cli.ts provision   # Create both DBs in Notion & seed all current CV/Criteria rows
 *   ts-node evaluator/notion-cli.ts sync        # Export live Notion profile and rules to stdout (read-only)
 *   ts-node evaluator/notion-cli.ts preview     # Compile historic seed entries offline (not production)
 *
 * Environment variables:
 *   NOTION_TOKEN            - Required for `provision` and `sync` (Notion Internal Integration Token)
 *   NOTION_PARENT_PAGE_ID   - Optional parent page ID; if omitted, resolved automatically from
 *                             NOTION_DB_ID / NOTION_EVAL_LOG_DB_ID or workspace search.
 *   NOTION_CV_DB_ID         - Set automatically in .notion-control-plane.json after `provision`
 *   NOTION_CRITERIA_DB_ID   - Set automatically in .notion-control-plane.json after `provision`
 */

import * as fs from "fs";
import * as path from "path";
import {
  DEFAULT_CV_ENTRIES,
  DEFAULT_CRITERIA_ENTRIES,
  compileCandidateProfileMarkdown,
  compileDynamicScoringConfig,
  provisionAndSeedNotionControlPlane,
  fetchNotionControlPlaneData,
  resolveParentPageIdFromDatabase,
} from "./notion-profile";

const PROMPTS_DIR = path.resolve(__dirname, "../prompts");
const META_FILE = path.join(PROMPTS_DIR, ".notion-control-plane.json");
const PROFILE_FILE = path.join(PROMPTS_DIR, "candidate_profile.md");
const SNAPSHOT_FILE = path.join(PROMPTS_DIR, ".notion-snapshot.json");

// Default Evaluation Log DB ID from context/ingest-workflow.yaml
const KNOWN_EVAL_LOG_DB_ID = "36c747f7-ebec-80c8-bfd7-ed317f4a7c35";

interface ControlPlaneMeta {
  controlPlanePageId: string;
  controlPlanePageUrl: string;
  cvDbId: string;
  cvDbUrl: string;
  criteriaDbId: string;
  criteriaDbUrl: string;
  provisionedAt: string;
}

function loadEnvFiles(): void {
  const candidates = [
    path.resolve(__dirname, "../../.env"),
    path.resolve(__dirname, "../.env"),
    path.resolve(__dirname, "../../scraper/.env"),
  ];
  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) continue;
    const content = fs.readFileSync(envPath, "utf-8");
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#") || !line.includes("=")) continue;
      const idx = line.indexOf("=");
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, "");
      if (key && !process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

function requireNotionToken(): string {
  const token = (process.env["NOTION_TOKEN"] ?? "").trim();
  if (!token) {
    console.error(
      "ERROR: NOTION_TOKEN is not set.\n" +
        "Set NOTION_TOKEN in your .env file (or pass NOTION_TOKEN=secret_... before the command).",
    );
    process.exit(1);
  }
  return token;
}

function readSavedMeta(): Partial<ControlPlaneMeta> {
  if (!fs.existsSync(META_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(META_FILE, "utf-8")) as Partial<ControlPlaneMeta>;
  } catch {
    return {};
  }
}

async function runProvision(): Promise<void> {
  const token = requireNotionToken();
  const explicitParent = (process.env["NOTION_PARENT_PAGE_ID"] ?? "").trim();
  const existingDbId = (
    process.env["NOTION_DB_ID"]?.trim() ||
    process.env["NOTION_EVAL_LOG_DB_ID"]?.trim() ||
    KNOWN_EVAL_LOG_DB_ID
  );

  console.log("[notion-cli] Resolving parent page in Notion workspace...");
  const parentPageId = explicitParent
    ? explicitParent
    : await resolveParentPageIdFromDatabase({ token }, existingDbId);

  console.log("[notion-cli] Creating Control Plane page + 2 databases and seeding rows...");
  const created = await provisionAndSeedNotionControlPlane({ token }, parentPageId);

  const meta: ControlPlaneMeta = {
    controlPlanePageId: created.controlPlanePageId,
    controlPlanePageUrl: created.controlPlanePageUrl,
    cvDbId: created.cvDbId,
    cvDbUrl: created.cvDbUrl,
    criteriaDbId: created.criteriaDbId,
    criteriaDbUrl: created.criteriaDbUrl,
    provisionedAt: new Date().toISOString(),
  };

  fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2) + "\n", "utf-8");

  console.log("\n✅ Notion Control Plane created and populated!");
  console.log(`   🎛️ Control Plane Hub : ${created.controlPlanePageUrl}`);
  console.log(`   📄 Candidate CV DB   : ${created.cvDbUrl} (${created.seededCvCount} rows)`);
  console.log(`   ⚖️ Criteria DB       : ${created.criteriaDbUrl} (${created.seededCriteriaCount} rows)`);
  console.log(`   💾 Saved DB IDs to   : ${META_FILE}`);
}

async function runSync(): Promise<void> {
  const token = requireNotionToken();
  const saved = readSavedMeta();
  const cvDbId = (process.env["NOTION_CV_DB_ID"]?.trim() || saved.cvDbId || "").trim();
  const criteriaDbId = (
    process.env["NOTION_CRITERIA_DB_ID"]?.trim() ||
    saved.criteriaDbId ||
    ""
  ).trim();

  if (!cvDbId || !criteriaDbId) {
    console.error(
      "ERROR: NOTION_CV_DB_ID / NOTION_CRITERIA_DB_ID not found. Run `provision` first or set them in .env.",
    );
    process.exit(1);
  }

  console.log("[notion-cli] Fetching active CV & Criteria rows from Notion...");
  const data = await fetchNotionControlPlaneData({ token }, cvDbId, criteriaDbId);

  // Save profile Markdown to n8n/prompts/candidate_profile.md
  fs.writeFileSync(PROFILE_FILE, data.profileMarkdown, "utf-8");
  console.log(`[notion-cli] Saved candidate profile to ${PROFILE_FILE}`);

  // Save offline snapshot to n8n/prompts/.notion-snapshot.json
  const snapshot = {
    syncedAt: new Date().toISOString(),
    activeCvCount: data.cvEntries.filter((c) => c.active).length,
    activeCriteriaCount: data.criteriaEntries.filter((c) => c.active).length,
    scoringConfig: data.scoringConfig,
    cvEntries: data.cvEntries,
    criteriaEntries: data.criteriaEntries,
    rawCv: data.cvEntries,
    rawCriteria: data.criteriaEntries,
  };
  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2) + "\n", "utf-8");
  console.log(`[notion-cli] Saved snapshot to ${SNAPSHOT_FILE}`);

  console.log(data.profileMarkdown);
  console.log("=== DYNAMIC SCORING CONFIG ===");
  console.log(JSON.stringify(data.scoringConfig, null, 2));

}

function runPreview(): void {
  const markdown = compileCandidateProfileMarkdown(DEFAULT_CV_ENTRIES, DEFAULT_CRITERIA_ENTRIES);
  const scoringConfig = compileDynamicScoringConfig(DEFAULT_CRITERIA_ENTRIES);
  console.log("=== COMPILED CANDIDATE PROFILE MARKDOWN ===\n");
  console.log(markdown);
  console.log("=== COMPILED DYNAMIC SCORING CONFIG ===\n");
  console.log(JSON.stringify(scoringConfig, null, 2));
}

async function patchNotionPage(
  token: string,
  pageId: string,
  properties: Record<string, unknown>,
): Promise<void> {
  const cleanId = pageId.replace(/-/g, "").trim();
  const res = await fetch(`https://api.notion.com/v1/pages/${cleanId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ properties }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Notion PATCH /pages/${pageId} failed (${res.status}): ${errText.slice(0, 300)}`);
  }
}

function titleField(text: string) {
  return { title: [{ type: "text", text: { content: text } }] };
}
function richTextField(text: string) {
  return { rich_text: [{ type: "text", text: { content: text } }] };
}
function selectField(name: string) {
  return { select: { name } };
}
function multiSelectField(names: string[]) {
  return { multi_select: names.map((name) => ({ name })) };
}
function checkboxField(b: boolean) {
  return { checkbox: b };
}

async function runUpdateProfile(): Promise<void> {
  const token = requireNotionToken();
  console.log("[notion-cli] Updating Notion pages with FDE / Team Lead profile and strict non-JS hard reject...");

  // 1. Criteria: Non-JS Stack Required -> Force Reject (Score = 0)
  await patchNotionPage(token, "408747f7-ebec-81c3-8b31-c7b38b205c43", {
    "Rule Name": titleField("NO Non-JS Backend or Mandatory Non-JS (Java, Python, C#, Go, PHP, etc.)"),
    "Rule Type": selectField("Force Reject (Score = 0)"),
    "Category": selectField("Hard Reject (Red Flag)"),
    "Enforcement": selectField("Hard Gate (Code + Prompt)"),
    "Value / Keywords": richTextField("java, python, c#, .net, golang, go, php, ruby, c++, non-js backend, non-js required"),
    "Rule Description (For Prompt)": richTextField(
      "The candidate knows ONLY JavaScript, TypeScript, and Node.js. Absolutely does NOT know Java, Python, C#, Go, PHP, Ruby, etc. Strictly REJECT (score = 0, red_flag: Stack: Non-JS Required) any vacancy where the backend is implemented in Java, Python, C#, .NET, Go, PHP, Ruby, etc., or where a non-JS language is a mandatory requirement. Such vacancies must NEVER appear in Hot Match or Review. (Non-JS mentioned strictly as an optional nice-to-have or learnable plus where primary work is Node.js/TS is allowed, but must NOT require a non-JS backend)."
    ),
  });

  // 2. Criteria: Mixed Stack -> Deactivate
  await patchNotionPage(token, "408747f7-ebec-81f5-b675-f11e80141f84", {
    "Active": checkboxField(false),
  });

  // 3. CV: Target Role & Leadership
  await patchNotionPage(token, "408747f7-ebec-8185-b853-efeaa56cbee3", {
    "Title": titleField("Target Role & Leadership: Team Lead (Frontend / Full-Stack) / FDE"),
    "Highlight / Summary": richTextField(
      "Strong communication and team leadership skills; experienced Team Lead for Frontend and Full-Stack teams (up to 6 engineers), running PRD/ADR workflows, 1:1s, code reviews, and stakeholder alignment. Preferred hands-on coding ratio is 50% to 70% in established frameworks (NO greenfield DevOps / infra from scratch, and NO 100% pure people management without code)."
    ),
    "Tech Tags": multiSelectField(["Team Lead", "Forward Deployed", "Product Engineer", "Full-Stack"]),
  });

  // 4. CV: Recent Experience (Last 6m)
  await patchNotionPage(token, "408747f7-ebec-81bf-99fb-ebfc0a14488e", {
    "Title": titleField("FinTech Investment Platform / EPAM Systems — Forward Deployed Engineer & UI Stream Lead"),
    "Highlight / Summary": richTextField(
      "Operate as a Product / Forward Deployed Engineer on an AI-integrated investment platform (TypeScript, React, Node.js, AI tooling), owning ambiguous feature scopes end-to-end from customer discovery, PRD, and ADR to feature files, tests, ticket slicing, and production release. Stepped in to lead a 6-engineer technical stream following a customer design escalation; partnered with Chief Designer to architect and deliver a Shared UI Component Library, while leading backlog slicing and sprint demos."
    ),
    "Tech Tags": multiSelectField(["TypeScript", "React", "Node.js", "GenAI", "Forward Deployed", "Product Engineer", "Team Lead"]),
  });

  // 5. CV: Role & Summary
  await patchNotionPage(token, "408747f7-ebec-8161-bd9b-dd6e002c8e61", {
    "Title": titleField("Senior Forward Deployed & Full-Stack Engineer | Team Lead (Frontend & Full-Stack)"),
    "Highlight / Summary": richTextField(
      "Senior Forward Deployed & Full-Stack Engineer with 10 years of commercial experience in the JS/TS ecosystem (React, Next.js, Node.js, NestJS). Operates as a Product / Forward Deployed Engineer with spec-driven delivery (PRD, ADR, feature files, tests, ticket slicing, and implementation). Open to Forward Deployed, Product Engineer, and Team Lead (Frontend / Full-Stack) roles in the JS/TS ecosystem. Strictly works with JavaScript, TypeScript, and Node.js (no Java, Python, C#, or Go backend). Not seeking roles setting up infrastructure or DevOps from scratch."
    ),
    "Tech Tags": multiSelectField(["TypeScript", "React", "Node.js", "Next.js", "NestJS", "Forward Deployed", "Product Engineer", "Team Lead"]),
  });

  // 6. CV: Core Full-Stack Balance
  await patchNotionPage(token, "408747f7-ebec-8122-b28a-f30530f246f6", {
    "Title": titleField("Core Full-Stack Balance (FE / BE Ratio)"),
    "Highlight / Summary": richTextField(
      "Ideal role is Forward Deployed Engineer, Product Engineer, Team Lead (Frontend/Full-Stack), or Full-Stack (50/50 to 70/30 in favor of Frontend) in JS/TS ecosystem. Leverage elite Frontend & UI architecture expertise combined with Node.js/NestJS backend delivery. No non-JS backends (no Java, Python, C#, Go)."
    ),
    "Tech Tags": multiSelectField(["Forward Deployed", "Product Engineer", "Full-Stack", "Frontend", "Backend", "Node.js", "React"]),
  });

  // 7. CV: Primary Stack
  await patchNotionPage(token, "408747f7-ebec-8178-940b-ce246918ddca", {
    "Title": titleField("Primary Tech Stack"),
    "Highlight / Summary": richTextField(
      "JavaScript, TypeScript, React, Next.js, Node.js, NestJS, PostgreSQL, HTML5, CSS3, SCSS. Strictly JavaScript/TypeScript ecosystem only (no Python, Java, C#, Go, PHP)."
    ),
    "Tech Tags": multiSelectField(["JavaScript", "TypeScript", "React", "Next.js", "Node.js", "NestJS", "PostgreSQL"]),
  });

  console.log("✅ Notion pages updated successfully!");
  console.log("[notion-cli] Automatically triggering sync...");
  await runSync();
}

async function main(): Promise<void> {
  loadEnvFiles();
  const cmd = process.argv[2] ?? "preview";
  if (cmd === "provision") {
    await runProvision();
  } else if (cmd === "sync") {
    await runSync();
  } else if (cmd === "update-profile") {
    await runUpdateProfile();
  } else if (cmd === "preview") {
    runPreview();
  } else {
    console.error(`Unknown command: ${cmd}. Expected: provision | sync | update-profile | preview`);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[notion-cli] Fatal error:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
