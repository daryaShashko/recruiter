import {
  loadGeneratorModule,
  mockCandidateCvData,
  mockJobOffers,
  countWords,
  findForbiddenStopWords,
  findForbiddenClichés,
} from './test-helpers';
import {
  CandidateCvData,
  CANONICAL_SKILLS_CATEGORIES,
  CoverLetterResult,
  EmailPackage,
} from './test-contracts';

describe('Tier 2: Contracts, Interfaces & Component Assembly (R1, R2, R3, R4)', () => {
  // ─── Feature 3: Notion Candidate Data Loader ──────────────────────────────────
  describe('Feature 3: Notion Candidate Data Loader (notion-loader.ts)', () => {
    const notionMod = loadGeneratorModule<{
      loadCandidateCvData: (offlineOnly?: boolean) => Promise<CandidateCvData>;
    }>('notion-loader');

    test('loads structured candidate CV data in offline fallback mode without network', async () => {
      if (!notionMod || typeof notionMod.loadCandidateCvData !== 'function') {
        throw new Error('loadCandidateCvData is not implemented in scraper/src/generator/notion-loader');
      }

      const cvData = await notionMod.loadCandidateCvData(true);

      expect(cvData).toBeDefined();
      expect(typeof cvData.contacts).toBe('object');
      expect(typeof cvData.summary).toBe('string');
      expect(Array.isArray(cvData.bullets)).toBe(true);
      expect(cvData.bullets.length).toBeGreaterThan(0);
      expect(typeof cvData.skills).toBe('object');
      expect(cvData.rodoClause).toBeDefined();
      expect(typeof cvData.rodoClause.pl).toBe('string');
      expect(typeof cvData.rodoClause.en).toBe('string');

      // Verify contact details
      expect(cvData.contacts.name).toBeTruthy();
      expect(cvData.contacts.location).toContain('Poland');
      expect(cvData.contacts.email).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
      expect(cvData.contacts.phone).toBeTruthy();
      expect(cvData.contacts.linkedIn).toContain('linkedin.com');
      expect(cvData.contacts.github).toContain('github.com');

      // Verify bullets structure
      for (const b of cvData.bullets) {
        expect(b).toHaveProperty('id');
        expect(b).toHaveProperty('title');
        expect(b).toHaveProperty('section');
        expect(b).toHaveProperty('highlight');
        expect(b).toHaveProperty('tags');
        expect(Array.isArray(b.tags)).toBe(true);
      }
    });
  });

  // ─── Feature 7: Single-Column Strict ATS HTML Layout ──────────────────────────
  describe('Feature 7: Single-Column Strict ATS HTML Layout (cv-renderer.ts / ats-template)', () => {
    const rendererMod = loadGeneratorModule<{
      generateCvHtml?: (cvData: CandidateCvData, bullets: any[]) => string;
      buildAtsHtml?: (cvData: CandidateCvData, bullets: any[]) => string;
    }>('cv-renderer');

    const getHtml = (): string => {
      if (rendererMod && typeof rendererMod.generateCvHtml === 'function') {
        return rendererMod.generateCvHtml(mockCandidateCvData, mockCandidateCvData.bullets);
      }
      if (rendererMod && typeof rendererMod.buildAtsHtml === 'function') {
        return rendererMod.buildAtsHtml(mockCandidateCvData, mockCandidateCvData.bullets);
      }
      throw new Error('generateCvHtml / buildAtsHtml is not implemented in cv-renderer');
    };

    test('strictly avoids HTML tables, rows, and cells for ATS compliance', () => {
      const html = getHtml();
      expect(html).not.toMatch(/<table\b/i);
      expect(html).not.toMatch(/<tr\b/i);
      expect(html).not.toMatch(/<td\b/i);
      expect(html).not.toMatch(/<th\b/i);
    });

    test('strictly avoids icons, SVG elements, and image avatars', () => {
      const html = getHtml();
      expect(html).not.toMatch(/<svg\b/i);
      expect(html).not.toMatch(/<img\b/i); // No photo
      expect(html).not.toMatch(/class="[^"]*(fa-|icon)[^"]*"/i);
    });

    test('strictly avoids graphical scales, progress bars, and meter elements', () => {
      const html = getHtml();
      expect(html).not.toMatch(/<progress\b/i);
      expect(html).not.toMatch(/<meter\b/i);
      expect(html).not.toMatch(/class="[^"]*skill-bar[^"]*"/i);
    });

    test('includes contact header with Name, Gdańsk, Poland, phone, email, LinkedIn, GitHub', () => {
      const html = getHtml();
      expect(html).toContain('Darya Shashko');
      expect(html).toContain('Gdańsk, Poland');
      expect(html).toContain('darya.shashko@example.com');
      expect(html).toContain('+48 500 000 000');
      expect(html).toContain('linkedin.com');
      expect(html).toContain('github.com');

      // Must NOT contain exact street address or age
      expect(html).not.toMatch(/ul\.\s+[A-Z]/i);
      expect(html).not.toMatch(/street/i);
      expect(html).not.toMatch(/\b(age|years old)\b/i);
    });

    test('includes "Environment / Tech Stack:" line under experience roles', () => {
      const html = getHtml();
      expect(html).toMatch(/Environment\s*\/\s*Tech Stack:/i);
    });

    test('includes Polish RODO clause at the end of the document', () => {
      const html = getHtml();
      expect(html).toMatch(/RODO/i);
      expect(html).toContain('Wyrażam zgodę na przetwarzanie');
    });

    test('configures CSS @page rule for A4 portrait with 10mm 12mm margins', () => {
      const html = getHtml();
      expect(html).toMatch(/@page\s*\{[^}]*size:\s*A4\s+portrait[^}]*\}/i);
      expect(html).toMatch(/margin:\s*10mm\s+12mm/i);
    });
  });

  // ─── Feature 9: Cover Letter 3-Block Generator ────────────────────────────────
  describe('Feature 9: Cover Letter 3-Block Generator (cover-letter.ts)', () => {
    const clMod = loadGeneratorModule<{
      generateCoverLetter: (
        cvData: CandidateCvData,
        options: {
          job: { title: string; company: string; body: string; tags?: string[] };
          language?: 'en' | 'pl';
        }
      ) => CoverLetterResult;
    }>('cover-letter');

    test('generates cover letter strictly between 130 and 180 words', () => {
      if (!clMod || typeof clMod.generateCoverLetter !== 'function') {
        throw new Error('generateCoverLetter is not implemented in scraper/src/generator/cover-letter');
      }

      const res = clMod.generateCoverLetter(mockCandidateCvData, {
        job: mockJobOffers.fullstackSenior,
      });

      expect(res).toBeDefined();
      expect(typeof res.text).toBe('string');

      const actualWordCount = countWords(res.text);
      expect(res.wordCount).toBe(actualWordCount);
      expect(actualWordCount).toBeGreaterThanOrEqual(130);
      expect(actualWordCount).toBeLessThanOrEqual(180);
    });

    test('generates 3 mandatory semantic blocks: Hook, Quantified Achievements, Logistics & CTA', () => {
      if (!clMod || typeof clMod.generateCoverLetter !== 'function') {
        throw new Error('generateCoverLetter is not implemented in scraper/src/generator/cover-letter');
      }

      const res = clMod.generateCoverLetter(mockCandidateCvData, {
        job: mockJobOffers.fullstackSenior,
      });

      // Block 1: Hook under JD target problem
      expect(res.text).toMatch(/Senior Full-Stack Engineer|FinTech Innovations/i);

      // Block 2: Quantified achievements with numbers/metrics & GenAI practice
      expect(res.text).toMatch(/\d+%/); // Metric e.g. 35%, 60%
      expect(res.text).toMatch(/TypeScript|Node\.js|Next\.js|PostgreSQL/);

      // Block 3: Logistics (Poland/Gdańsk, EU work authorization, B2B/UoP) + CTA
      expect(res.text).toMatch(/Poland|Gdańsk/i);
      expect(res.text).toMatch(/B2B|UoP/i);
      expect(res.text).toMatch(/call|discuss|conversation/i);
    });

    test('contains zero forbidden stop words and zero opening clichés', () => {
      if (!clMod || typeof clMod.generateCoverLetter !== 'function') {
        throw new Error('generateCoverLetter is not implemented in scraper/src/generator/cover-letter');
      }

      const res = clMod.generateCoverLetter(mockCandidateCvData, {
        job: mockJobOffers.fullstackSenior,
      });

      const foundStopWords = findForbiddenStopWords(res.text);
      const foundCliches = findForbiddenClichés(res.text);

      expect(foundStopWords).toEqual([]);
      expect(foundCliches).toEqual([]);
      expect(res.isValid).toBe(true);
      expect(res.validationErrors).toEqual([]);
    });
  });

  // ─── Feature 12: Email Apply Packager ─────────────────────────────────────────
  describe('Feature 12: Email Apply Packager (email-package.ts)', () => {
    const emailMod = loadGeneratorModule<{
      buildEmailPackage: (params: {
        job: { title: string; company: string; email?: string };
        coverLetter: string;
        pdfPath: string;
        dryRun?: boolean;
      }) => EmailPackage;
    }>('email-package');

    test('builds a complete EmailPackage manifest with recipient, subject, body, attachment', () => {
      if (!emailMod || typeof emailMod.buildEmailPackage !== 'function') {
        throw new Error('buildEmailPackage is not implemented in scraper/src/generator/email-package');
      }

      const dummyPdf = '/tmp/test-cv.pdf';
      const dummyLetter =
        'Experienced Senior Full-Stack Engineer applying to FinTech Innovations with verified results.';

      const pkg = emailMod.buildEmailPackage({
        job: mockJobOffers.fullstackSenior,
        coverLetter: dummyLetter,
        pdfPath: dummyPdf,
        dryRun: true,
      });

      expect(pkg).toBeDefined();
      expect(pkg.to).toBe('careers@fintechinnovations.example.com');
      expect(pkg.subject).toContain('Senior Full-Stack Engineer');
      expect(pkg.body).toBe(dummyLetter);
      expect(pkg.attachments).toContain(dummyPdf);

      // Metadata verification
      expect(pkg.metadata).toBeDefined();
      expect(pkg.metadata.company).toBe('FinTech Innovations Sp. z o.o.');
      expect(pkg.metadata.jobTitle).toBe('Senior Full-Stack Engineer');
      expect(pkg.metadata.channel).toBe('email_apply');
      expect(pkg.metadata.dryRun).toBe(true);
      expect(pkg.metadata.pdfPath).toBe(dummyPdf);
      expect(pkg.metadata.generatedAt).toBeTruthy();
    });
  });
});
