import {
  calculateNetSalary,
  classifyPipelineError,
  CURRENCY_RATES_TO_PLN,
  evaluateJob,
  extractMaxMonthlyPln,
  isMissingJobDescription,
  isNonJsRequiredStack,
  JobForScoring,
  mentionsNonJsLanguage,
  preFilterJob,
  RATES_AS_OF_DATE,
} from "../../n8n/evaluator/scoring";

function makeJob(overrides: Partial<JobForScoring> = {}): JobForScoring {
  return {
    id: "justjoin_test",
    title: "Senior Full-Stack Developer",
    company: "Acme Tech",
    url: "https://justjoin.it/job-offer/acme-tech",
    source: "justjoin",
    location: "Remote",
    salary: "25 000 – 30 000 PLN B2B",
    body: "Fully remote role building Node.js, TypeScript, and React microservices.",
    scrapedAt: "2026-10-05T00:00:00.000Z",
    fingerprint: "abc123",
    ...overrides,
  };
}

function rawLlm(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    overall_score: 88,
    tech_stack_match: 92,
    seniority_match: 90,
    red_flags: [],
    reason: "Strong match: Node.js, TypeScript, and React full-stack role at 25-30k PLN B2B.",
    company_dossier: "Продуктовая B2B SaaS компания европейского масштаба.",
    project_summary: "Продуктовая B2B SaaS платформа автоматизации процессов для среднего бизнеса в ЕС.",
    tasks_summary: [
      "Проектирование и разработка микросервисов на Node.js и TypeScript",
      "Создание интерфейсов на React",
      "Оптимизация запросов в PostgreSQL",
    ],
    match_pros: [
      "100% совпадение по основному стеку (Node.js, TypeScript, React)",
      "Полная удалёнка и вилка 25-30k PLN B2B",
    ],
    match_cons: ["Не указан размер инженерной команды"],
    pitch_hook:
      "Опыт построения высоконагруженных микросервисов на TypeScript/Node.js и React-приложений позволит быстро усилить команду.",
    ...overrides,
  });
}

describe("WP-2.1: Rich Russian Evaluator Output & Net Salary", () => {
  it("parses and returns all Russian fields (project_summary, tasks_summary, match_pros, match_cons, pitch_hook) and net_salary", () => {
    const result = evaluateJob(rawLlm(), makeJob());

    expect(result.overall_score).toBe(88);
    expect(result.match).toBe(true);
    expect(result.company_dossier).toBe("Продуктовая B2B SaaS компания европейского масштаба.");
    expect(result.project_summary).toBe(
      "Продуктовая B2B SaaS платформа автоматизации процессов для среднего бизнеса в ЕС.",
    );
    expect(result.tasks_summary).toEqual([
      "Проектирование и разработка микросервисов на Node.js и TypeScript",
      "Создание интерфейсов на React",
      "Оптимизация запросов в PostgreSQL",
    ]);
    expect(result.match_pros).toEqual([
      "100% совпадение по основному стеку (Node.js, TypeScript, React)",
      "Полная удалёнка и вилка 25-30k PLN B2B",
    ]);
    expect(result.match_cons).toEqual(["Не указан размер инженерной команды"]);
    expect(result.pitch_hook).toBe(
      "Опыт построения высоконагруженных микросервисов на TypeScript/Node.js и React-приложений позволит быстро усилить команду.",
    );
    expect(result.net_salary).toBe("20 000 – 24 000 PLN");
  });

  it("keeps company_dossier and project_summary backward-compatible when only one is provided", () => {
    const onlyProjectSummary = evaluateJob(
      rawLlm({
        company_dossier: undefined,
        project_summary: "Финтех SaaS платформа для B2B платежей.",
      }),
      makeJob(),
    );
    expect(onlyProjectSummary.project_summary).toBe("Финтех SaaS платформа для B2B платежей.");
    expect(onlyProjectSummary.company_dossier).toBe("Финтех SaaS платформа для B2B платежей.");

    const onlyCompanyDossier = evaluateJob(
      rawLlm({
        company_dossier: "Европейский e-commerce продукт.",
        project_summary: undefined,
      }),
      makeJob(),
    );
    expect(onlyCompanyDossier.company_dossier).toBe("Европейский e-commerce продукт.");
    expect(onlyCompanyDossier.project_summary).toBe("Европейский e-commerce продукт.");

    const neitherProvided = evaluateJob(
      rawLlm({
        company_dossier: undefined,
        project_summary: undefined,
      }),
      makeJob(),
    );
    expect(neitherProvided.company_dossier).toBeUndefined();
    expect(neitherProvided.project_summary).toBeUndefined();
  });

  it("calculates net_salary programmatically for PLN B2B, PLN UoP, EUR/USD, hourly, and undisclosed salaries", () => {
    expect(calculateNetSalary("25 000 – 30 000 PLN B2B")).toBe("20 000 – 24 000 PLN");
    expect(calculateNetSalary("25 000 PLN B2B/mo")).toBe("20 000 PLN");
    expect(calculateNetSalary("30 000 PLN UoP/mo")).toBe("21 000 PLN");
    expect(calculateNetSalary("6 000 – 7 000 EUR B2B/mo")).toBe(
      "4 800 – 5 600 EUR (~20 400 – 23 800 PLN)",
    );
    expect(calculateNetSalary("150 – 200 PLN B2B/h")).toBe("19 200 – 25 600 PLN");
    expect(calculateNetSalary("25 000 PLN (via justjoin) | 24 000 PLN (via nofluffjobs)")).toBe(
      "20 000 PLN",
    );
    expect(calculateNetSalary("Undisclosed")).toBeUndefined();
    expect(calculateNetSalary("")).toBeUndefined();
    expect(calculateNetSalary(undefined)).toBeUndefined();
  });
});

describe("WP-2.2: Remove Missing Description Rule & Reject Empty/Stub Descriptions", () => {
  it("detects empty, 'No description available', and synthetic metadata-only stubs via isMissingJobDescription", () => {
    expect(isMissingJobDescription(makeJob({ body: "" }))).toBe(true);
    expect(isMissingJobDescription(makeJob({ body: "   " }))).toBe(true);
    expect(isMissingJobDescription(makeJob({ body: "No description available" }))).toBe(true);
    expect(isMissingJobDescription(makeJob({ body: undefined }))).toBe(true);
    expect(
      isMissingJobDescription(
        makeJob({
          body: [
            "Position: Senior Node.js Developer",
            "Company: QuickHire",
            "Experience level: senior",
            "Work type: remote",
            "Required skills: Node.js (4/5), TypeScript (4/5)",
            "Locations: Gdańsk",
          ].join("\n"),
        }),
      ),
    ).toBe(true);
    expect(isMissingJobDescription(makeJob())).toBe(false);
  });

  it("rejects jobs with missing or synthetic stub descriptions (overall_score < 50 / === 0) even if LLM returns 72+", () => {
    for (const body of [
      "",
      "   ",
      "No description available",
      "Position: Senior Node.js Developer\nCompany: QuickHire\nLocations: Gdańsk",
    ]) {
      const result = evaluateJob(
        rawLlm({ overall_score: 72, tech_stack_match: 80, seniority_match: 90 }),
        makeJob({ company: "QuickHire", location: "Gdańsk", body }),
      );
      expect(result.overall_score).toBe(0);
      expect(result.overall_score).toBeLessThan(50);
      expect(result.match).toBe(false);
      expect(result.red_flags).toContain("Description: Missing");
    }
  });

  it("does not recover a job with missing description above 50 even when undisclosed salary recovery triggers", () => {
    const result = evaluateJob(
      rawLlm({
        overall_score: 0,
        tech_stack_match: 90,
        seniority_match: 90,
        red_flags: ["Salary below hard floor"],
      }),
      makeJob({ salary: "Undisclosed", body: "No description available" }),
    );
    expect(result.overall_score).toBe(0);
    expect(result.match).toBe(false);
    expect(result.red_flags).toContain("Description: Missing");
  });
});

describe("WP-6.1: Pre-LLM Hard Reject Gate preFilterJob() & Direct Non-JS Check", () => {
  it("passes a clean Senior TypeScript/React/Node.js product company job through preFilterJob", () => {
    const res = preFilterJob(makeJob());
    expect(res.rejected).toBe(false);
    expect(res.red_flags).toEqual([]);
    expect(res.evaluation).toBeUndefined();
  });

  it("pre-rejects jobs with salary below B2B (24k PLN) or UoP (27k PLN) hard floor and respects custom rawConfig", () => {
    const lowB2b = preFilterJob(makeJob({ salary: "16 000 – 20 000 PLN B2B/mo" }));
    expect(lowB2b.rejected).toBe(true);
    expect(lowB2b.red_flags).toContain("Salary: Below Hard Floor");
    expect(lowB2b.evaluation?.overall_score).toBe(0);
    expect(lowB2b.evaluation?.match).toBe(false);

    const lowUop = preFilterJob(makeJob({ salary: "20 000 – 24 000 PLN UoP/mo" }));
    expect(lowUop.rejected).toBe(true);
    expect(lowUop.red_flags).toContain("Salary: Below Hard Floor");
    expect(lowUop.evaluation?.overall_score).toBe(0);

    const customFloor = preFilterJob(makeJob({ salary: "25 000 – 28 000 PLN B2B/mo" }), {
      cryptoKeywords: [],
      gamblingKeywords: [],
      outsourcingKeywords: [],
      tricityKeywords: ["gdańsk"],
      minB2bPlnFloor: 30000,
    });
    expect(customFloor.rejected).toBe(true);
    expect(customFloor.red_flags).toContain("Salary: Below Hard Floor");

    // Undisclosed salary is NOT rejected by preFilterJob
    const undisclosed = preFilterJob(makeJob({ salary: "Undisclosed" }));
    expect(undisclosed.rejected).toBe(false);
  });

  it("pre-rejects OUTSOURCING_KEYWORDS by company name or body markers", () => {
    const epam = preFilterJob(makeJob({ company: "EPAM Systems" }));
    expect(epam.rejected).toBe(true);
    expect(epam.red_flags).toContain("Industry: Agency/Outsourcing");
    expect(epam.evaluation?.overall_score).toBe(0);

    const bodyLeasing = preFilterJob(
      makeJob({
        company: "Unknown IT",
        body: "Senior Node.js engineer working for our client on a body leasing basis.",
      }),
    );
    expect(bodyLeasing.rejected).toBe(true);
    expect(bodyLeasing.red_flags).toContain("Industry: Agency/Outsourcing");
  });

  it("pre-rejects CRYPTO_KEYWORDS and GAMBLING_KEYWORDS without false positives on 'defining' or 'cryptography'", () => {
    const cryptoJob = preFilterJob(
      makeJob({ title: "Senior Smart Contract & Web3 Engineer" }),
    );
    expect(cryptoJob.rejected).toBe(true);
    expect(cryptoJob.red_flags).toContain("Industry: Crypto/Web3");
    expect(cryptoJob.evaluation?.overall_score).toBe(0);

    const gamblingJob = preFilterJob(
      makeJob({ body: "Build our high-throughput sportsbook and online casino platform with Node.js." }),
    );
    expect(gamblingJob.rejected).toBe(true);
    expect(gamblingJob.red_flags).toContain("Industry: Gambling/Betting");

    const safeJob = preFilterJob(
      makeJob({
        body: "Defining the future of cloud security using standard TLS cryptography in Node.js and React.",
      }),
    );
    expect(safeJob.rejected).toBe(false);
  });

  it("pre-rejects BOSSWARE_SURVEILLANCE_REGEX and uncompensated TOXIC_OVERWORK_REGEX", () => {
    const bossware = preFilterJob(
      makeJob({
        body: "Remote Node.js role. We use Hubstaff and automated screenshot monitoring.",
      }),
    );
    expect(bossware.rejected).toBe(true);
    expect(bossware.red_flags).toContain("Process: Invasive Surveillance");
    expect(bossware.evaluation?.overall_score).toBe(0);

    const toxic = preFilterJob(
      makeJob({
        body: "Node.js startup with hustle mentality, work hard, play hard, and 24/7 on-call availability.",
      }),
    );
    expect(toxic.rejected).toBe(true);
    expect(toxic.red_flags).toContain("Culture: Overwork Risk");
    expect(toxic.evaluation?.overall_score).toBe(0);

    const compensatedOncall = preFilterJob(
      makeJob({
        body: "Node.js platform engineer with rotational on-call (1 week in 6) and dedicated on-call allowance.",
      }),
    );
    expect(compensatedOncall.rejected).toBe(false);
  });

  it("directly checks jobTitleLower / jobBodyLower via mentionsNonJsLanguage() for Stack: Non-JS Required in both preFilterJob and evaluateJob", () => {
    expect(mentionsNonJsLanguage("Senior Java Developer")).toBe(true);
    expect(mentionsNonJsLanguage("Senior JavaScript Developer")).toBe(false);
    expect(isNonJsRequiredStack("Senior Java Developer", "Spring Boot microservices")).toBe(true);
    expect(
      isNonJsRequiredStack(
        "Senior Backend Engineer",
        "We are looking for a Python and FastAPI backend engineer with PostgreSQL.",
      ),
    ).toBe(true);
    expect(
      isNonJsRequiredStack(
        "Senior Software Engineer",
        "Primary stack: Golang and Kubernetes microservices.",
      ),
    ).toBe(true);

    // Pre-filter rejects required Non-JS jobs before LLM call
    const javaPre = preFilterJob(
      makeJob({
        title: "Senior Java Developer",
        body: "Building enterprise microservices with Java 21, Spring Boot, and Kafka.",
      }),
    );
    expect(javaPre.rejected).toBe(true);
    expect(javaPre.red_flags).toContain("Stack: Non-JS Required");
    expect(javaPre.evaluation?.overall_score).toBe(0);

    const pythonPre = preFilterJob(
      makeJob({
        title: "Senior Backend Engineer",
        body: "Developing data pipelines and backend APIs in Python and Django.",
      }),
    );
    expect(pythonPre.rejected).toBe(true);
    expect(pythonPre.red_flags).toContain("Stack: Non-JS Required");

    // evaluateJob also enforces Stack: Non-JS Required directly if LLM missed flagging it
    const missedByLlm = evaluateJob(
      rawLlm({ overall_score: 90, red_flags: [] }),
      makeJob({
        title: "Senior Python Backend Engineer",
        body: "Building backend services with Python, FastAPI, and AWS.",
      }),
    );
    expect(missedByLlm.overall_score).toBe(0);
    expect(missedByLlm.match).toBe(false);
    expect(missedByLlm.red_flags).toContain("Stack: Non-JS Required");

    // Legacy migration with Node.js/React primary stack or nice-to-have Non-JS is NOT rejected
    const migrationJob = makeJob({
      title: "Senior Full-Stack Engineer",
      body: "80% Node.js/TypeScript + React, migrating 20% legacy Java services to NestJS.",
    });
    expect(preFilterJob(migrationJob).rejected).toBe(false);
    const migrationEval = evaluateJob(rawLlm({ overall_score: 84 }), migrationJob);
    expect(migrationEval.overall_score).toBe(84);
    expect(migrationEval.red_flags).not.toContain("Stack: Non-JS Required");

    const niceToHaveJob = makeJob({
      title: "Senior Node.js Engineer",
      body: "Core stack: Node.js, TypeScript, PostgreSQL. Python or Go is a plus / nice-to-have.",
    });
    expect(preFilterJob(niceToHaveJob).rejected).toBe(false);
    const niceToHaveEval = evaluateJob(rawLlm({ overall_score: 86 }), niceToHaveJob);
    expect(niceToHaveEval.overall_score).toBe(86);
    expect(niceToHaveEval.red_flags).not.toContain("Stack: Non-JS Required");
  });

  it("preserves existing salary parsing, pipeline error classification, and exchange rate metadata", () => {
    expect(extractMaxMonthlyPln("25 000 – 30 000 PLN B2B")).toBe(30000);
    expect(RATES_AS_OF_DATE).toBe("2026-11-16");
    expect(CURRENCY_RATES_TO_PLN.RATES_AS_OF_DATE).toBe("2026-11-16");
    expect(classifyPipelineError("429 Too Many Requests")).toBe("Pipeline: Quota Error");
  });
});
