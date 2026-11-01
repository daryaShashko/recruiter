#!/usr/bin/env ts-node
/**
 * CLI for the Notion Live Control Plane (Candidate CV & Matching Criteria).
 *
 * Commands:
 *   ts-node evaluator/notion-cli.ts provision   # Create both DBs in Notion & seed all current CV/Criteria rows
 *   ts-node evaluator/notion-cli.ts sync        # Pull active rows from Notion -> update n8n/prompts/candidate_profile.md
 *   ts-node evaluator/notion-cli.ts preview     # Compile & print current profile + dynamic scoring rules offline
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
const SNAPSHOT_FILE = path.join(PROMPTS_DIR, ".notion-snapshot.json");
const CANDIDATE_PROFILE_MD = path.join(PROMPTS_DIR, "candidate_profile.md");

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

  fs.writeFileSync(CANDIDATE_PROFILE_MD, data.profileMarkdown, "utf-8");
  fs.writeFileSync(
    SNAPSHOT_FILE,
    JSON.stringify(
      {
        syncedAt: new Date().toISOString(),
        activeCvCount: data.cvEntries.filter((x) => x.active).length,
        activeCriteriaCount: data.criteriaEntries.filter((x) => x.active).length,
        scoringConfig: data.scoringConfig,
        cvEntries: data.cvEntries,
        criteriaEntries: data.criteriaEntries,
      },
      null,
      2,
    ) + "\n",
    "utf-8",
  );

  console.log(`✅ Synced from Notion!`);
  console.log(`   📄 Active CV entries       : ${data.cvEntries.filter((x) => x.active).length}/${data.cvEntries.length}`);
  console.log(`   ⚖️ Active Criteria entries : ${data.criteriaEntries.filter((x) => x.active).length}/${data.criteriaEntries.length}`);
  console.log(`   📝 Updated profile         : ${CANDIDATE_PROFILE_MD}`);
  console.log(`   💾 Updated local snapshot  : ${SNAPSHOT_FILE}`);
}

function runPreview(): void {
  const markdown = compileCandidateProfileMarkdown(DEFAULT_CV_ENTRIES, DEFAULT_CRITERIA_ENTRIES);
  const scoringConfig = compileDynamicScoringConfig(DEFAULT_CRITERIA_ENTRIES);
  console.log("=== COMPILED CANDIDATE PROFILE MARKDOWN ===\n");
  console.log(markdown);
  console.log("=== COMPILED DYNAMIC SCORING CONFIG ===\n");
  console.log(JSON.stringify(scoringConfig, null, 2));
}

async function main(): Promise<void> {
  loadEnvFiles();
  const cmd = process.argv[2] ?? "preview";
  if (cmd === "provision") {
    await runProvision();
  } else if (cmd === "sync") {
    await runSync();
  } else if (cmd === "preview") {
    runPreview();
  } else {
    console.error(`Unknown command: ${cmd}. Expected: provision | sync | preview`);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[notion-cli] Fatal error:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
