import axios from "axios";
import {
  normalizePersonio,
  normalizeRecruitee,
  normalizeWorkable,
  parsePersonioXml,
  RawAshbyJob,
  RawGreenhouseJob,
  RawLeverPosting,
  RawPersonioPosition,
  RawRecruiteeOffer,
  RawWorkableJob,
  scrapeAts,
} from "../src/scrapers/ats";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

jest.mock("../src/config", () => ({
  config: {
    global: {
      requestDelayMs: 0,
      requestTimeoutMs: 1000,
      maxAgeDays: 60,
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
