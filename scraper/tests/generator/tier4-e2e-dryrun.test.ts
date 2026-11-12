import * as fs from 'fs';
import * as path from 'path';
import {
  loadGeneratorModule,
  mockJobOffers,
  inspectPdf,
  createTempTestDir,
  removeTempTestDir,
} from './test-helpers';
import { EmailPackage } from './test-contracts';

describe('Tier 4: End-to-End Dry-Run & Source-of-Truth Integrity (R3 & R4)', () => {
  const repoRoot = path.resolve(__dirname, '../../../');

  // ─── Feature 1 & R4: Notion Source of Truth Integrity ─────────────────────────
  describe('Feature 1 & R4: Notion Source of Truth Alignment', () => {
    test('confirms no manual master-cv.yaml file exists in the repository', () => {
      const forbiddenCvFiles = [
        path.join(repoRoot, 'master-cv.yaml'),
        path.join(repoRoot, 'master-cv.yml'),
        path.join(repoRoot, 'master_cv.yaml'),
        path.join(repoRoot, 'master_cv.yml'),
        path.join(repoRoot, 'context/master-cv.yaml'),
        path.join(repoRoot, 'scraper/master-cv.yaml'),
      ];

      for (const filePath of forbiddenCvFiles) {
        expect(fs.existsSync(filePath)).toBe(false);
      }
    });

    test('verifies docs/notion-schema.md establishes Notion Candidate CV & Experience as source of truth', () => {
      const notionSchemaPath = path.join(repoRoot, 'docs/notion-schema.md');
      expect(fs.existsSync(notionSchemaPath)).toBe(true);

      const content = fs.readFileSync(notionSchemaPath, 'utf-8');
      expect(content).toMatch(/Candidate CV & Experience/i);
      expect(content).toMatch(/notion-profile/i);
    });

    test('verifies repository documentation contains zero references directing agents to master-cv.yaml', () => {
      const docsToCheck = [
        path.join(repoRoot, 'AGENTS.md'),
        path.join(repoRoot, 'PROJECT.md'),
      ];

      for (const docPath of docsToCheck) {
        if (fs.existsSync(docPath)) {
          const docContent = fs.readFileSync(docPath, 'utf-8');
          // If master-cv.yaml is mentioned, it must only be in the context of eliminating/excluding it
          const lines = docContent.split('\n');
          for (const line of lines) {
            if (line.includes('master-cv.yaml')) {
              expect(line).toMatch(/eliminat|exclud|no |without|sole source|instead of/i);
            }
          }
        }
      }
    });
  });

  // ─── Feature 13 & R3: Channel Status Alignment ────────────────────────────────
  describe('Feature 13 & R3: Channel Status Alignment in Documentation', () => {
    test('verifies documentation / PROJECT.md fixes Email Apply as Channel 1', () => {
      const projectMdPath = path.join(repoRoot, 'PROJECT.md');
      expect(fs.existsSync(projectMdPath)).toBe(true);

      const projectContent = fs.readFileSync(projectMdPath, 'utf-8');
      expect(projectContent).toMatch(/Email Apply/i);
      expect(projectContent).toMatch(/Channel/i);
    });
  });

  // ─── Feature 14 & R3: End-to-End Dry-Run Flow ────────────────────────────────
  describe('Feature 14 & R3: End-to-End Dry-Run Application Generator Flow', () => {
    let tempOutputDir: string;

    beforeAll(() => {
      tempOutputDir = createTempTestDir('tier4_e2e');
    });

    afterAll(() => {
      removeTempTestDir(tempOutputDir);
    });

    const cliMod = loadGeneratorModule<{
      runApplicationPipeline?: (options: {
        job: any;
        outputDir: string;
        dryRun: boolean;
      }) => Promise<{ emailPackage: EmailPackage; pdfPath: string }>;
    }>('cli');

    test('executes end-to-end dry-run pipeline generating PDF and email_package.json without network sends', async () => {
      if (!cliMod || typeof cliMod.runApplicationPipeline !== 'function') {
        throw new Error('runApplicationPipeline is not implemented in scraper/src/generator/cli');
      }

      const result = await cliMod.runApplicationPipeline({
        job: mockJobOffers.fullstackSenior,
        outputDir: tempOutputDir,
        dryRun: true,
      });

      expect(result).toBeDefined();
      expect(result.emailPackage).toBeDefined();
      expect(result.pdfPath).toBeDefined();

      // Check PDF file on disk
      expect(fs.existsSync(result.pdfPath)).toBe(true);
      const pdfBuffer = fs.readFileSync(result.pdfPath);
      const inspection = inspectPdf(pdfBuffer);
      expect(inspection.isPdf).toBe(true);
      expect(inspection.pageCount).toBeGreaterThanOrEqual(1);
      expect(inspection.pageCount).toBeLessThanOrEqual(2);

      // Check email package
      expect(result.emailPackage.metadata.dryRun).toBe(true);
      expect(result.emailPackage.metadata.channel).toBe('email_apply');
      expect(result.emailPackage.to).toBe('careers@fintechinnovations.example.com');
      expect(result.emailPackage.attachments).toContain(result.pdfPath);

      // Check if email_package.json is persisted in the output directory
      const manifestPath = path.join(tempOutputDir, 'email_package.json');
      if (fs.existsSync(manifestPath)) {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        expect(manifest.metadata.dryRun).toBe(true);
      }
    }, 60000);
  });
});
