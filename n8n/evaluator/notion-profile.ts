/**
 * Notion Live Control Plane for Candidate CV & Matching Criteria.
 *
 * Allows the candidate to store and edit their structured CV (projects, stack,
 * achievements, languages) and matching rules (salary floors, location rules,
 * hard-reject keywords, scoring guidelines, target domains) in two Notion
 * databases in real time.
 *
 * Features:
 * 1. Historic seed entries for initial Notion provisioning; production reads live rows.
 * 2. Compiler from Notion entries -> LLM profile text + `DynamicScoringConfig`.
 * 3. Dependency-free Notion REST API client (create databases, seed rows,
 *    query active rows, and cache with TTL).
 */

import * as fs from "fs";
import * as path from "path";

export type CvSection =
  | "Role & Summary"
  | "Recent Experience (Last 6m)"
  | "Primary Stack"
  | "Secondary Stack"
  | "AI & Tools"
  | "Languages"
  | "Target Role & Leadership"
  | "Key Achievement";

export interface CvEntry {
  readonly id: string;
  readonly title: string;
  readonly section: CvSection;
  readonly order: number;
  readonly highlight: string;
  readonly tags: readonly string[];
  readonly period: string;
  readonly active: boolean;
  readonly details?: string;
}

export type CriterionCategory =
  | "Salary & Contract"
  | "Location & Work Style"
  | "Hard Reject (Red Flag)"
  | "Scoring Guideline"
  | "Target Domain";

export type CriterionEnforcement =
  | "Hard Gate (Code + Prompt)"
  | "Prompt Rule (LLM Only)";

export type CriterionRuleType =
  | "Force Reject (Score = 0)"
  | "Discard (Score < 50)"
  | "Review Cap (Score 50-79)"
  | "Hot Match Boost (Score >= 80)"
  | "Target / Preference";

export interface CriterionEntry {
  readonly id: string;
  readonly ruleName: string;
  readonly category: CriterionCategory;
  readonly enforcement: CriterionEnforcement;
  readonly ruleType: CriterionRuleType;
  readonly valueOrKeywords: string;
  readonly description: string;
  readonly order: number;
  readonly active: boolean;
}

export interface DynamicScoringConfig {
  readonly cryptoKeywords: readonly string[];
  readonly gamblingKeywords: readonly string[];
  readonly outsourcingKeywords: readonly string[];
  readonly tricityKeywords: readonly string[];
  readonly minB2bPlnFloor?: number;
}

// ─── Historical Provisioning Seed Data ──────────────────────────────────────

export const DEFAULT_CV_ENTRIES: readonly CvEntry[] = [
  {
    id: "cv-role-summary",
    title: "Senior Full-Stack & Product Engineer | Tech Stream Lead",
    section: "Role & Summary",
    order: 1,
    highlight:
      "Senior Full-Stack & Product Engineer with 10 years of commercial experience in the JS/TS ecosystem, combining deep React/Next.js frontend expertise with scalable Node.js/NestJS and Python backend delivery. Proven track record of leading technical streams (up to 6 engineers), driving Frontend-to-Full-Stack team transitions, and executing complex legacy migrations (Java/MySQL to Node.js/PostgreSQL). Experienced in AI-native product engineering, multi-agent development workflows, and resolving critical stakeholder escalations through structured architecture and shared UI systems.",
    tags: ["TypeScript", "React", "Node.js", "Next.js", "NestJS", "Python", "Architecture"],
    period: "Core Profile",
    active: true,
    details:
      "Core positioning: Senior/Lead Product & Full-Stack engineer combining strong Frontend architecture with production Node.js/NestJS/Python backend delivery and AI-assisted engineering.",
  },
  {
    id: "cv-recent-6m",
    title: "FinTech Investment Platform / EPAM Systems — Senior Product Engineer & UI Stream Lead",
    section: "Recent Experience (Last 6m)",
    order: 2,
    highlight:
      "Operate as a Product / Forward-Deployed Engineer on an AI-integrated investment platform (TypeScript, React, Python, AI stack), owning ambiguous feature scopes end-to-end from direct customer discovery to production release. Stepped in to lead a 6-engineer technical stream following a critical customer design-alignment escalation; partnered with the Chief Designer to architect and deliver a Shared UI Component Library that unblocked parallel feature teams, while leading backlog slicing, refinement, and sprint demos.",
    tags: ["TypeScript", "React", "Python", "Node.js", "GenAI", "Team Lead", "Architecture"],
    period: "July 2026 – Present",
    active: true,
    details:
      "Current commercial project: AI-integrated FinTech investment platform, leading 6-engineer UI platform & quality stream.",
  },
  {
    id: "cv-primary-stack",
    title: "Primary Tech Stack",
    section: "Primary Stack",
    order: 3,
    highlight:
      "JavaScript, TypeScript, React, Next.js, Node.js, NestJS, PostgreSQL, Python (working knowledge), HTML5, CSS3, SCSS.",
    tags: ["JavaScript", "TypeScript", "React", "Next.js", "Node.js", "NestJS", "PostgreSQL", "Python"],
    period: "Daily Production",
    active: true,
  },
  {
    id: "cv-secondary-stack",
    title: "Secondary Stack & Cloud Familiarity",
    section: "Secondary Stack",
    order: 4,
    highlight:
      "Docker, REST APIs, Microfrontends, AWS, Azure DevOps, CI/CD (GitHub Actions, Jenkins, Bamboo), Firebase, Redis, MongoDB, MySQL, Redux.",
    tags: ["Docker", "REST API", "AWS", "Azure DevOps", "CI/CD", "Redis", "MongoDB", "MySQL"],
    period: "Working Knowledge",
    active: true,
  },
  {
    id: "cv-ai-tools",
    title: "Independent AI R&D — Autonomous Job Market Intelligence & LLM Evaluation Platform",
    section: "AI & Tools",
    order: 5,
    highlight:
      "Architected an end-to-end TypeScript and Node.js data ingestion and LLM evaluation pipeline using Playwright, Notion REST API, n8n, and Promptfoo over a curated Golden Dataset, governed by a spec-driven multi-agent development workflow (Claude Code, Cursor, GitHub Copilot) with deterministic pre-ranking guardrails.",
    tags: ["TypeScript", "Node.js", "Playwright", "Promptfoo", "LLM Evaluation", "GenAI", "Cursor", "GitHub Copilot", "n8n"],
    period: "2026",
    active: true,
  },
  {
    id: "cv-languages",
    title: "Spoken Languages (EN / RU / PL)",
    section: "Languages",
    order: 6,
    highlight:
      "English: Professional (fluent reading/writing, professional speaking). Russian: Native. Polish: Intermediate (job postings in Polish are acceptable, but fluent spoken Polish must NOT be a hard requirement).",
    tags: ["English B2/C1", "Russian Native", "Polish B1"],
    period: "Current",
    active: true,
  },
  {
    id: "cv-target-balance",
    title: "Core Full-Stack Balance (FE / BE Ratio)",
    section: "Target Role & Leadership",
    order: 7,
    highlight:
      "Ideal role is Full-Stack (50/50 to 70/30 in favor of Frontend), Product Engineer, or Node.js/TS Backend-heavy where Senior JS/TS skills apply. Leverage elite Frontend & UI architecture expertise while actively contributing to Node.js/NestJS/Python backend & AI engineering.",
    tags: ["Full-Stack", "Frontend", "Backend", "Node.js", "React"],
    period: "Target Role",
    active: true,
  },
  {
    id: "cv-leadership",
    title: "Leadership, Management & Hands-On Ratio (Tech Lead / Team Lead)",
    section: "Target Role & Leadership",
    order: 8,
    highlight:
      "Strong communication and stakeholder management skills; actively leads technical streams (up to 6 engineers), customer demos, and escalations (Tech Lead / Team Lead / Product Engineer roles). Preferred hands-on coding ratio is 50% to 70% (NO 100% people management without coding, and NO zero-impact pure coder role).",
    tags: ["Tech Lead", "Team Lead", "Architecture", "Mentoring"],
    period: "Target Role",
    active: true,
  },
  {
    id: "cv-ach-migration",
    title: "J&J / EPAM Systems — Key Full-Stack Engineer",
    section: "Key Achievement",
    order: 9,
    highlight:
      "Transitioned to a Full-Stack role and led the high-impact migration of core platform functionality from a legacy Java backend to Node.js alongside a database migration from MySQL to PostgreSQL, preceded by deep legacy codebase investigation and architectural refactoring. Designed and drove the team-wide workflow for transitioning Frontend engineers into Full-Stack development.",
    tags: ["TypeScript", "Node.js", "React", "PostgreSQL", "MySQL", "Java Migration", "Backend", "Architecture"],
    period: "September 2022 – July 2026",
    active: true,
  },
  {
    id: "cv-ach-cost",
    title: "J&J / EPAM Systems — Key Full-Stack Engineer",
    section: "Key Achievement",
    order: 10,
    highlight:
      "Acted as the primary Knowledge Keeper and technical consultant for the platform's charting and analytics service, driving sprint scoping, backlog refinement, and multi-stage technical estimations (50% / 80% / 100% confidence gates). Introduced Clean Code documentation and integrated custom AI agents trained on project standards to assist the engineering team.",
    tags: ["TypeScript", "React", "Node.js", "Architecture", "GenAI", "Mentoring", "GitHub Copilot"],
    period: "September 2022 – July 2026",
    active: true,
  },
  {
    id: "cv-ach-lead",
    title: "Wolters Kluwer / EPAM Systems — Senior Frontend Engineer",
    section: "Key Achievement",
    order: 11,
    highlight:
      "Engineered scalable product features using React and Redux within a complex enterprise microfrontend architecture, proposed and integrated a standardized Prettier/ESLint configuration adopted company-wide, mentored junior developers, and resolved technical debt across legacy AngularJS/React modules with WCAG a11y compliance.",
    tags: ["React", "TypeScript", "JavaScript", "Frontend", "Architecture", "Mentoring"],
    period: "October 2021 – September 2022",
    active: true,
  },
  {
    id: "cv-ach-mobile",
    title: "MIS-Clinic / EPAM Systems — Frontend Team Lead & Resource Manager",
    section: "Key Achievement",
    order: 12,
    highlight:
      "Managed a team of 4 frontend developers (conducting performance reviews, technical interviews, onboarding, and guiding Middle-to-Senior transitions), designed greenfield project architecture from scratch, configured CI/CD pipelines in Jenkins with Firebase widget deployment, and previously delivered Belarus's first React Native mobile medical app (Aibolit, 2018–2019) and custom component libraries (SAP, 2016–2018).",
    tags: ["Team Lead", "Architecture", "React", "React Native", "CI/CD", "Firebase", "HealthTech", "Mentoring"],
    period: "February 2019 – October 2021",
    active: true,
  },
];

export const DEFAULT_CRITERIA_ENTRIES: readonly CriterionEntry[] = [
  // ── 1. Salary & Contract ──────────────────────────────────────────────────
  {
    id: "crit-salary-target",
    ruleName: "Target Compensation (~20k PLN Net / 25-30k B2B — Any Currency OK)",
    category: "Salary & Contract",
    enforcement: "Prompt Rule (LLM Only)",
    ruleType: "Hot Match Boost (Score >= 80)",
    valueOrKeywords:
      "25000-30000 PLN B2B | 5800-7000 EUR B2B | 6300-7600 USD B2B | 32000 PLN UoP Gross | ~20000 PLN Net | Any currency OK",
    description:
      "Desired Target Compensation: ~20,000 PLN/month NET take-home pay (B2B: 25,000–30,000 PLN/month net+VAT; UoP: ~32,000 PLN/month GROSS). ANY CURRENCY IS ACCEPTED (PLN, EUR, USD, GBP, CHF, etc.) — convert foreign currencies to PLN equivalents, never 1:1 (~4.25 PLN/EUR, ~3.95 PLN/USD, ~5.0 PLN/GBP, ~4.55 PLN/CHF, ~0.38 PLN/SEK, ~0.37 PLN/NOK, ~0.57 PLN/DKK, ~2.95 PLN/SGD, ~1.08 PLN/AED, ~0.026 PLN/JPY; e.g. ~5,800–7,000 EUR or ~6,300–7,600 USD B2B/month). B2B preferred; candidate has full legal access in Poland (no visa needed, ready for JDG).",
    order: 1,
    active: true,
  },
  {
    id: "crit-salary-floor",
    ruleName: "Hard Salary Floor (Min 18k PLN Net / ~22k B2B — Any Currency Converted to PLN)",
    category: "Salary & Contract",
    enforcement: "Hard Gate (Code + Prompt)",
    ruleType: "Force Reject (Score = 0)",
    valueOrKeywords: "22000",
    description:
      "Hard Floor (Strict Minimum for disclosed non-zero salaries): 18,000 PLN/month NET on hands (equivalent to ~22,000 PLN B2B net before taxes, ~5,200 EUR B2B, ~5,600 USD B2B, ~4,400 GBP B2B, or ~28,000 PLN UoP Gross). Any currency is accepted — always convert foreign currencies (EUR, USD, GBP, CHF, SEK, NOK, DKK, SGD, AED, JPY, etc.) and hourly/daily/annual rates to monthly PLN before checking the floor — never compare a foreign amount 1:1 with PLN. Only reject (score = 0, red_flag: Low salary / below hard floor) when an explicitly disclosed non-zero salary converts to strictly below this floor.",
    order: 2,
    active: true,
  },
  {
    id: "crit-salary-undisclosed",
    ruleName: "Undisclosed or Zero Salary -> Keep & Flag as Red Flag (Do NOT Reject)",
    category: "Salary & Contract",
    enforcement: "Hard Gate (Code + Prompt)",
    ruleType: "Review Cap (Score 50-79)",
    valueOrKeywords: "undisclosed, 0, no salary, n/a, competitive -> red_flag: Salary not disclosed",
    description:
      "Missing, Undisclosed, or Zero Salary ('0', 'Undisclosed', 'N/A', 'No salary', 'Competitive', or empty): Do NOT reject the vacancy and do NOT set overall_score to 0! Keep the vacancy, evaluate it normally on tech stack, seniority, domain, and location (score 50–85+ if the role is interesting), and add 'Salary not disclosed' to red_flags so the candidate knows the role is interesting but salary was not listed.",
    order: 3,
    active: true,
  },

  // ── 2. Location & Work Style ──────────────────────────────────────────────
  {
    id: "crit-location-allowed",
    ruleName: "Allowed Locations: Fully Remote (Any Country) or Tricity (Gdańsk/Gdynia/Sopot)",
    category: "Location & Work Style",
    enforcement: "Hard Gate (Code + Prompt)",
    ruleType: "Target / Preference",
    valueOrKeywords: "gdansk, gdańsk, gdynia, sopot, trojmiasto, trójmiasto, remote, zdalnie, zdalna",
    description:
      "Geographic Preferences: Fully remote in ANY country (Poland, EU, UK, Scandinavia, Switzerland, USA, Asia, etc.; Polish/EU passport, ready for Polish B2B/JDG) OR Hybrid/office in Tricity (Gdańsk / Gdynia / Sopot). No location penalty for these. Exclude explicitly Russia-/Ukraine-/active-conflict-based roles; mainland China-based roles are a culture-risk red flag, not an automatic rejection. Remote roles explicitly requiring residence in the US or Canada get 'Remote region restricted' and a 10-point penalty; US/Canada remote labels alone do not imply residence requirements.",
    order: 3,
    active: true,
  },
  {
    id: "crit-location-reject",
    ruleName: "Relocation Required: On-site/Hybrid outside Tricity -> Flag & ~10 Points Lower (NOT a Reject)",
    category: "Location & Work Style",
    enforcement: "Hard Gate (Code + Prompt)",
    ruleType: "Target / Preference",
    valueOrKeywords: "warsaw, warszawa, kraków, krakow, wrocław, wroclaw, katowice, poznań",
    description:
      "Hybrid or on-site positions outside the Tricity (other Polish cities or abroad, e.g. Warsaw, Copenhagen, Zurich, London) are NOT rejected: add 'Relocation required' to red_flags and subtract 10 points from the score. Remote work that explicitly requires residence in the US or Canada (e.g. 'US only' or 'must reside in Canada') is treated the same way ('Remote region restricted'); an employer's hiring-market label alone does not prove a residence restriction.",
    order: 4,
    active: true,
  },

  // ── 3. Hard Rejections (Red Flags) ────────────────────────────────────────
  {
    id: "crit-reject-crypto",
    ruleName: "NO Crypto / Web3 / Blockchain",
    category: "Hard Reject (Red Flag)",
    enforcement: "Hard Gate (Code + Prompt)",
    ruleType: "Force Reject (Score = 0)",
    valueOrKeywords:
      "crypto, web3, blockchain, solana, bitcoin, ethereum, nft, defi, smart contract",
    description:
      "Absolutely do NOT consider any work, projects, or positions in cryptocurrency, blockchain, NFT, DeFi, smart contracts, or Web3. Immediate score = 0.",
    order: 5,
    active: true,
  },
  {
    id: "crit-reject-gambling",
    ruleName: "NO Gambling / Betting / Casino",
    category: "Hard Reject (Red Flag)",
    enforcement: "Hard Gate (Code + Prompt)",
    ruleType: "Force Reject (Score = 0)",
    valueOrKeywords: "gambling, betting, casino, sportsbook, sports-betting",
    description:
      "Discard any roles in betting, casino, iGaming, or gambling platforms. Immediate score = 0.",
    order: 6,
    active: true,
  },
  {
    id: "crit-reject-outsourcing",
    ruleName: "NO Agency / Outsourcing / Outstaffing (Product Companies Only)",
    category: "Hard Reject (Red Flag)",
    enforcement: "Hard Gate (Code + Prompt)",
    ruleType: "Force Reject (Score = 0)",
    valueOrKeywords:
      "epam, luxoft, capgemini, accenture, sii, infosys, cognizant, wipro, tcs, tata consultancy, outstaffing, outsourcing agency, outsourcing company",
    description:
      "Reject roles from outsourcing/outstaffing companies and body-leasing vendors. Candidate wants a Product company (startup <50 or scale-up 50-300). Only flag as outsourcing if there is explicit evidence.",
    order: 7,
    active: true,
  },
  {
    id: "crit-reject-legacy",
    ruleName: "NO Non-JS Language as Must-Have (Java, C#, PHP, Python, Go, Ruby...; Nice-to-Have Is OK)",
    category: "Hard Reject (Red Flag)",
    enforcement: "Prompt Rule (LLM Only)",
    ruleType: "Force Reject (Score = 0)",
    valueOrKeywords: "php, java, c#, .net, ruby, c++, legacy maintenance",
    description:
      "Reject roles where a non-JavaScript language (Java, C#, .NET, PHP, Python, Go, Ruby, C++, Kotlin, etc.) is a must-have or the primary day-to-day language, or that maintain a legacy non-JS codebase without a rewrite/migration to Node.js/TypeScript (red_flag: Non-JS required). Do NOT reject when the non-JS language is only nice-to-have, a plus, or learnable on the job — the candidate is happy to pick it up with AI-assisted development (red_flag: Non-JS nice-to-have). JavaScript/TypeScript is NOT Java.",
    order: 8,
    active: true,
  },
  {
    id: "crit-reject-pure-ui",
    ruleName: "NO Pure Pixel-Pushing HTML/CSS Frontend",
    category: "Hard Reject (Red Flag)",
    enforcement: "Prompt Rule (LLM Only)",
    ruleType: "Discard (Score < 50)",
    valueOrKeywords: "pure html/css, pixel-pushing, no state management, no api integration",
    description:
      "Reject positions that explicitly forbid backend access or involve only pixel-pushing (HTML/CSS/pure styling) without system logic, state management, or API design. (React roles with state/API logic are NOT pixel-pushing).",
    order: 9,
    active: true,
  },
  {
    id: "crit-reject-junior-mid",
    ruleName: "NO Junior / Mid / Regular / Intern Roles",
    category: "Hard Reject (Red Flag)",
    enforcement: "Prompt Rule (LLM Only)",
    ruleType: "Discard (Score < 50)",
    valueOrKeywords: "junior, mid, regular, intern, trainee",
    description:
      "Position is explicitly Junior or Mid-level (< 3 years experience or low seniority). Strictly score < 50.",
    order: 10,
    active: true,
  },

  // ── 4. Scoring Guidelines & Nuances ───────────────────────────────────────
  {
    id: "crit-score-nodejs-only",
    ruleName: "Node.js / TypeScript Backend-Only Role -> Review (Score 60-75)",
    category: "Scoring Guideline",
    enforcement: "Prompt Rule (LLM Only)",
    ruleType: "Review Cap (Score 50-79)",
    valueOrKeywords: "Node.js backend-only, score 60-75",
    description:
      "Node.js/TypeScript backend-only role (no frontend scope mentioned): Score 60–75 (Review). Node.js IS the candidate's target stack — the only penalty is the absence of frontend work. Do NOT reject these roles below 50.",
    order: 11,
    active: true,
  },
  {
    id: "crit-score-mixed-migration",
    ruleName: "Mixed Stack with Node.js PRIMARY (e.g. 80% Node, 20% Java Migration) -> Hot Match (>=80)",
    category: "Scoring Guideline",
    enforcement: "Prompt Rule (LLM Only)",
    ruleType: "Hot Match Boost (Score >= 80)",
    valueOrKeywords: "Node.js primary, legacy migration",
    description:
      "If Node.js/TypeScript is explicitly stated as the primary technology (e.g. 80% Node.js, 20% legacy Java maintenance during migration), treat it as a Node.js role and score >= 80 if all other criteria match.",
    order: 12,
    active: true,
  },

  // ── 5. Target Domains & Industries ────────────────────────────────────────
  {
    id: "crit-domains-preferred",
    ruleName: "Preferred Product Domains (AI/ML, HealthTech, FinTech, B2B SaaS, E-com, GovTech, SportsTech)",
    category: "Target Domain",
    enforcement: "Prompt Rule (LLM Only)",
    ruleType: "Target / Preference",
    valueOrKeywords:
      "AI / ML Products, HealthTech / MedTech, FinTech, Enterprise B2B SaaS, E-commerce, GovTech, SportsTech, Product Startups",
    description:
      "Preferred / Acceptable domains: AI / ML Products, HealthTech / MedTech / NeuroMed / Psychoanalysis (direct experience), FinTech / Finance, Enterprise / B2B SaaS, E-commerce / Retail, GovTech, SportsTech, Product Startups (<50 or 50–300 scale-up).",
    order: 13,
    active: true,
  },
];

// ─── Compilers (Structured Entries -> Markdown & DynamicScoringConfig) ───────

function parseKeywordList(raw: string): string[] {
  return raw
    .split(/[,;\n|]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

/**
 * Compile active Matching Criteria rows into a deterministic scoring config
 * for `evaluateJob()` in `scoring.ts`.
 */
export function compileDynamicScoringConfig(
  criteria: readonly CriterionEntry[],
): DynamicScoringConfig {
  const activeGates = criteria.filter(
    (c) => c.active && c.enforcement === "Hard Gate (Code + Prompt)",
  );

  const findKeywords = (idHint: string, nameHint: string, fallback: readonly string[]): string[] => {
    const match = activeGates.find(
      (c) =>
        c.id === idHint ||
        c.ruleName.toLowerCase().includes(nameHint.toLowerCase()),
    );
    if (!match) return [...fallback];
    const parsed = parseKeywordList(match.valueOrKeywords);
    return parsed.length > 0 ? parsed : [...fallback];
  };

  const salaryGate = activeGates.find(
    (c) =>
      c.id === "crit-salary-floor" ||
      c.ruleName.toLowerCase().includes("salary floor"),
  );
  let minB2bPlnFloor: number | undefined;
  if (salaryGate) {
    const numMatch = salaryGate.valueOrKeywords.replace(/\s+/g, "").match(/\d{4,6}/);
    if (numMatch) {
      minB2bPlnFloor = Number(numMatch[0]);
    }
  }

  return {
    cryptoKeywords: findKeywords("crit-reject-crypto", "crypto", [
      "crypto",
      "web3",
      "blockchain",
      "solana",
      "bitcoin",
      "ethereum",
      "nft",
      "defi",
      "smart contract",
    ]),
    gamblingKeywords: findKeywords("crit-reject-gambling", "gambling", [
      "gambling",
      "betting",
      "casino",
      "sportsbook",
      "sports-betting",
    ]),
    outsourcingKeywords: findKeywords("crit-reject-outsourcing", "outsourcing", [
      "epam",
      "luxoft",
      "capgemini",
      "accenture",
      "sii",
      "infosys",
      "cognizant",
      "wipro",
      "tcs",
      "tata consultancy",
      "outstaffing",
      "outsourcing agency",
      "outsourcing company",
    ]),
    tricityKeywords: [
      "gdansk",
      "gdańsk",
      "gdynia",
      "sopot",
      "trojmiasto",
      "trójmiasto",
    ],
    minB2bPlnFloor,
  };
}

/**
 * Compile active Notion CV and Matching Criteria entries into LLM profile text.
 */
export function compileCandidateProfileMarkdown(
  cvEntries: readonly CvEntry[],
  criteriaEntries: readonly CriterionEntry[],
): string {
  const activeCv = [...cvEntries]
    .filter((e) => e.active)
    .sort((a, b) => a.order - b.order);
  const activeCriteria = [...criteriaEntries]
    .filter((c) => c.active)
    .sort((a, b) => a.order - b.order);

  const bySection = (sec: CvSection) => activeCv.filter((e) => e.section === sec);
  const byCat = (cat: CriterionCategory) =>
    activeCriteria.filter((c) => c.category === cat);

  const lines: string[] = [
    "# Candidate Profile & Preferences",
    "",
    "This profile is dynamically compiled from the Notion Control Plane (Candidate CV & Matching Criteria databases). The AI recruiter assistant must evaluate all job postings against these criteria.",
    "",
    "---",
    "",
    "## 1. Professional Background & Stack",
    "",
  ];

  for (const item of bySection("Role & Summary")) {
    lines.push(`- **Role / Seniority**: ${item.highlight}`);
  }
  for (const item of bySection("Recent Experience (Last 6m)")) {
    lines.push(`- **Recent Experience (${item.period}) — ${item.title}**: ${item.highlight}`);
  }
  for (const item of bySection("Primary Stack")) {
    lines.push(`- **Primary Tech Stack**: ${item.highlight}`);
  }
  for (const item of bySection("Secondary Stack")) {
    lines.push(`- **Secondary Stack / Familiarity**: ${item.highlight}`);
  }
  for (const item of bySection("AI & Tools")) {
    lines.push(`- **AI & Tools**: ${item.highlight}`);
  }
  for (const item of bySection("Languages")) {
    lines.push(`- **Languages**: ${item.highlight}`);
  }

  lines.push("", "---", "", "## 2. Target Role & Leadership Ambitions", "");
  for (const item of bySection("Target Role & Leadership")) {
    lines.push(`- **${item.title}**: ${item.highlight}`);
  }

  lines.push(
    "",
    "---",
    "",
    "## 3. Employment & Salary Expectations",
    "",
    "*Note: To avoid tax confusion, the AI assistant must calculate net/gross equivalents strictly based on Polish tax regulations.*",
    "",
  );
  for (const rule of byCat("Salary & Contract")) {
    lines.push(`- **${rule.ruleName}**: ${rule.description}`);
  }

  lines.push("", "---", "", "## 4. Location & Work Style", "");
  for (const rule of byCat("Location & Work Style")) {
    lines.push(`- **${rule.ruleName}**: ${rule.description}`);
  }

  lines.push(
    "",
    "---",
    "",
    "## 5. Hard Restrictions & Red Flags (Immediate Rejection Criteria)",
    "",
    "The AI recruiter assistant must automatically discard a vacancy if it meets any of the following:",
    "",
  );
  for (const rule of byCat("Hard Reject (Red Flag)")) {
    lines.push(`- **${rule.ruleName}** [${rule.ruleType}]: ${rule.description}`);
  }

  const guidelines = byCat("Scoring Guideline");
  if (guidelines.length > 0) {
    lines.push("", "### Scoring Nuances & Guidelines", "");
    for (const rule of guidelines) {
      lines.push(`- **${rule.ruleName}**: ${rule.description}`);
    }
  }

  lines.push("", "---", "", "## 6. Target Domains & Industries", "");
  for (const rule of byCat("Target Domain")) {
    lines.push(`- **${rule.ruleName}**: ${rule.description}`);
  }

  lines.push("", "---", "", "## 7. Key Achievements (For Context & Matching)", "");
  for (const item of bySection("Key Achievement")) {
    lines.push(`- **${item.title}**: ${item.highlight}`);
  }

  return lines.join("\n") + "\n";
}

// ─── Notion REST API Client (Dependency-Free) ────────────────────────────────

const NOTION_API_BASE = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

export interface NotionClientOptions {
  readonly token: string;
  readonly fetchImpl?: typeof fetch;
}

async function notionRequest<T>(
  opts: NotionClientOptions,
  method: "GET" | "POST" | "PATCH",
  path: string,
  body?: unknown,
): Promise<T> {
  const fetchFn = opts.fetchImpl ?? fetch;
  const response = await fetchFn(`${NOTION_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${opts.token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`Notion API ${method} ${path} failed (${response.status}): ${errText.slice(0, 300)}`);
  }

  return (await response.json()) as T;
}

// Helpers to build Notion property values
function titleProp(text: string) {
  return { title: [{ type: "text", text: { content: text } }] };
}
function richTextProp(text: string) {
  return { rich_text: [{ type: "text", text: { content: text.slice(0, 1990) } }] };
}
function selectProp(name: string) {
  return { select: { name } };
}
function multiSelectProp(names: readonly string[]) {
  return { multi_select: names.map((name) => ({ name: name.replace(/,/g, "") })) };
}
function numberProp(n: number) {
  return { number: n };
}
function checkboxProp(b: boolean) {
  return { checkbox: b };
}

// Helpers to read Notion property values
function readTitle(prop: unknown): string {
  const arr = (prop as { title?: Array<{ plain_text?: string }> } | undefined)?.title;
  return Array.isArray(arr) ? arr.map((t) => t.plain_text ?? "").join("") : "";
}
function readRichText(prop: unknown): string {
  const arr = (prop as { rich_text?: Array<{ plain_text?: string }> } | undefined)?.rich_text;
  return Array.isArray(arr) ? arr.map((t) => t.plain_text ?? "").join("") : "";
}
function readSelect(prop: unknown, fallback: string): string {
  return (prop as { select?: { name?: string } } | undefined)?.select?.name ?? fallback;
}
function readMultiSelect(prop: unknown): string[] {
  const arr = (prop as { multi_select?: Array<{ name?: string }> } | undefined)?.multi_select;
  return Array.isArray(arr) ? arr.map((x) => x.name ?? "").filter(Boolean) : [];
}
function readNumber(prop: unknown, fallback: number): number {
  const n = (prop as { number?: number | null } | undefined)?.number;
  return typeof n === "number" ? n : fallback;
}
function readCheckbox(prop: unknown, fallback: boolean): boolean {
  const b = (prop as { checkbox?: boolean } | undefined)?.checkbox;
  return typeof b === "boolean" ? b : fallback;
}

export interface CreatedControlPlane {
  readonly controlPlanePageId: string;
  readonly controlPlanePageUrl: string;
  readonly cvDbId: string;
  readonly cvDbUrl: string;
  readonly criteriaDbId: string;
  readonly criteriaDbUrl: string;
  readonly seededCvCount: number;
  readonly seededCriteriaCount: number;
}

/**
 * Discover a suitable workspace parent page from an existing Notion Database ID
 * (such as `NOTION_DB_ID` or `NOTION_EVAL_LOG_DB_ID`).
 */
export async function resolveParentPageIdFromDatabase(
  opts: NotionClientOptions,
  existingDbId: string,
): Promise<string> {
  interface NotionDbInfo {
    parent?: {
      type?: string;
      page_id?: string;
      block_id?: string;
    };
  }
  const cleanDbId = existingDbId.replace(/-/g, "").trim();
  if (cleanDbId) {
    try {
      const dbInfo = await notionRequest<NotionDbInfo>(
        opts,
        "GET",
        `/databases/${cleanDbId}`,
      );
      if (dbInfo.parent?.type === "page_id" && dbInfo.parent.page_id) {
        return dbInfo.parent.page_id;
      }
      if (dbInfo.parent?.type === "block_id" && dbInfo.parent.block_id) {
        return dbInfo.parent.block_id;
      }
    } catch {
      // Fall through to workspace search if database lookup fails
    }
  }
  // Fallback: search ONLY for a non-database-row page (never attach to a job row inside a DB!)
  interface SearchResp {
    results?: Array<{
      id: string;
      object: string;
      parent?: { type?: string; page_id?: string; workspace?: boolean };
    }>;
  }
  const search = await notionRequest<SearchResp>(opts, "POST", "/search", {
    filter: { value: "page", property: "object" },
    page_size: 50,
  });
  const topLevelPage = (search.results ?? []).find(
    (r) =>
      r.object === "page" &&
      r.parent?.type !== "database_id",
  );
  if (!topLevelPage) {
    throw new Error(
      "No top-level Notion page is shared with this integration yet (only databases were found). " +
        "In Notion, create a new top-level page (e.g. 'AI Recruiter Control Plane'), click '...' -> 'Connections' -> add your integration, and re-run `npm run notion:provision`.",
    );
  }
  return topLevelPage.id;
}

/**
 * Provision the Notion Control Plane page + both structured databases (`Candidate CV & Experience`
 * and `Matching Criteria & Guardrails`) and populate them with all seed entries.
 */
export async function provisionAndSeedNotionControlPlane(
  opts: NotionClientOptions,
  parentPageId: string,
  cvEntries: readonly CvEntry[] = DEFAULT_CV_ENTRIES,
  criteriaEntries: readonly CriterionEntry[] = DEFAULT_CRITERIA_ENTRIES,
): Promise<CreatedControlPlane> {
  interface NotionEntityResp {
    id: string;
    url?: string;
  }

  // 1. Add a clean callout header directly to the parent page (no extra nested subpage)
  await notionRequest<NotionEntityResp>(
    opts,
    "PATCH",
    `/blocks/${parentPageId.replace(/-/g, "")}/children`,
    {
      children: [
        {
          object: "block",
          type: "callout",
          callout: {
            icon: { type: "emoji", emoji: "💡" },
            rich_text: [
              {
                type: "text",
                text: {
                  content:
                    "Live Source of Truth для AI Recruiter. Редактируй свой опыт (CV), стек, зарплатные ожидания и стоп-факторы прямо в этих двух таблицах. Только строки с галочкой Active = ✅ попадают в промпт и правила оценки!",
                },
              },
            ],
          },
        },
      ],
    },
  );

  // 2. Create Database 1: Candidate CV & Experience (inline so it's directly visible on the page)
  const cvDb = await notionRequest<NotionEntityResp>(opts, "POST", "/databases", {
    parent: { type: "page_id", page_id: parentPageId },
    is_inline: true,
    icon: { type: "emoji", emoji: "📄" },
    title: [{ type: "text", text: { content: "Candidate CV & Experience" } }],
    properties: {
      Title: { title: {} },
      Section: {
        select: {
          options: [
            { name: "Role & Summary", color: "blue" },
            { name: "Recent Experience (Last 6m)", color: "purple" },
            { name: "Primary Stack", color: "green" },
            { name: "Secondary Stack", color: "gray" },
            { name: "AI & Tools", color: "pink" },
            { name: "Languages", color: "yellow" },
            { name: "Target Role & Leadership", color: "orange" },
            { name: "Key Achievement", color: "red" },
          ],
        },
      },
      "Highlight / Summary": { rich_text: {} },
      "Tech Tags": { multi_select: {} },
      Period: { rich_text: {} },
      Order: { number: { format: "number" } },
      Active: { checkbox: {} },
    },
  });

  // 3. Create Database 2: Matching Criteria & Guardrails (inline so it's directly visible on the page)
  const criteriaDb = await notionRequest<NotionEntityResp>(opts, "POST", "/databases", {
    parent: { type: "page_id", page_id: parentPageId },
    is_inline: true,
    icon: { type: "emoji", emoji: "⚖️" },
    title: [{ type: "text", text: { content: "Matching Criteria & Guardrails" } }],
    properties: {
      "Rule Name": { title: {} },
      Category: {
        select: {
          options: [
            { name: "Salary & Contract", color: "green" },
            { name: "Location & Work Style", color: "blue" },
            { name: "Hard Reject (Red Flag)", color: "red" },
            { name: "Scoring Guideline", color: "purple" },
            { name: "Target Domain", color: "orange" },
          ],
        },
      },
      Enforcement: {
        select: {
          options: [
            { name: "Hard Gate (Code + Prompt)", color: "red" },
            { name: "Prompt Rule (LLM Only)", color: "blue" },
          ],
        },
      },
      "Rule Type": {
        select: {
          options: [
            { name: "Force Reject (Score = 0)", color: "red" },
            { name: "Discard (Score < 50)", color: "orange" },
            { name: "Review Cap (Score 50-79)", color: "yellow" },
            { name: "Hot Match Boost (Score >= 80)", color: "green" },
            { name: "Target / Preference", color: "blue" },
          ],
        },
      },
      "Value / Keywords": { rich_text: {} },
      "Rule Description (For Prompt)": { rich_text: {} },
      Order: { number: { format: "number" } },
      Active: { checkbox: {} },
    },
  });

  // 4. Seed CV rows (sorted by order)
  let seededCvCount = 0;
  for (const item of [...cvEntries].sort((a, b) => a.order - b.order)) {
    const children = item.details
      ? [
          {
            object: "block",
            type: "paragraph",
            paragraph: {
              rich_text: [{ type: "text", text: { content: item.details } }],
            },
          },
        ]
      : undefined;

    await notionRequest(opts, "POST", "/pages", {
      parent: { database_id: cvDb.id },
      properties: {
        Title: titleProp(item.title),
        Section: selectProp(item.section),
        "Highlight / Summary": richTextProp(item.highlight),
        "Tech Tags": multiSelectProp(item.tags),
        Period: richTextProp(item.period),
        Order: numberProp(item.order),
        Active: checkboxProp(item.active),
      },
      ...(children ? { children } : {}),
    });
    seededCvCount++;
  }

  // 5. Seed Criteria rows (sorted by order)
  let seededCriteriaCount = 0;
  for (const rule of [...criteriaEntries].sort((a, b) => a.order - b.order)) {
    await notionRequest(opts, "POST", "/pages", {
      parent: { database_id: criteriaDb.id },
      properties: {
        "Rule Name": titleProp(rule.ruleName),
        Category: selectProp(rule.category),
        Enforcement: selectProp(rule.enforcement),
        "Rule Type": selectProp(rule.ruleType),
        "Value / Keywords": richTextProp(rule.valueOrKeywords),
        "Rule Description (For Prompt)": richTextProp(rule.description),
        Order: numberProp(rule.order),
        Active: checkboxProp(rule.active),
      },
    });
    seededCriteriaCount++;
  }

  const cleanParentId = parentPageId.replace(/-/g, "");
  return {
    controlPlanePageId: parentPageId,
    controlPlanePageUrl: `https://www.notion.so/${cleanParentId}`,
    cvDbId: cvDb.id,
    cvDbUrl: cvDb.url ?? `https://www.notion.so/${cvDb.id.replace(/-/g, "")}`,
    criteriaDbId: criteriaDb.id,
    criteriaDbUrl: criteriaDb.url ?? `https://www.notion.so/${criteriaDb.id.replace(/-/g, "")}`,
    seededCvCount,
    seededCriteriaCount,
  };
}

/**
 * Fetch and parse all rows from the Notion CV and Criteria databases.
 */
export async function fetchNotionControlPlaneData(
  opts: NotionClientOptions,
  cvDbId: string,
  criteriaDbId: string,
): Promise<{
  readonly cvEntries: CvEntry[];
  readonly criteriaEntries: CriterionEntry[];
  readonly profileMarkdown: string;
  readonly scoringConfig: DynamicScoringConfig;
}> {
  interface QueryResp {
    results?: Array<{
      id: string;
      properties?: Record<string, unknown>;
    }>;
    has_more?: boolean;
  }

  const [cvResp, critResp] = await Promise.all([
    notionRequest<QueryResp>(opts, "POST", `/databases/${cvDbId.replace(/-/g, "")}/query`, {
      sorts: [{ property: "Order", direction: "ascending" }],
      page_size: 100,
    }),
    notionRequest<QueryResp>(opts, "POST", `/databases/${criteriaDbId.replace(/-/g, "")}/query`, {
      sorts: [{ property: "Order", direction: "ascending" }],
      page_size: 100,
    }),
  ]);
  if (!Array.isArray(cvResp.results) || !Array.isArray(critResp.results) ||
      cvResp.has_more === true || critResp.has_more === true) {
    throw new Error("Notion CV or Matching Criteria returned incomplete results");
  }

  const cvEntries: CvEntry[] = (cvResp.results ?? []).map((row, idx) => {
    const p = row.properties ?? {};
    return {
      id: row.id,
      title: readTitle(p["Title"]),
      section: readSelect(p["Section"], "Role & Summary") as CvSection,
      highlight: readRichText(p["Highlight / Summary"]),
      tags: readMultiSelect(p["Tech Tags"]),
      period: readRichText(p["Period"]),
      order: readNumber(p["Order"], idx + 1),
      active: readCheckbox(p["Active"], true),
    };
  });

  const criteriaEntries: CriterionEntry[] = (critResp.results ?? []).map((row, idx) => {
    const p = row.properties ?? {};
    return {
      id: row.id,
      ruleName: readTitle(p["Rule Name"]),
      category: readSelect(p["Category"], "Scoring Guideline") as CriterionCategory,
      enforcement: readSelect(p["Enforcement"], "Prompt Rule (LLM Only)") as CriterionEnforcement,
      ruleType: readSelect(p["Rule Type"], "Target / Preference") as CriterionRuleType,
      valueOrKeywords: readRichText(p["Value / Keywords"]),
      description: readRichText(p["Rule Description (For Prompt)"]),
      order: readNumber(p["Order"], idx + 1),
      active: readCheckbox(p["Active"], true),
    };
  });

  return {
    cvEntries,
    criteriaEntries,
    profileMarkdown: compileCandidateProfileMarkdown(cvEntries, criteriaEntries),
    scoringConfig: compileDynamicScoringConfig(criteriaEntries),
  };
}

// ─── Live Notion Control Plane ───────────────────────────────────────────────

export interface ActiveControlPlaneConfig {
  readonly profileMarkdown: string;
  readonly scoringConfig: DynamicScoringConfig;
  readonly source: "notion";
  readonly loadedAt: number;
}

const DEFAULT_CACHE_TTL_MS = 10 * 60 * 1000;

let cachedControlPlane: ActiveControlPlaneConfig | null = null;

export function invalidateControlPlaneCache(): void {
  cachedControlPlane = null;
}

export async function getActiveControlPlaneConfig(options?: {
  forceRefresh?: boolean;
  ttlMs?: number;
  clientOptions?: NotionClientOptions;
}): Promise<ActiveControlPlaneConfig> {
  const ttlMs = options?.ttlMs ?? DEFAULT_CACHE_TTL_MS;
  const now = Date.now();
  if (cachedControlPlane && !options?.forceRefresh && now - cachedControlPlane.loadedAt < ttlMs) {
    return cachedControlPlane;
  }

  const token = (options?.clientOptions?.token ?? process.env["NOTION_TOKEN"] ?? "").trim();
  const cvDbId = (process.env["NOTION_CV_DB_ID"] ?? "").trim();
  const criteriaDbId = (process.env["NOTION_CRITERIA_DB_ID"] ?? "").trim();
  if (!token || !cvDbId || !criteriaDbId) {
    throw new Error("Notion CV and Matching Criteria credentials are required");
  }

  const data = await fetchNotionControlPlaneData(
    options?.clientOptions ?? { token }, cvDbId, criteriaDbId,
  );
  if (!data.cvEntries.some((entry) => entry.active) ||
      !data.criteriaEntries.some((entry) => entry.active)) {
    throw new Error("Notion CV or Matching Criteria returned no active entries");
  }

  cachedControlPlane = {
    profileMarkdown: data.profileMarkdown,
    scoringConfig: data.scoringConfig,
    source: "notion",
    loadedAt: Date.now(),
  };
  return cachedControlPlane;
}
