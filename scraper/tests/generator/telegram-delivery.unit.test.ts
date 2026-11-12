import * as fs from 'fs';
import * as path from 'path';
import {
  generateLinkedInPitch,
  countWords,
  findStopWords,
} from '../../src/generator/cover-letter';
import {
  getBaseCvPdf,
} from '../../src/generator/cv-renderer';
import {
  buildTelegramApplicationPackage,
  formatTelegramDeliveryHtml,
} from '../../src/generator/telegram-delivery';
import { DEFAULT_CANDIDATE_CV_DATA } from '../../src/generator/notion-loader';

describe('Telegram In-Thread Application Delivery (Slice 3)', () => {
  const sampleJob = {
    title: 'Senior TypeScript Engineer',
    company: 'FinTech Innovations Sp. z o.o.',
    body: 'We are seeking a Senior TypeScript Engineer to lead core payments and high-load microservices.',
    tags: ['TypeScript', 'Node.js', 'React', 'PostgreSQL'],
  };

  describe('generateLinkedInPitch', () => {
    it('generates tailored English outreach pitch within 60-80 words', () => {
      const pitch = generateLinkedInPitch(DEFAULT_CANDIDATE_CV_DATA, {
        job: sampleJob,
        contactName: 'Alex',
        language: 'en',
      });

      expect(pitch.isValid).toBe(true);
      expect(pitch.language).toBe('en');
      expect(pitch.text).toContain('Hi Alex,');
      expect(pitch.text).toContain('Senior TypeScript Engineer');
      expect(pitch.text).toContain('FinTech Innovations Sp. z o.o.');
      expect(pitch.text).toContain('15%');
      expect(pitch.text).toContain('B2B/UoP');
      expect(pitch.text).toContain('Darya Shashko');

      // Word count check
      expect(pitch.wordCount).toBeGreaterThanOrEqual(55);
      expect(pitch.wordCount).toBeLessThanOrEqual(85);

      // Verify no forbidden stop words
      const stopWords = findStopWords(pitch.text);
      expect(stopWords).toHaveLength(0);
    });

    it('generates tailored Polish outreach pitch within expected word range', () => {
      const polishJob = {
        title: 'Senior Full-Stack Developer',
        company: 'Polska Grupa IT',
        body: 'Szukamy programisty z dobrą znajomością TypeScript i React.',
      };

      const pitch = generateLinkedInPitch(DEFAULT_CANDIDATE_CV_DATA, {
        job: polishJob,
        language: 'pl',
      });

      expect(pitch.isValid).toBe(true);
      expect(pitch.language).toBe('pl');
      expect(pitch.text).toContain('Dzień dobry,');
      expect(pitch.text).toContain('Polska Grupa IT');
      expect(pitch.text).toContain('Trójmieście');
      expect(pitch.text).toContain('B2B/UoP');
      expect(pitch.text).toContain('15%');

      expect(pitch.wordCount).toBeGreaterThanOrEqual(55);
      expect(pitch.wordCount).toBeLessThanOrEqual(85);

      const stopWords = findStopWords(pitch.text);
      expect(stopWords).toHaveLength(0);
    });

    it('auto-detects Polish language from job description', () => {
      const polishJob = {
        title: 'Programista Node.js',
        company: 'Software House',
        body: 'Wymagania: bardzo dobra znajomość JavaScript oraz frameworka NestJS. Praca w Trójmieście lub zdalnie. Dołącz do naszego zespołu, oferujemy świetną atmosferę i rozwój.',
      };

      const pitch = generateLinkedInPitch(DEFAULT_CANDIDATE_CV_DATA, {
        job: polishJob,
      });

      expect(pitch.language).toBe('pl');
    });
  });

  describe('getBaseCvPdf', () => {
    it('serves cached PDF instantly without re-rendering if file exists', async () => {
      const testDir = path.resolve(__dirname, '../../output/test_cache');
      if (!fs.existsSync(testDir)) {
        fs.mkdirSync(testDir, { recursive: true });
      }
      const fakePdf = path.join(testDir, 'cached_cv.pdf');
      fs.writeFileSync(fakePdf, Buffer.from('%PDF-1.4 test dummy stream'));

      const result = await getBaseCvPdf(DEFAULT_CANDIDATE_CV_DATA, {
        cachedPdfPath: fakePdf,
      });

      expect(result.fromCache).toBe(true);
      expect(result.pdfPath).toBe(fakePdf);
      expect(result.buffer.toString()).toContain('%PDF-1.4');

      // Cleanup
      if (fs.existsSync(fakePdf)) {
        fs.unlinkSync(fakePdf);
      }
    });
  });

  describe('buildTelegramApplicationPackage', () => {
    it('assembles full delivery package with pitch, cover letter, and Applied status patch', async () => {
      const testPdfPath = path.resolve(__dirname, '../../output/test_app_cv.pdf');
      const testDir = path.dirname(testPdfPath);
      if (!fs.existsSync(testDir)) {
        fs.mkdirSync(testDir, { recursive: true });
      }
      fs.writeFileSync(testPdfPath, Buffer.from('%PDF-1.4 sample'));

      const pkg = await buildTelegramApplicationPackage({
        pageId: '36c747f7-ebec-80c8-bfd7-ed317f4a7c35',
        job: sampleJob,
        pdfPath: testPdfPath,
      });

      expect(pkg.pageId).toBe('36c747f7ebec80c8bfd7ed317f4a7c35');
      expect(pkg.company).toBe('FinTech Innovations Sp. z o.o.');
      expect(pkg.jobTitle).toBe('Senior TypeScript Engineer');
      expect(pkg.pdfPath).toBe(testPdfPath);

      // Pitch and Cover letter checks
      expect(pkg.pitch.isValid).toBe(true);
      expect(pkg.coverLetter.isValid).toBe(true);

      // Notion Status transition check
      expect(pkg.notionStatusPatch).toEqual({
        properties: {
          Status: {
            select: {
              name: 'Applied',
            },
          },
        },
      });

      // Telegram messages check
      expect(pkg.telegramMessages.documentCaption).toContain('FinTech Innovations Sp. z o.o.');
      expect(pkg.telegramMessages.textMessageHtml).toContain('<code>');
      expect(pkg.telegramMessages.textMessageHtml).toContain('LinkedIn Outreach Pitch');
      expect(pkg.telegramMessages.textMessageHtml).toContain('Cover Letter');
      expect(pkg.telegramMessages.textMessageHtml).toContain('Applied');

      // Cleanup
      if (fs.existsSync(testPdfPath)) {
        fs.unlinkSync(testPdfPath);
      }
    });
  });

  describe('formatTelegramDeliveryHtml', () => {
    it('escapes special characters and embeds texts in code blocks', () => {
      const html = formatTelegramDeliveryHtml(
        'A & B <Corp>',
        'Lead "Engineer"',
        'Pitch: Hi & connect!',
        'Cover letter: Experience with <Node.js> & TypeScript'
      );

      expect(html).toContain('A &amp; B &lt;Corp&gt;');
      expect(html).toContain('Lead &quot;Engineer&quot;');
      expect(html).toContain('<code>Pitch: Hi &amp; connect!</code>');
      expect(html).toContain('<code>Cover letter: Experience with &lt;Node.js&gt; &amp; TypeScript</code>');
    });
  });
});
