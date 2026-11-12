import * as fs from "fs";
import * as path from "path";
import {
  buildCompanySearchUrl,
  getCompanySearchUrl,
  getCompanyUrl,
  normalizeCompanyUrl,
  JobOffer,
  CompanyMetadata,
} from "../src/types";
import { normalizeOffer, RawJustJoinOffer } from "../src/scrapers/justjoin";
import {
  normalizePosting,
  deduplicateByReference,
  RawNoFluffPosting,
} from "../src/scrapers/nofluffjobs";
import { evaluateJob } from "../../n8n/evaluator/scoring";
import {
  loadSystemPromptTemplate,
  EVALUATOR_OUTPUT_SCHEMA,
  EVALUATOR_OUTPUT_SCHEMA_WITH_DOSSIER,
} from "../../n8n/evaluator/prompt-builder";

describe("Company Metadata Extraction & Fallback (HITL Slice 1)", () => {
  describe("Google search fallback helpers", () => {
    it("generates correct Google search URL using companyName + ' software'", () => {
      const url = buildCompanySearchUrl("Acme Corp");
      expect(url).toBe("https://www.google.com/search?q=Acme%20Corp%20software");
    });

    it("handles special characters and Polish diacritics in company name", () => {
      const url = buildCompanySearchUrl("Spółka & Co.");
      expect(url).toBe(
        `https://www.google.com/search?q=${encodeURIComponent("Spółka & Co. software")}`,
      );
    });

    it("provides getCompanySearchUrl as alias for buildCompanySearchUrl", () => {
      expect(getCompanySearchUrl("Innovatech")).toBe(
        buildCompanySearchUrl("Innovatech"),
      );
    });

    it("resolves direct company URL when available via getCompanyUrl", () => {
      expect(getCompanyUrl("Acme", "https://acme.inc")).toBe("https://acme.inc");
      expect(
        getCompanyUrl({
          company: "Acme",
          companyMeta: { companyUrl: "https://acme.org" },
        }),
      ).toBe("https://acme.org");
    });

    it("falls back to Google search URL when direct company URL is missing", () => {
      expect(getCompanyUrl("Acme")).toBe(
        "https://www.google.com/search?q=Acme%20software",
      );
      expect(
        getCompanyUrl({
          company: "Acme",
          companyMeta: {},
        }),
      ).toBe("https://www.google.com/search?q=Acme%20software");
      expect(
        getCompanyUrl({
          company: "Beta Tech",
        }),
      ).toBe("https://www.google.com/search?q=Beta%20Tech%20software");
    });

    it("handles empty or whitespace-only company name safely", () => {
      expect(buildCompanySearchUrl("")).toBe("https://www.google.com/search?q=software");
      expect(buildCompanySearchUrl("   ")).toBe("https://www.google.com/search?q=software");
      expect(buildCompanySearchUrl(undefined)).toBe("https://www.google.com/search?q=software");
      expect(getCompanyUrl("")).toBe("https://www.google.com/search?q=software");
      expect(getCompanyUrl(null)).toBe("https://www.google.com/search?q=software");
    });

    it("normalizes direct URLs missing protocol with https://", () => {
      expect(getCompanyUrl("Acme", "acme.inc")).toBe("https://acme.inc");
      expect(
        getCompanyUrl({
          company: "Acme",
          companyMeta: { companyUrl: "www.acme.org" },
        }),
      ).toBe("https://www.acme.org");
    });

    it("resolves direct company URL when companyOrOffer is null or undefined", () => {
      expect(getCompanyUrl(null, "https://acme.inc")).toBe("https://acme.inc");
      expect(getCompanyUrl(undefined, "acme.inc")).toBe("https://acme.inc");
    });

    it("normalizeCompanyUrl handles bare domains, protocol-relative, and invalid inputs", () => {
      expect(normalizeCompanyUrl("acme.com")).toBe("https://acme.com");
      expect(normalizeCompanyUrl("acme.com/jobs")).toBe("https://acme.com/jobs");
      expect(normalizeCompanyUrl("//acme.com")).toBe("https://acme.com");
      expect(normalizeCompanyUrl("http://acme.com")).toBe("http://acme.com");
      expect(normalizeCompanyUrl("https://acme.com")).toBe("https://acme.com");
      expect(normalizeCompanyUrl("")).toBeUndefined();
      expect(normalizeCompanyUrl("   ")).toBeUndefined();
      expect(normalizeCompanyUrl(null)).toBeUndefined();
      expect(normalizeCompanyUrl(undefined)).toBeUndefined();
      expect(normalizeCompanyUrl("https://")).toBeUndefined();
      expect(normalizeCompanyUrl("http://")).toBeUndefined();
      expect(normalizeCompanyUrl("null")).toBeUndefined();
      expect(normalizeCompanyUrl("undefined")).toBeUndefined();
      expect(normalizeCompanyUrl("N/A")).toBeUndefined();
      expect(normalizeCompanyUrl("javascript:alert(1)")).toBeUndefined();
      expect(normalizeCompanyUrl("ftp://ftp.example.com")).toBeUndefined();
    });
  });

  describe("JustJoin scraper metadata extraction", () => {
    const baseRawJJ: RawJustJoinOffer = {
      guid: "guid-1",
      slug: "senior-dev-acme",
      title: "Senior TypeScript Developer",
      workplaceType: "remote",
      workingTime: "full_time",
      experienceLevel: "senior",
      city: "Gdańsk",
      companyName: "Acme Corp",
      publishedAt: "2026-11-12T00:00:00.000Z",
      locations: [{ city: "Gdańsk", slug: "gdansk" }],
      employmentTypes: [
        {
          from: 25000,
          to: 30000,
          currency: "PLN",
          currencySource: "original",
          type: "b2b",
          unit: "Month",
          gross: false,
        },
      ],
      requiredSkills: [{ name: "TypeScript", level: 5 }],
      niceToHaveSkills: [{ name: "React", level: 4 }],
    };

    it("extracts companySize and companyUrl into companyMeta", () => {
      const raw: RawJustJoinOffer = {
        ...baseRawJJ,
        companySize: "50-100",
        companyUrl: "https://acme.com",
        advertiserType: "direct",
        industry: "FinTech",
      };

      const offer = normalizeOffer(raw);
      expect(offer.companyMeta).toBeDefined();
      expect(offer.companyMeta?.size).toBe("50-100");
      expect(offer.companyMeta?.companyUrl).toBe("https://acme.com");
      expect(offer.companyMeta?.advertiserType).toBe("direct");
      expect(offer.companyMeta?.industry).toBe("FinTech");
    });

    it("normalizes numeric companySize to string", () => {
      const raw: RawJustJoinOffer = {
        ...baseRawJJ,
        companySize: 250,
      };

      const offer = normalizeOffer(raw);
      expect(offer.companyMeta?.size).toBe("250");
    });

    it("supports snake_case company_size and company_url fallbacks", () => {
      const raw: RawJustJoinOffer = {
        ...baseRawJJ,
        company_size: "10-50",
        company_url: "https://acme-alt.com",
      };

      const offer = normalizeOffer(raw);
      expect(offer.companyMeta?.size).toBe("10-50");
      expect(offer.companyMeta?.companyUrl).toBe("https://acme-alt.com");
    });

    it("extracts nested company.size and company.url", () => {
      const raw: RawJustJoinOffer = {
        ...baseRawJJ,
        company: {
          size: "20-100",
          url: "https://acme-nested.io",
        },
      };

      const offer = normalizeOffer(raw);
      expect(offer.companyMeta?.size).toBe("20-100");
      expect(offer.companyMeta?.companyUrl).toBe("https://acme-nested.io");
    });

    it("normalizes bare companyUrl missing protocol with https:// in normalizeOffer", () => {
      const raw: RawJustJoinOffer = {
        ...baseRawJJ,
        companyUrl: "acme.com",
      };

      const offer = normalizeOffer(raw);
      expect(offer.companyMeta?.companyUrl).toBe("https://acme.com");
    });

    it("leaves companyMeta undefined when no company metadata is present (backward compatibility)", () => {
      const offer = normalizeOffer(baseRawJJ);
      expect(offer.companyMeta).toBeUndefined();
    });
  });

  describe("NoFluffJobs scraper metadata extraction", () => {
    const baseRawNFJ: RawNoFluffPosting = {
      id: "nfj-1",
      name: "Global Tech Sp. z o.o.",
      title: "Senior Node.js Engineer",
      url: "senior-nodejs-engineer-global-tech",
      reference: "NFJREF123",
      posted: 1731369600000,
      technology: "javascript",
      category: "backend",
      seniority: ["Senior"],
      location: {
        places: [{ city: "Gdańsk", url: "gdansk" }],
        fullyRemote: true,
        covidTimeRemotely: false,
      },
      fullyRemote: true,
    };

    it("extracts companySize and companyUrl into companyMeta", () => {
      const posting: RawNoFluffPosting = {
        ...baseRawNFJ,
        companySize: "100-500",
        companyUrl: "https://globaltech.io",
        advertiserType: "product",
        industry: "E-Commerce",
      };

      const offer = normalizePosting(posting);
      expect(offer.companyMeta).toBeDefined();
      expect(offer.companyMeta?.size).toBe("100-500");
      expect(offer.companyMeta?.companyUrl).toBe("https://globaltech.io");
      expect(offer.companyMeta?.advertiserType).toBe("product");
      expect(offer.companyMeta?.industry).toBe("E-Commerce");
    });

    it("extracts nested company.size and company.url", () => {
      const posting: RawNoFluffPosting = {
        ...baseRawNFJ,
        company: {
          size: "50+",
          url: "https://globaltech-nested.io",
        },
      };

      const offer = normalizePosting(posting);
      expect(offer.companyMeta?.size).toBe("50+");
      expect(offer.companyMeta?.companyUrl).toBe("https://globaltech-nested.io");
    });

    it("normalizes bare companyUrl missing protocol with https:// in normalizePosting", () => {
      const posting: RawNoFluffPosting = {
        ...baseRawNFJ,
        companyUrl: "nofluff.com/about",
      };

      const offer = normalizePosting(posting);
      expect(offer.companyMeta?.companyUrl).toBe("https://nofluff.com/about");
    });

    it("merges company metadata across location variants in deduplicateByReference", () => {
      const v1: RawNoFluffPosting = {
        ...baseRawNFJ,
        id: "v1",
        reference: "SAME_REF",
        companySize: "10-50",
        advertiserType: "direct",
        location: { places: [{ city: "Warszawa", url: "warszawa" }], fullyRemote: false, covidTimeRemotely: false },
      };
      const v2: RawNoFluffPosting = {
        ...baseRawNFJ,
        id: "v2",
        reference: "SAME_REF",
        companyUrl: "https://v2company.com",
        industry: "FinTech",
        location: { places: [], fullyRemote: true, covidTimeRemotely: false },
      };

      const deduped = deduplicateByReference([v1, v2]);
      expect(deduped).toHaveLength(1);
      expect(deduped[0].companySize).toBe("10-50");
      expect(deduped[0].companyUrl).toBe("https://v2company.com");
      expect(deduped[0].advertiserType).toBe("direct");
      expect(deduped[0].industry).toBe("FinTech");
    });

    it("leaves companyMeta undefined when no company metadata is present", () => {
      const offer = normalizePosting(baseRawNFJ);
      expect(offer.companyMeta).toBeUndefined();
    });
  });

  describe("LLM Evaluator & Dossier Specification", () => {
    it("system prompt template contains company_dossier contract and anti-hallucination rule", () => {
      const template = loadSystemPromptTemplate();
      expect(template).toContain("company_dossier");
      expect(template).toContain("CRITICAL company_dossier FORMATTING RULE");
      expect(template).toContain("without hallucinations");
    });

    it("EVALUATOR_OUTPUT_SCHEMA includes company_dossier in properties and required fields", () => {
      expect(EVALUATOR_OUTPUT_SCHEMA.properties).toHaveProperty("company_dossier");
      expect(EVALUATOR_OUTPUT_SCHEMA.required).toContain("company_dossier");
      expect(EVALUATOR_OUTPUT_SCHEMA_WITH_DOSSIER.properties).toHaveProperty(
        "company_dossier",
      );
    });

    it("scoring evaluateJob preserves company_dossier returned by LLM", () => {
      const job = {
        id: "job-1",
        title: "Senior Fullstack Engineer",
        company: "Stripe",
        url: "https://stripe.com/jobs/1",
        salary: "30000 PLN B2B",
        location: "Remote",
        body: "TypeScript, React, Node.js role building global payments infrastructure.",
      };

      const llmOutput = JSON.stringify({
        overall_score: 95,
        tech_stack_match: 95,
        seniority_match: 95,
        red_flags: [],
        reason: "Strong fit for TypeScript and Node.js payments stack.",
        url: "https://stripe.com/jobs/1",
        company_dossier:
          "Международная финтех-компания, разрабатывающая инфраструктуру онлайн-платежей для бизнеса (B2B SaaS). Масштаб — глобальный enterprise.",
      });

      const result = evaluateJob(llmOutput, job);
      expect(result.overall_score).toBe(95);
      expect(result.company_dossier).toBe(
        "Международная финтех-компания, разрабатывающая инфраструктуру онлайн-платежей для бизнеса (B2B SaaS). Масштаб — глобальный enterprise.",
      );
    });

    it("scoring evaluateJob forwards companyMeta from JobForScoring to EvaluationResult", () => {
      const job = {
        id: "job-meta-1",
        title: "Senior Fullstack Engineer",
        company: "Acme",
        url: "https://example.com/meta",
        companyMeta: {
          size: "50-100",
          companyUrl: "https://acme.io",
          advertiserType: "direct",
          industry: "SaaS",
        },
      };

      const llmOutput = JSON.stringify({
        overall_score: 88,
        tech_stack_match: 90,
        seniority_match: 90,
        red_flags: [],
        reason: "Solid fit.",
        url: "https://example.com/meta",
        company_dossier: "B2B SaaS компания.",
      });

      const result = evaluateJob(llmOutput, job);
      expect(result.companyMeta).toEqual({
        size: "50-100",
        companyUrl: "https://acme.io",
        advertiserType: "direct",
        industry: "SaaS",
      });
    });

    it("scoring evaluateJob handles missing company_dossier gracefully", () => {
      const job = {
        id: "job-2",
        title: "Senior Frontend Engineer",
        company: "Acme",
        url: "https://example.com/2",
      };

      const llmOutput = JSON.stringify({
        overall_score: 80,
        tech_stack_match: 85,
        seniority_match: 85,
        red_flags: [],
        reason: "Good React match.",
        url: "https://example.com/2",
      });

      const result = evaluateJob(llmOutput, job);
      expect(result.company_dossier).toBeUndefined();
    });

    it("verifies promptfooconfig.yaml defines and asserts company_dossier", () => {
      const configPath = path.resolve(__dirname, "../../n8n/prompts/promptfooconfig.yaml");
      const content = fs.readFileSync(configPath, "utf-8");
      expect(content).toContain("company_dossier");
      expect(content).toContain("company_dossier: { type: string }");
      expect(content).toContain("typeof j.company_dossier === 'string'");
    });
  });
});
