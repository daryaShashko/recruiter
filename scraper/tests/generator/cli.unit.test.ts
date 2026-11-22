import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runCli } from '../../src/generator/cli';

describe('WP-5.1 & WP-5.3: CLI Tailored Application Bundle & Web-Form Mode', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-unit-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('runs with dryRun: false without dead email error and creates cv.pdf + pitch.txt + cover_letter.txt + manifest', async () => {
    const result = await runCli({
      dryRun: false,
      outDir: tempDir,
      job: {
        id: 'webform-job-1',
        title: 'Backend Lead — Node.js / PostgreSQL',
        company: 'CloudScale',
        url: 'https://justjoin.it/offers/cloudscale-backend-lead',
        body: 'Lead Node.js and PostgreSQL backend migration from Java/MySQL microservices.',
        tags: ['Node.js', 'PostgreSQL', 'Backend', 'TypeScript', 'Java Migration'],
      },
      bulletLimit: 4,
    });

    expect(result.success).toBe(true);
    expect(result.artifacts.cvPdf).toBeDefined();
    expect(result.artifacts.coverLetter).toBeDefined();
    expect(result.artifacts.pitch).toBeDefined();
    expect(result.artifacts.emailPackage).toBeDefined();

    expect(fs.existsSync(result.artifacts.cvPdf!)).toBe(true);
    expect(fs.existsSync(result.artifacts.coverLetter!)).toBe(true);
    expect(fs.existsSync(result.artifacts.pitch!)).toBe(true);
    expect(fs.existsSync(result.artifacts.emailPackage!)).toBe(true);

    expect(result.selectedBulletIds).toHaveLength(4);
    expect(result.emailPackage?.to).toBe('https://justjoin.it/offers/cloudscale-backend-lead');
    expect(result.emailPackage?.metadata.dryRun).toBe(false);
  }, 60000);

  test('produces distinct bullet ordering and cover letters for Backend Lead Node.js vs Full-Stack React/TypeScript', async () => {
    const backendRes = await runCli({
      dryRun: true,
      target: 'letter',
      outDir: tempDir,
      bulletLimit: 4,
      job: {
        id: 'backend-lead',
        title: 'Backend Lead — Node.js',
        company: 'AlphaBackend',
        url: 'https://example.com/backend',
        body: 'Migrate legacy Java/MySQL systems to Node.js and PostgreSQL.',
        tags: ['Node.js', 'PostgreSQL', 'Backend', 'Java Migration'],
      },
    });

    const frontendRes = await runCli({
      dryRun: true,
      target: 'letter',
      outDir: tempDir,
      bulletLimit: 4,
      job: {
        id: 'frontend-lead',
        title: 'Frontend Team Lead — React & React Native',
        company: 'BetaHealth',
        url: 'https://example.com/frontend',
        body: 'Lead frontend developers building React Native mobile medical apps and CI/CD pipelines.',
        tags: ['React', 'React Native', 'Team Lead', 'HealthTech', 'Firebase'],
      },
    });

    expect(backendRes.selectedBulletIds).not.toEqual(frontendRes.selectedBulletIds);
    const backendLetter = fs.readFileSync(backendRes.artifacts.coverLetter!, 'utf-8');
    const frontendLetter = fs.readFileSync(frontendRes.artifacts.coverLetter!, 'utf-8');
    const backendPitch = fs.readFileSync(backendRes.artifacts.pitch!, 'utf-8');
    const frontendPitch = fs.readFileSync(frontendRes.artifacts.pitch!, 'utf-8');

    expect(backendLetter).not.toBe(frontendLetter);
    expect(backendPitch).not.toBe(frontendPitch);
    expect(backendPitch).not.toMatch(/15%/);
    expect(frontendPitch).not.toMatch(/15%/);
  });
});
