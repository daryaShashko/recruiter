import axios from "axios";
import {
  normalizeAshby,
  normalizeLever,
  normalizePersonio,
  normalizeRecruitee,
  normalizeWorkable,
  parseAshbyCompensation,
  parsePersonioXml,
  passesFilter,
  RawAshbyJob,
  RawGreenhouseJob,
  RawLeverPosting,
  RawPersonioPosition,
  RawRecruiteeOffer,
  RawWorkableJob,
  scrapeAts,
} from "../src/scrapers/ats";
import { getAtsCompanyName } from "../src/scrapers/ats-companies";
import { extractMaxMonthlyPln } from "../../n8n/evaluator/scoring";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

jest.mock("../src/config", () => ({
  config: {
    global: {
      requestDelayMs: 0,
      requestTimeoutMs: 1000,
      maxAgeDays: 60,
      atsMaxAgeDays: 180,
      rejectRoleFamilies: [],
      jsSignals: ["javascript", "typescript", "node", "react"],
      seniorTitleSignals: ["senior", "lead", "staff", "principal"],
      rejectTitleSignals: ["junior", "intern"],
      legalBlockers: ["us citizen only", "security clearance"],
      atsFeeds: {
        workable: ["workable-co"],
        recruitee: ["recruitee-co"],
        personio: ["personio-co"],
      },
      ats: {
        greenhouse: ["greenhouse-co"],
        lever: ["lever-co"],
        ashby: ["ashby-co"],
      },
    },
  },
}));

const recentDate = new Date(Date.now() - 3 * 86_400_000).toISOString();

function workableJob(
  overrides: Partial<RawWorkableJob> = {},
): RawWorkableJob {
  return {
    shortcode: "ABCD1234",
    title: "Senior TypeScript Engineer",
    url: "https://apply.workable.com/j/ABCD1234",
    application_url: "https://apply.workable.com/j/ABCD1234/apply",
    published_on: recentDate.slice(0, 10),
    city: "London",
    country: "United Kingdom",
    ...overrides,
  };
}

function recruiteeOffer(
  overrides: Partial<RawRecruiteeOffer> = {},
): RawRecruiteeOffer {
  return {
    id: 17,
    slug: "senior-typescript-engineer",
    title: "Senior TypeScript Engineer",
    description: "<p>Building products with TypeScript and React.</p>",
    careers_url: "https://recruitee-co.recruitee.com/o/senior-typescript-engineer",
    company_name: "Recruitee Co",
    city: "Amsterdam",
    country: "Netherlands",
    published_at: recentDate,
    ...overrides,
  };
}

function greenhouseJob(
  overrides: Partial<RawGreenhouseJob> = {},
): RawGreenhouseJob {
  return {
    id: 23,
    title: "Senior TypeScript Engineer",
    company_name: "Greenhouse Co",
    absolute_url: "https://boards.greenhouse.io/greenhouse-co/jobs/23",
    content: "<p>Building products with TypeScript and React.</p>",
    first_published: recentDate,
    location: { name: "Remote" },
    departments: [{ name: "Engineering" }],
    ...overrides,
  };
}

function leverPosting(
  overrides: Partial<RawLeverPosting> = {},
): RawLeverPosting {
  return {
    id: "lever-id",
    text: "Senior TypeScript Engineer",
    hostedUrl: "https://jobs.lever.co/lever-co/lever-id",
    createdAt: new Date(recentDate).getTime(),
    descriptionPlain: "Building products with TypeScript and React.",
    categories: { location: "Remote", team: "Engineering" },
    ...overrides,
  };
}

function ashbyJob(overrides: Partial<RawAshbyJob> = {}): RawAshbyJob {
  return {
    id: "ashby-id",
    title: "Senior TypeScript Engineer",
    jobUrl: "https://jobs.ashbyhq.com/ashby-co/ashby-id",
    publishedAt: recentDate,
    descriptionPlain: "Building products with TypeScript and React.",
    location: "Remote",
    isRemote: true,
    department: "Engineering",
    ...overrides,
  };
}

function personioXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
  <workzag-jobs>
    <position>
      <id>123</id>
      <subcompany>Personio Co</subcompany>
      <office>Munich</office>
      <name><![CDATA[Senior TypeScript Engineer]]></name>
      <createdAt>${recentDate}</createdAt>
      <jobDescriptions>
        <jobDescription>
          <name>What you'll do</name>
          <value><![CDATA[<p>Build with TypeScript and React.</p>]]></value>
        </jobDescription>
      </jobDescriptions>
    </position>
  </workzag-jobs>`;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "log").mockImplementation(() => undefined);
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("scrapeAts", () => {
  it("normalizes matching jobs from all six ATS families", async () => {
    mockedAxios.get
      .mockResolvedValueOnce({
        data: { name: "Workable Co", jobs: [workableJob()] },
      })
      .mockResolvedValueOnce({ data: { offers: [recruiteeOffer()] } })
      .mockResolvedValueOnce({ data: personioXml() })
      .mockResolvedValueOnce({ data: { jobs: [greenhouseJob()] } })
      .mockResolvedValueOnce({ data: [leverPosting()] })
      .mockResolvedValueOnce({
        data: { jobs: [ashbyJob()] },
      })
      .mockResolvedValueOnce({
        data: {
          description: "<p>Build with TypeScript and React.</p>",
          requirements: "<p>Senior role.</p>",
        },
      });

    const offers = await scrapeAts();

    expect(offers.map((offer) => offer.source)).toEqual([
      "workable",
      "recruitee",
      "personio",
      "greenhouse",
      "lever",
      "ashby",
    ]);
    expect(offers.map((offer) => offer.id)).toEqual([
      "workable_workable-co_ABCD1234",
      "recruitee_recruitee-co_17",
      "personio_personio-co_123",
      "greenhouse_greenhouse-co_23",
      "lever_lever-co_lever-id",
      "ashby_ashby-co_ashby-id",
    ]);
    expect(offers[0].body).toContain("TypeScript");
    expect(offers[1].company).toBe("Recruitee Co");
    expect(offers[2].location).toBe("Munich");
    expect(offers[3].location).toBe("Remote");
    expect(offers[3].company).toBe("Greenhouse Co");
    expect(offers[4].location).toBe("Remote");
    expect(offers[5].location).toBe("Remote");
    expect(mockedAxios.get).toHaveBeenCalledTimes(7);
  });

  it("returns no jobs for empty feeds", async () => {
    mockedAxios.get
      .mockResolvedValueOnce({ data: { name: "Workable Co", jobs: [] } })
      .mockResolvedValueOnce({ data: { offers: [] } })
      .mockResolvedValueOnce({
        data: '<?xml version="1.0"?><workzag-jobs></workzag-jobs>',
      })
      .mockResolvedValueOnce({ data: { jobs: [] } })
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: { jobs: [] } });

    await expect(scrapeAts()).resolves.toEqual([]);
  });

  it("skips malformed JSON shapes and malformed Personio entries", async () => {
    mockedAxios.get
      .mockResolvedValueOnce({ data: { jobs: { broken: true } } })
      .mockResolvedValueOnce({ data: "<html>blocked</html>" })
      .mockResolvedValueOnce({
        data: "<workzag-jobs><position><name>No ID</name></position></workzag-jobs>",
      })
      .mockResolvedValueOnce({ data: { jobs: { broken: true } } })
      .mockResolvedValueOnce({ data: { broken: true } })
      .mockResolvedValueOnce({ data: { jobs: { broken: true } } });

    await expect(scrapeAts()).resolves.toEqual([]);
  });

  it("continues with other feeds when one ATS request times out", async () => {
    mockedAxios.get
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce({ data: { offers: [recruiteeOffer()] } })
      .mockResolvedValueOnce({ data: personioXml() })
      .mockResolvedValueOnce({ data: { jobs: [greenhouseJob()] } })
      .mockResolvedValueOnce({ data: [leverPosting()] })
      .mockResolvedValueOnce({ data: { jobs: [ashbyJob()] } });

    const offers = await scrapeAts();
    expect(offers.map((offer) => offer.source)).toEqual([
      "recruitee",
      "personio",
      "greenhouse",
      "lever",
      "ashby",
    ]);
  });

  it("isolates timeouts from Greenhouse, Lever, and Ashby boards", async () => {
    mockedAxios.get
      .mockResolvedValueOnce({ data: { name: "Workable Co", jobs: [] } })
      .mockResolvedValueOnce({ data: { offers: [] } })
      .mockResolvedValueOnce({
        data: '<?xml version="1.0"?><workzag-jobs></workzag-jobs>',
      })
      .mockRejectedValueOnce(new Error("Greenhouse timeout"))
      .mockRejectedValueOnce(new Error("Lever timeout"))
      .mockRejectedValueOnce(new Error("Ashby timeout"));

    await expect(scrapeAts()).resolves.toEqual([]);
    expect(mockedAxios.get).toHaveBeenCalledTimes(6);
  });

  it("filters junior and stale postings", async () => {
    const staleDate = new Date(Date.now() - 120 * 86_400_000).toISOString();
    mockedAxios.get
      .mockResolvedValueOnce({
        data: {
          name: "Workable Co",
          jobs: [
            workableJob({ shortcode: "JUNIOR", title: "Junior TypeScript Dev" }),
            workableJob({ shortcode: "STALE", published_on: staleDate }),
          ],
        },
      })
      .mockResolvedValueOnce({ data: { offers: [] } })
      .mockResolvedValueOnce({
        data: '<?xml version="1.0"?><workzag-jobs></workzag-jobs>',
      })
      .mockResolvedValueOnce({ data: { jobs: [] } })
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: { jobs: [] } });

    await expect(scrapeAts()).resolves.toEqual([]);
    // Junior and stale postings are both removed before detail requests.
    expect(mockedAxios.get).toHaveBeenCalledTimes(6);
  });

  it("filters unqualified postings across Greenhouse, Lever, and Ashby", async () => {
    mockedAxios.get
      .mockResolvedValueOnce({ data: { name: "Workable Co", jobs: [] } })
      .mockResolvedValueOnce({ data: { offers: [] } })
      .mockResolvedValueOnce({
        data: '<?xml version="1.0"?><workzag-jobs></workzag-jobs>',
      })
      .mockResolvedValueOnce({
        data: {
          jobs: [
            greenhouseJob({ title: "Junior TypeScript Engineer" }),
            greenhouseJob({
              id: 24,
              title: "Senior Java Engineer",
              content: "JavaScript is a plus.",
            }),
          ],
        },
      })
      .mockResolvedValueOnce({
        data: [
          leverPosting({ text: "Junior TypeScript Engineer" }),
          leverPosting({
            id: "java-role",
            text: "Senior Java Engineer",
            descriptionPlain: "JavaScript is a plus.",
          }),
        ],
      })
      .mockResolvedValueOnce({
        data: {
          jobs: [
            ashbyJob({ title: "Junior TypeScript Engineer" }),
            ashbyJob({
              id: "java-role",
              title: "Senior Java Engineer",
              descriptionPlain: "JavaScript is a plus.",
            }),
            ashbyJob({
              id: "unlisted",
              title: "Senior TypeScript Engineer",
              isListed: false,
            }),
          ],
        },
      });

    await expect(scrapeAts()).resolves.toEqual([]);
  });

  it("keeps ATS vacancies aged between 61 and 180 days (e.g. 90, 120 days) and drops >180 days", async () => {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000).toISOString();
    const oneTwentyDaysAgo = new Date(Date.now() - 120 * 86_400_000).toISOString();
    const twoHundredDaysAgo = new Date(Date.now() - 200 * 86_400_000).toISOString();

    mockedAxios.get
      .mockResolvedValueOnce({ data: { name: "Workable Co", jobs: [] } })
      .mockResolvedValueOnce({
        data: {
          offers: [
            recruiteeOffer({ id: 101, published_at: ninetyDaysAgo }),
            recruiteeOffer({ id: 102, published_at: twoHundredDaysAgo }),
          ],
        },
      })
      .mockResolvedValueOnce({
        data: '<?xml version="1.0"?><workzag-jobs></workzag-jobs>',
      })
      .mockResolvedValueOnce({
        data: {
          jobs: [
            greenhouseJob({ id: 201, first_published: oneTwentyDaysAgo }),
            greenhouseJob({ id: 202, first_published: twoHundredDaysAgo }),
          ],
        },
      })
      .mockResolvedValueOnce({
        data: [
          leverPosting({
            id: "lever-90",
            createdAt: new Date(ninetyDaysAgo).getTime(),
          }),
          leverPosting({
            id: "lever-200",
            createdAt: new Date(twoHundredDaysAgo).getTime(),
          }),
        ],
      })
      .mockResolvedValueOnce({
        data: {
          jobs: [
            ashbyJob({ id: "ashby-120", publishedAt: oneTwentyDaysAgo }),
            ashbyJob({ id: "ashby-200", publishedAt: twoHundredDaysAgo }),
          ],
        },
      });

    const offers = await scrapeAts();
    expect(offers.map((o) => o.id)).toEqual([
      "recruitee_recruitee-co_101",
      "greenhouse_greenhouse-co_201",
      "lever_lever-co_lever-90",
      "ashby_ashby-co_ashby-120",
    ]);
  });
});

describe("parsePersonioXml", () => {
  it("extracts CDATA, nested descriptions and XML-escaped text", () => {
    const parsed = parsePersonioXml(
      `<workzag-jobs><position>
        <id>42</id>
        <name>Senior R&amp;D TypeScript Engineer</name>
        <jobDescriptions><jobDescription>
          <value><![CDATA[<p>Build &amp; ship TypeScript.</p>]]></value>
        </jobDescription></jobDescriptions>
      </position></workzag-jobs>`,
    );

    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe("Senior R&D TypeScript Engineer");
    expect(parsed[0].descriptions).toEqual(["<p>Build &amp; ship TypeScript.</p>"]);
  });

  it("returns [] for invalid XML document roots", () => {
    expect(parsePersonioXml("<html><position><id>1</id></position></html>")).toEqual([]);
  });
});

describe("ATS normalization", () => {
  it("uses safe fallbacks for missing optional fields", () => {
    const workable = normalizeWorkable(
      "workable-co",
      "Workable Co",
      workableJob({
        application_url: undefined,
        url: undefined,
        city: undefined,
        country: undefined,
        telecommuting: true,
      }),
    );
    const recruitee = normalizeRecruitee(
      "recruitee-co",
      recruiteeOffer({
        careers_url: undefined,
        city: undefined,
        country: undefined,
        remote: true,
      }),
    );
    const personio = normalizePersonio("personio-co", {
      id: "1",
      name: "Senior TypeScript Engineer",
      descriptions: [],
    } satisfies RawPersonioPosition);

    expect(workable.url).toContain("/j/ABCD1234/");
    expect(workable.location).toBe("Remote");
    expect(recruitee.url).toContain("/o/senior-typescript-engineer");
    expect(recruitee.location).toBe("Remote");
    expect(personio.body).toBe("Senior TypeScript Engineer");
    expect(personio.location).toBe("Unknown");
  });
});

describe("ATS Company Mapping", () => {
  it("resolves clean company names for known Ashby slugs", () => {
    expect(getAtsCompanyName("linear")).toBe("Linear");
    expect(getAtsCompanyName("supabase")).toBe("Supabase");
    expect(getAtsCompanyName("n8n")).toBe("n8n");
    expect(getAtsCompanyName("ramp")).toBe("Ramp");
    expect(getAtsCompanyName("lovable")).toBe("Lovable");
    expect(getAtsCompanyName("synthesia")).toBe("Synthesia");
    expect(getAtsCompanyName("elevenlabs")).toBe("ElevenLabs");
    expect(getAtsCompanyName("incident")).toBe("Incident.io");
    expect(getAtsCompanyName("attio")).toBe("Attio");
  });

  it("resolves clean company names for known Lever slugs", () => {
    expect(getAtsCompanyName("spotify")).toBe("Spotify");
    expect(getAtsCompanyName("matillion")).toBe("Matillion");
    expect(getAtsCompanyName("contentsquare")).toBe("Contentsquare");
    expect(getAtsCompanyName("swile")).toBe("Swile");
  });

  it("handles case-insensitivity and falls back to slug for unknown companies", () => {
    expect(getAtsCompanyName("LINEAR")).toBe("Linear");
    expect(getAtsCompanyName("Spotify")).toBe("Spotify");
    expect(getAtsCompanyName("unknown-startup")).toBe("unknown-startup");
  });

  it("normalizeAshby and normalizeLever use clean company names", () => {
    const ashby = normalizeAshby("linear", ashbyJob({ id: "prod-eng", title: "Product Engineer" }));
    expect(ashby.company).toBe("Linear");

    const lever = normalizeLever("spotify", leverPosting({ id: "swe-1", text: "Senior Software Engineer" }));
    expect(lever.company).toBe("Spotify");
  });
});

describe("parseAshbyCompensation", () => {
  it("formats structured compensationTiers with components into annual salary with K suffix", () => {
    const comp = {
      compensationTiers: [
        {
          title: "US / Remote",
          components: [
            {
              summary: "$180,000 — $220,000",
              compensationType: "Salary",
              interval: "1 YEAR",
              currencyCode: "USD",
              minValue: 180000,
              maxValue: 220000,
            },
          ],
        },
      ],
    };
    expect(parseAshbyCompensation(comp)).toBe("$180k - $220k / year");
  });

  it("formats decimal thousands properly (Linear real case: $220,000 - $268,250)", () => {
    const comp = {
      compensationTiers: [
        {
          components: [
            {
              compensationType: "Salary",
              interval: "1 YEAR",
              currencyCode: "USD",
              minValue: 220000,
              maxValue: 268250,
            },
          ],
        },
      ],
    };
    expect(parseAshbyCompensation(comp)).toBe("$220k - $268.25k / year");
  });

  it("formats direct tier minSalary/maxSalary when components are absent", () => {
    const comp = {
      compensationTiers: [
        {
          minSalary: 180000,
          maxSalary: 220000,
          currency: "USD",
          interval: "Year",
        },
      ],
    };
    expect(parseAshbyCompensation(comp)).toBe("$180k - $220k / year");
  });

  it("formats non-USD currencies with appropriate symbol or code", () => {
    const compEur = {
      compensationTiers: [
        {
          minSalary: 80000,
          maxSalary: 100000,
          currency: "EUR",
          interval: "Year",
        },
      ],
    };
    expect(parseAshbyCompensation(compEur)).toBe("€80k - €100k / year");

    const compChf = {
      compensationTiers: [
        {
          minSalary: 120000,
          maxSalary: 140000,
          currency: "CHF",
          interval: "Year",
        },
      ],
    };
    expect(parseAshbyCompensation(compChf)).toBe("120k - 140k CHF / year");
  });

  it("formats single value when min equals max or max is omitted", () => {
    const comp = {
      compensationTiers: [
        {
          minSalary: 180000,
          currency: "USD",
          interval: "Year",
        },
      ],
    };
    expect(parseAshbyCompensation(comp)).toBe("$180k / year");
  });

  it("falls back to summary strings when compensationTiers are empty or absent", () => {
    expect(
      parseAshbyCompensation({ summary: "$180,000 - $220,000 / year" }),
    ).toBe("$180k - $220k / year");

    expect(
      parseAshbyCompensation({
        compensationTierSummary: "$220,000 — $268,250 • Offers Equity",
      }),
    ).toBe("$220k - $268,250 / year");
  });

  it("formats hourly interval properly", () => {
    const comp = {
      compensationTiers: [
        {
          minSalary: 80,
          maxSalary: 100,
          currency: "USD",
          interval: "Hour",
        },
      ],
    };
    expect(parseAshbyCompensation(comp)).toBe("$80 - $100 /h");
  });

  it("returns undefined for missing, null, or unparseable compensation", () => {
    expect(parseAshbyCompensation(undefined)).toBeUndefined();
    expect(parseAshbyCompensation(null)).toBeUndefined();
    expect(parseAshbyCompensation({})).toBeUndefined();
    expect(parseAshbyCompensation({ compensationTiers: [] })).toBeUndefined();
  });

  it("parses cleanly in extractMaxMonthlyPln and applies B2B threshold (no UoP markers)", () => {
    const comp = {
      compensationTiers: [
        {
          components: [
            {
              compensationType: "Salary",
              interval: "1 YEAR",
              currencyCode: "USD",
              minValue: 220000,
              maxValue: 268250,
            },
          ],
        },
      ],
    };

    const formattedSalary = parseAshbyCompensation(comp);
    expect(formattedSalary).toBeDefined();

    // Verify absence of UoP markers so scoring applies B2B floor
    const lower = formattedSalary!.toLowerCase();
    expect(lower).not.toContain("uop");
    expect(lower).not.toContain("prace");
    expect(lower).not.toContain("o pracę");

    // Verify extractMaxMonthlyPln converts annual USD salary to monthly PLN
    const monthlyPln = extractMaxMonthlyPln(formattedSalary);
    expect(monthlyPln).toBeDefined();
    // 268250 / 12 * 3.95 = ~88,299 PLN/month, which is >= 24,000 B2B floor
    expect(monthlyPln).toBeGreaterThan(24000);
    expect(monthlyPln).toBeCloseTo(88299, -2);
  });
});

describe("passesFilter (ATS 180-day freshness threshold)", () => {
  const title = "Senior TypeScript Engineer";
  const description = "<p>Building scalable products with React and Node.js.</p>";

  it("evaluates to 'ok' for ATS vacancies aged between 61 and 180 days (default and explicit ATS sources)", () => {
    const now = Date.now();
    const dayMs = 86_400_000;

    const sixtyOneDaysAgo = new Date(now - 61 * dayMs).toISOString();
    const ninetyDaysAgo = new Date(now - 90 * dayMs).toISOString();
    const oneTwentyDaysAgo = new Date(now - 120 * dayMs).toISOString();
    const oneHundredSeventyNineDaysAgo = new Date(now - 179 * dayMs).toISOString();

    // Default source ("ats")
    expect(passesFilter(title, description, sixtyOneDaysAgo)).toBe("ok");
    expect(passesFilter(title, description, ninetyDaysAgo)).toBe("ok");
    expect(passesFilter(title, description, oneTwentyDaysAgo)).toBe("ok");
    expect(passesFilter(title, description, oneHundredSeventyNineDaysAgo)).toBe("ok");

    // Explicit ATS source names
    expect(passesFilter(title, description, ninetyDaysAgo, "ats")).toBe("ok");
    expect(passesFilter(title, description, ninetyDaysAgo, "greenhouse")).toBe("ok");
    expect(passesFilter(title, description, oneTwentyDaysAgo, "lever")).toBe("ok");
    expect(passesFilter(title, description, oneTwentyDaysAgo, "ashby")).toBe("ok");
    expect(passesFilter(title, description, ninetyDaysAgo, "recruitee")).toBe("ok");
    expect(passesFilter(title, description, ninetyDaysAgo, "personio")).toBe("ok");
    expect(passesFilter(title, description, ninetyDaysAgo, "workable")).toBe("ok");
  });

  it("evaluates to 'too-old' for ATS vacancies aged >180 days", () => {
    const now = Date.now();
    const dayMs = 86_400_000;

    const oneHundredEightyOneDaysAgo = new Date(now - 181 * dayMs).toISOString();
    const twoHundredDaysAgo = new Date(now - 200 * dayMs).toISOString();
    const threeHundredDaysAgo = new Date(now - 300 * dayMs).toISOString();

    // Default source ("ats")
    expect(passesFilter(title, description, oneHundredEightyOneDaysAgo)).toBe("too-old");
    expect(passesFilter(title, description, twoHundredDaysAgo)).toBe("too-old");
    expect(passesFilter(title, description, threeHundredDaysAgo)).toBe("too-old");

    // Explicit ATS source names
    expect(passesFilter(title, description, twoHundredDaysAgo, "ats")).toBe("too-old");
    expect(passesFilter(title, description, twoHundredDaysAgo, "greenhouse")).toBe("too-old");
    expect(passesFilter(title, description, twoHundredDaysAgo, "lever")).toBe("too-old");
    expect(passesFilter(title, description, twoHundredDaysAgo, "ashby")).toBe("too-old");
    expect(passesFilter(title, description, twoHundredDaysAgo, "recruitee")).toBe("too-old");
    expect(passesFilter(title, description, twoHundredDaysAgo, "personio")).toBe("too-old");
    expect(passesFilter(title, description, twoHundredDaysAgo, "workable")).toBe("too-old");
  });
});

