import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as zlib from 'zlib';
import {
  renderCvToPdf,
  generateCvHtml,
  formatContactLinks,
  formatExperienceHtml,
  extractPdfPageCount,
  getCvCss,
  acquireBrowserSession,
} from '../../src/generator/cv-renderer';
import {
  CandidateBullet,
  CandidateCvData,
  CandidateContacts,
} from '../../src/generator/types';
import {
  loadCandidateCvData,
  DEFAULT_RODO_CLAUSE,
} from '../../src/generator/notion-loader';

describe('Empirical Challenger M2-2: Playwright Headless PDF Renderer Stress Testing', () => {
  let tempDir: string;
  let masterCvData: CandidateCvData;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'challenger-m2-2-'));
    masterCvData = await loadCandidateCvData(true);
  }, 30000);

  afterAll(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SUITE 1: PAGE BUDGETING (1 bullet, 5 bullets, 12 bullets, strict 1-2 pages)
  // ═══════════════════════════════════════════════════════════════════════════
  describe('1. Page Budgeting Stress Tests (1 bullet, 5 bullets, 12 bullets)', () => {
    test('1.1 renders with 1 bullet and strictly produces 1 A4 page', async () => {
      const pdfPath = path.join(tempDir, 'cv-1-bullet.pdf');
      const singleBullet = masterCvData.bullets.slice(0, 1);

      const result = await renderCvToPdf(masterCvData, singleBullet, {
        outputPath: pdfPath,
        language: 'en',
      });

      expect(fs.existsSync(pdfPath)).toBe(true);
      expect(result.pdfPath).toBe(pdfPath);
      expect(result.pageCount).toBe(1);
      expect(result.bufferSize).toBeGreaterThan(10000);

      // Verify physical PDF page count via binary inspection
      const pdfBuffer = fs.readFileSync(pdfPath);
      const physicalPages = extractPdfPageCount(pdfBuffer);
      expect(physicalPages).toBe(1);
    }, 60000);

    test('1.2 renders with 5 bullets and strictly produces 1 or 2 A4 pages', async () => {
      const pdfPath = path.join(tempDir, 'cv-5-bullets.pdf');
      const fiveBullets = masterCvData.bullets.slice(0, 5);

      const result = await renderCvToPdf(masterCvData, fiveBullets, {
        outputPath: pdfPath,
        language: 'en',
      });

      expect(fs.existsSync(pdfPath)).toBe(true);
      expect(result.pageCount).toBeGreaterThanOrEqual(1);
      expect(result.pageCount).toBeLessThanOrEqual(2);

      const pdfBuffer = fs.readFileSync(pdfPath);
      const physicalPages = extractPdfPageCount(pdfBuffer);
      expect(physicalPages).toBe(result.pageCount);
    }, 60000);

    test('1.3 renders with 12 bullets (full Master CV) and strictly produces 1 or 2 A4 pages', async () => {
      const pdfPath = path.join(tempDir, 'cv-12-bullets.pdf');
      const twelveBullets = masterCvData.bullets.slice(0, 12);

      const result = await renderCvToPdf(masterCvData, twelveBullets, {
        outputPath: pdfPath,
        language: 'en',
      });

      expect(fs.existsSync(pdfPath)).toBe(true);
      expect(result.pageCount).toBeGreaterThanOrEqual(1);
      expect(result.pageCount).toBeLessThanOrEqual(2);

      const pdfBuffer = fs.readFileSync(pdfPath);
      const physicalPages = extractPdfPageCount(pdfBuffer);
      expect(physicalPages).toBe(result.pageCount);
    }, 60000);

    test('1.4 strictly compresses to 1 page when pageLimit: 1 is explicitly requested for 12 bullets', async () => {
      const pdfPath = path.join(tempDir, 'cv-12-bullets-limit1.pdf');
      const twelveBullets = masterCvData.bullets.slice(0, 12);

      const result = await renderCvToPdf(masterCvData, twelveBullets, {
        outputPath: pdfPath,
        language: 'en',
        pageLimit: 1,
      });

      expect(fs.existsSync(pdfPath)).toBe(true);
      expect(result.pageCount).toBe(1);

      const pdfBuffer = fs.readFileSync(pdfPath);
      const physicalPages = extractPdfPageCount(pdfBuffer);
      expect(physicalPages).toBe(1);
    }, 60000);

    test('1.5 renders with 20 synthetic long bullets under pageLimit: 2 without exceeding budget', async () => {
      const pdfPath = path.join(tempDir, 'cv-20-bullets.pdf');
      const heavyBullets: CandidateBullet[] = Array.from({ length: 20 }, (_, i) => ({
        id: `heavy-bullet-${i}`,
        title: `Senior Role ${i}`,
        section: 'Work Experience',
        highlight: `Led architectural overhaul of distributed payments microservice #${i}, reducing p99 latency by 35% with Node.js, TypeScript, PostgreSQL, and Redis caching.`,
        tags: ['TypeScript', 'Node.js', 'PostgreSQL', 'Redis'],
        period: '2022 - 2024',
        order: i,
      }));

      const result = await renderCvToPdf(masterCvData, heavyBullets, {
        outputPath: pdfPath,
        language: 'en',
        pageLimit: 2,
      });

      expect(result.pageCount).toBeLessThanOrEqual(2);
      expect(result.pageCount).toBeGreaterThanOrEqual(1);
    }, 60000);

    test('1.6 enforces hard budget error when content cannot fit into requested page limit', async () => {
      const pdfPath = path.join(tempDir, 'cv-60-bullets.pdf');
      const massiveBullets: CandidateBullet[] = Array.from({ length: 60 }, (_, i) => ({
        id: `massive-bullet-${i}`,
        title: `Massive Engineering Role ${i}`,
        section: 'Work Experience',
        highlight: `Bullet ${i}: Architected scalable high-throughput microservices handling millions of requests with Node.js, TypeScript, PostgreSQL, and distributed caching, reducing latency by 40% and improving resilience across distributed regions.`,
        tags: ['TypeScript', 'Node.js', 'PostgreSQL'],
        period: '2020 - 2024',
        order: i,
      }));

      await expect(
        renderCvToPdf(masterCvData, massiveBullets, {
          outputPath: pdfPath,
          language: 'en',
          pageLimit: 2,
        })
      ).rejects.toThrow(/exceeds page budget/i);
    }, 60000);

    test('1.7 extractPdfPageCount accurately extracts page count across multiple PDF structures', () => {
      // Empty or invalid buffer defaults to 1
      expect(extractPdfPageCount(Buffer.alloc(0))).toBe(1);
      expect(extractPdfPageCount(null as any)).toBe(1);

      // Synthetic PDF with /Type /Pages /Count 2
      const synthetic2Pages = Buffer.from(
        '%PDF-1.4\n1 0 obj\n<</Type /Pages /Count 2 /Kids [2 0 R 3 0 R]>>\nendobj\n',
        'utf-8'
      );
      expect(extractPdfPageCount(synthetic2Pages)).toBe(2);

      // Synthetic PDF with /Type /Pages /Count 1
      const synthetic1Page = Buffer.from(
        '%PDF-1.4\n1 0 obj\n<</Type /Pages /Count 1 /Kids [2 0 R]>>\nendobj\n',
        'utf-8'
      );
      expect(extractPdfPageCount(synthetic1Page)).toBe(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SUITE 2: VECTOR TEXT AND PDF STRUCTURE INTEGRITY
  // ═══════════════════════════════════════════════════════════════════════════
  describe('2. Vector Text & PDF Binary Integrity', () => {
    let samplePdfBuffer: Buffer;

    beforeAll(async () => {
      const pdfPath = path.join(tempDir, 'cv-vector-test.pdf');
      await renderCvToPdf(masterCvData, masterCvData.bullets.slice(0, 4), {
        outputPath: pdfPath,
        language: 'pl',
      });
      samplePdfBuffer = fs.readFileSync(pdfPath);
    }, 60000);

    test('2.1 PDF binary starts with valid %PDF- header and version >= 1.4', () => {
      const header = samplePdfBuffer.slice(0, 10).toString('utf-8');
      expect(header.startsWith('%PDF-')).toBe(true);

      const versionMatch = header.match(/%PDF-(\d+\.\d+)/);
      expect(versionMatch).not.toBeNull();
      const versionNum = parseFloat(versionMatch![1]);
      expect(versionNum).toBeGreaterThanOrEqual(1.4);
    });

    test('2.2 PDF embeds vector font definitions with ToUnicode mappings', () => {
      const raw = samplePdfBuffer.toString('latin1');

      // Check /Type /Font definitions
      const fontCount = (raw.match(/\/Type\s*\/Font\b/g) || []).length;
      expect(fontCount).toBeGreaterThan(0);

      // Check /ToUnicode mappings for text extraction
      const toUnicodeCount = (raw.match(/\/ToUnicode\b/g) || []).length;
      expect(toUnicodeCount).toBeGreaterThan(0);
    });

    test('2.3 decompressed PDF content stream contains BT (Begin Text) / ET (End Text) operators', () => {
      const raw = samplePdfBuffer.toString('latin1');
      const streamRegex = /<<[\s\S]*?\/Filter\s*\/FlateDecode[\s\S]*?>>\s*stream\r?\n([\s\S]*?)\r?\nendstream/g;

      let foundBtEt = false;
      let streamMatch: RegExpExecArray | null;

      while ((streamMatch = streamRegex.exec(raw)) !== null) {
        try {
          const streamBuf = Buffer.from(streamMatch[1], 'binary');
          const decompressed = zlib.inflateSync(streamBuf).toString('utf-8');
          if (decompressed.includes('BT') && decompressed.includes('ET')) {
            foundBtEt = true;
            break;
          }
        } catch {
          // Skip non-deflate or image streams
        }
      }

      expect(foundBtEt).toBe(true);
    });

    test('2.4 verifies PDF does NOT contain full-page screenshot bitmaps to fake ATS text', () => {
      const raw = samplePdfBuffer.toString('latin1');
      // Look for full-page images (A4 in 72dpi is 595x842, 300dpi is 2480x3508)
      const objRegex = /(\d+ \d+ obj[\s\S]*?endobj)/g;
      let objMatch: RegExpExecArray | null;

      while ((objMatch = objRegex.exec(raw)) !== null) {
        const obj = objMatch[1];
        if (obj.includes('/Subtype /Image')) {
          const widthMatch = obj.match(/\/Width\s+(\d+)/);
          const heightMatch = obj.match(/\/Height\s+(\d+)/);
          if (widthMatch && heightMatch) {
            const w = parseInt(widthMatch[1], 10);
            const h = parseInt(heightMatch[1], 10);
            // Full page images would be >= 500x700
            const isFullPageRaster = w >= 500 && h >= 700;
            expect(isFullPageRaster).toBe(false);
          }
        }
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SUITE 3: CLICKABLE LINKS & ANNOTATIONS INTEGRITY
  // ═══════════════════════════════════════════════════════════════════════════
  describe('3. Clickable Links & Annotations Integrity', () => {
    let pdfBuffer: Buffer;
    let rawPdf: string;
    let extractedUris: string[];

    beforeAll(async () => {
      const pdfPath = path.join(tempDir, 'cv-links-test.pdf');
      await renderCvToPdf(masterCvData, masterCvData.bullets.slice(0, 3), {
        outputPath: pdfPath,
        language: 'en',
      });
      pdfBuffer = fs.readFileSync(pdfPath);
      rawPdf = pdfBuffer.toString('latin1');

      extractedUris = [];
      for (const m of rawPdf.matchAll(/\/URI\s*\(([^)]+)\)/g)) {
        extractedUris.push(m[1]);
      }
    }, 60000);

    test('3.1 contains PDF link annotations (/Subtype /Link)', () => {
      const linkCount = (rawPdf.match(/\/Subtype\s*\/Link\b/g) || []).length;
      expect(linkCount).toBeGreaterThanOrEqual(3);
    });

    test('3.2 contains valid clickable mailto: link for candidate email', () => {
      const email = masterCvData.contacts.email;
      const expectedMailto = `mailto:${email}`;
      const found = extractedUris.some((u) => u.toLowerCase() === expectedMailto.toLowerCase());
      expect(found).toBe(true);
    });

    test('3.3 contains valid clickable https:// links for LinkedIn and GitHub', () => {
      const hasLinkedIn = extractedUris.some(
        (u) => u.includes('linkedin.com') && u.startsWith('https://')
      );
      const hasGithub = extractedUris.some(
        (u) => u.includes('github.com') && u.startsWith('https://')
      );

      expect(hasLinkedIn).toBe(true);
      expect(hasGithub).toBe(true);
    });

    test('3.4 contains clickable tel: link with normalized numeric digits', () => {
      const hasTel = extractedUris.some((u) => u.startsWith('tel:'));
      expect(hasTel).toBe(true);
    });

    test('3.5 formatContactLinks handles sparse or missing contact fields without broken tags', () => {
      const sparseContacts: CandidateContacts = {
        name: 'Sparse Candidate',
        location: 'Gdańsk, Poland',
        email: 'sparse@example.com',
        phone: '',
        linkedIn: '',
        github: '',
      };

      const html = formatContactLinks(sparseContacts);
      expect(html).toContain('sparse@example.com');
      expect(html).toContain('Gdańsk, Poland');
      expect(html).not.toContain('tel:');
      expect(html).not.toContain('linkedin.com');
      expect(html).not.toContain('github.com');
      expect(html).not.toContain('undefined');
      expect(html).not.toContain('null');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SUITE 4: SINGLE-COLUMN STRICT ATS HTML COMPLIANCE
  // ═══════════════════════════════════════════════════════════════════════════
  describe('4. Single-Column Strict ATS HTML Compliance', () => {
    let generatedHtml: string;

    beforeAll(() => {
      generatedHtml = generateCvHtml(masterCvData, masterCvData.bullets.slice(0, 5), {
        language: 'pl',
      });
    });

    test('4.1 strictly zero <table>, <tr>, <td>, <th> elements', () => {
      expect(generatedHtml).not.toMatch(/<table[\s>]/i);
      expect(generatedHtml).not.toMatch(/<\/table>/i);
      expect(generatedHtml).not.toMatch(/<tr[\s>]/i);
      expect(generatedHtml).not.toMatch(/<td[\s>]/i);
      expect(generatedHtml).not.toMatch(/<th[\s>]/i);
    });

    test('4.2 strictly zero inline <svg> elements and zero <img> avatar tags', () => {
      expect(generatedHtml).not.toMatch(/<svg[\s>]/i);
      expect(generatedHtml).not.toMatch(/<\/svg>/i);
      expect(generatedHtml).not.toMatch(/<img[\s>]/i);
    });

    test('4.3 strictly zero icon fonts (fa-, icon-, glyphicon)', () => {
      expect(generatedHtml).not.toMatch(/class="[^"]*(fa-|icon-|glyphicon)[^"]*"/i);
    });

    test('4.4 strictly zero graphical scales, progress bars, or meter elements', () => {
      expect(generatedHtml).not.toMatch(/<progress[\s>]/i);
      expect(generatedHtml).not.toMatch(/<meter[\s>]/i);
      expect(generatedHtml).not.toMatch(/skill-bar/i);
      expect(generatedHtml).not.toMatch(/fill-bar/i);
    });

    test('4.5 contact header strictly excludes exact street address, age, and marital status', () => {
      expect(generatedHtml).toContain('Darya Shashko');
      expect(generatedHtml).toContain('Gdańsk, Poland');
      expect(generatedHtml).not.toMatch(/ul\.\s+[A-Z]/i);
      expect(generatedHtml).not.toMatch(/street\s+[A-Z]/i);
      expect(generatedHtml).not.toMatch(/\b(age|years old|urodzon|lat|marital|married|single)\b/i);
    });

    test('4.6 includes mandatory "Environment / Tech Stack:" line under every role', () => {
      expect(generatedHtml).toMatch(/<strong>Environment \/ Tech Stack:<\/strong>/i);
      // Under each rendered role div
      const roleMatches = generatedHtml.match(/<div class="experience-item">/g) || [];
      const stackMatches = generatedHtml.match(/class="tech-stack-line"/g) || [];
      expect(roleMatches.length).toBeGreaterThan(0);
      expect(stackMatches.length).toBe(roleMatches.length);
    });

    test('4.7 CSS print stylesheet specifies A4 portrait and proper page margins', () => {
      const standardCss = getCvCss({ compact: false });
      expect(standardCss).toContain('size: A4 portrait;');
      expect(standardCss).toContain('margin: 10mm 12mm;');

      const compactCss = getCvCss({ compact: true });
      expect(compactCss).toContain('size: A4 portrait;');
      expect(compactCss).toContain('margin: 8mm 10mm;');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SUITE 5: POLISH RODO CLAUSE PRESENCE & REGULATORY CHECKS
  // ═══════════════════════════════════════════════════════════════════════════
  describe('5. Polish RODO Clause Presence & Language Selection', () => {
    test('5.1 includes statutory Polish RODO clause when language is pl', () => {
      const htmlPl = generateCvHtml(masterCvData, masterCvData.bullets.slice(0, 3), {
        language: 'pl',
      });

      expect(htmlPl).toContain('rodo-clause');
      expect(htmlPl).toContain(DEFAULT_RODO_CLAUSE.pl);
      expect(htmlPl).toContain('RODO');
      expect(htmlPl).toContain('2016/679');
    });

    test('5.2 includes GDPR clause when language is en', () => {
      const htmlEn = generateCvHtml(masterCvData, masterCvData.bullets.slice(0, 3), {
        language: 'en',
      });

      expect(htmlEn).toContain('rodo-clause');
      expect(htmlEn).toContain(DEFAULT_RODO_CLAUSE.en);
      expect(htmlEn).toContain('GDPR');
      expect(htmlEn).toContain('2016/679');
    });

    test('5.3 RODO clause is positioned in document footer at the bottom', () => {
      const html = generateCvHtml(masterCvData, masterCvData.bullets.slice(0, 3));
      const footerIndex = html.indexOf('<footer class="rodo-clause">');
      const experienceIndex = html.indexOf('cv-experience');

      expect(footerIndex).toBeGreaterThan(experienceIndex);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SUITE 6: ADVERSARIAL STRESS, XSS ESCAPING, CONCURRENCY & CLEANUP
  // ═══════════════════════════════════════════════════════════════════════════
  describe('6. Adversarial Stress, Escaping & Resource Lifecycle', () => {
    test('6.1 safely escapes malicious XSS payloads in candidate contacts and highlights', async () => {
      const xssCvData: CandidateCvData = {
        contacts: {
          name: 'Jane <script>alert("xss")</script> Doe',
          location: 'Gdańsk <img src=x onerror=alert(1)>',
          phone: '+48 500 111 222',
          email: 'jane"onclick="alert(1)@example.com',
          linkedIn: 'https://linkedin.com/in/jane?a=1&b=2<script>',
          github: 'https://github.com/jane?q="test"',
        },
        summary: 'Expert in <b onmouseover=alert(1)>Web Security</b> & Cloud.',
        bullets: [
          {
            id: 'xss-bullet-1',
            title: 'Lead Architect <script>evil()</script>',
            section: 'Experience',
            highlight: 'Refactored backend <svg onload=alert(1)> reducing memory by 20% & latency by 40%.',
            tags: ['<tag>', 'Node.js & Express'],
            period: '2022 < 2024',
            order: 1,
          },
        ],
        skills: {
          'Core Languages & Frameworks': ['TypeScript & JavaScript', '<script>alert(1)</script>'],
        },
        rodoClause: DEFAULT_RODO_CLAUSE,
      };

      const html = generateCvHtml(xssCvData, xssCvData.bullets);

      // Verify unescaped dangerous tags do NOT exist
      expect(html).not.toContain('<script>alert("xss")</script>');
      expect(html).not.toContain('<img src=x onerror=alert(1)>');
      expect(html).not.toContain('<svg onload=alert(1)>');

      // Verify proper HTML entity replacements
      expect(html).toContain('&lt;script&gt;');
      expect(html).toContain('&amp;');

      // Render to PDF to ensure Chromium does not crash on escaped entities
      const xssPdfPath = path.join(tempDir, 'cv-xss.pdf');
      const res = await renderCvToPdf(xssCvData, xssCvData.bullets, {
        outputPath: xssPdfPath,
      });
      expect(res.pageCount).toBe(1);
      expect(fs.existsSync(xssPdfPath)).toBe(true);
    }, 60000);

    test('6.2 concurrent PDF rendering succeeds without browser instance deadlocks', async () => {
      const renderTasks = [1, 2, 3].map((idx) => {
        const outPath = path.join(tempDir, `cv-concurrent-${idx}.pdf`);
        return renderCvToPdf(masterCvData, masterCvData.bullets.slice(0, idx * 2), {
          outputPath: outPath,
          language: idx % 2 === 0 ? 'pl' : 'en',
        });
      });

      const results = await Promise.all(renderTasks);
      expect(results.length).toBe(3);
      for (let i = 0; i < 3; i++) {
        expect(results[i].pageCount).toBeGreaterThanOrEqual(1);
        expect(results[i].pageCount).toBeLessThanOrEqual(2);
        expect(fs.existsSync(results[i].pdfPath)).toBe(true);
      }
    }, 60000);

    test('6.3 acquireBrowserSession handles custom injected browser properly', async () => {
      const session = await acquireBrowserSession();
      expect(session.browser).toBeDefined();
      expect(session.page).toBeDefined();
      expect(session.isShared).toBe(false);

      // Clean up
      await session.page.close();
      await session.context.close();
      await session.browser.close();
    });
  });
});
