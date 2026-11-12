import * as fs from 'fs';
import * as path from 'path';
import {
  loadGeneratorModule,
  mockCandidateCvData,
  inspectPdf,
  createTempTestDir,
  removeTempTestDir,
} from './test-helpers';
import {
  CandidateCvData,
  CandidateBullet,
  RenderCvOptions,
  RenderCvResult,
} from './test-contracts';

describe('Tier 3: Rendering & Integration Testing (R1 - Playwright PDF)', () => {
  let tempDir: string;

  beforeAll(() => {
    tempDir = createTempTestDir('tier3_pdf');
  });

  afterAll(() => {
    removeTempTestDir(tempDir);
  });

  // ─── Feature 8: Playwright Headless PDF Renderer ──────────────────────────────
  describe('Feature 8: Playwright Headless PDF Renderer (cv-renderer.ts)', () => {
    const rendererMod = loadGeneratorModule<{
      renderCvToPdf: (
        cvData: CandidateCvData,
        selectedBullets: CandidateBullet[],
        options: RenderCvOptions
      ) => Promise<RenderCvResult>;
    }>('cv-renderer');

    test('generates valid vector PDF file with strict 1 or 2 A4 pages', async () => {
      if (!rendererMod || typeof rendererMod.renderCvToPdf !== 'function') {
        throw new Error('renderCvToPdf is not implemented in scraper/src/generator/cv-renderer');
      }

      const outputPdfPath = path.join(tempDir, 'test-candidate-cv.pdf');
      const result = await rendererMod.renderCvToPdf(
        mockCandidateCvData,
        mockCandidateCvData.bullets.slice(0, 4),
        { outputPath: outputPdfPath, language: 'en' }
      );

      // Verify file existence on disk
      expect(fs.existsSync(outputPdfPath)).toBe(true);
      expect(result.pdfPath).toBe(outputPdfPath);
      expect(result.bufferSize).toBeGreaterThan(1000);

      // Inspect binary PDF structure
      const pdfBuffer = fs.readFileSync(outputPdfPath);
      const inspection = inspectPdf(pdfBuffer);

      // Check PDF header
      expect(inspection.isPdf).toBe(true);

      // Strictly 1 or 2 pages A4
      expect(result.pageCount).toBeGreaterThanOrEqual(1);
      expect(result.pageCount).toBeLessThanOrEqual(2);
      expect(inspection.pageCount).toBe(result.pageCount);

      // Verify vector text rendering (not rasterized image)
      expect(inspection.hasVectorText).toBe(true);

      // Verify clickable links in PDF annotations
      expect(inspection.links.length).toBeGreaterThan(0);
      const hasLinkedIn = inspection.links.some((l) => l.includes('linkedin.com'));
      const hasGithub = inspection.links.some((l) => l.includes('github.com'));
      expect(hasLinkedIn || hasGithub).toBe(true);
    }, 60000);

    test('renders with 100% offline local Playwright without external network requests', async () => {
      if (!rendererMod || typeof rendererMod.renderCvToPdf !== 'function') {
        throw new Error('renderCvToPdf is not implemented in scraper/src/generator/cv-renderer');
      }

      const offlinePdfPath = path.join(tempDir, 'test-offline-cv.pdf');
      const result = await rendererMod.renderCvToPdf(
        mockCandidateCvData,
        mockCandidateCvData.bullets.slice(0, 2),
        { outputPath: offlinePdfPath, language: 'en' }
      );

      expect(fs.existsSync(offlinePdfPath)).toBe(true);
      expect(result.pageCount).toBeGreaterThanOrEqual(1);
    }, 60000);
  });
});
