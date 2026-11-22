import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  buildEmailPackage,
  extractRecipientEmail,
  saveEmailPackage,
} from '../../src/generator/email-package';

describe('WP-5.3: Web-Form Application Package without Empty `to: ""` Blocker', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'email-package-unit-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('resolves web-form URL as `to` target instead of empty string when job has no direct email', () => {
    const webUrl = 'https://nofluffjobs.com/job/tech-lead-typescript-gdansk';
    const recipient = extractRecipientEmail({ url: webUrl });
    expect(recipient).toBe(webUrl);
    expect(recipient.length).toBeGreaterThan(0);

    const fallbackRecipient = extractRecipientEmail({});
    expect(fallbackRecipient).toBe('web_form');
  });

  test('builds ready-to-use web-form application package with cv.pdf, pitch.txt, and cover_letter.txt metadata', () => {
    const pdfPath = path.join(tempDir, 'cv.pdf');
    const pitchPath = path.join(tempDir, 'pitch.txt');
    const coverLetterPath = path.join(tempDir, 'cover_letter.txt');
    fs.writeFileSync(pdfPath, '%PDF-1.4\n%%EOF');
    fs.writeFileSync(pitchPath, 'Short pitch text for recruiter.');
    fs.writeFileSync(coverLetterPath, 'Tailored cover letter text.');

    const pkg = buildEmailPackage({
      job: {
        title: 'Tech Lead — TypeScript/Node.js',
        company: 'DataBridge',
        url: 'https://nofluffjobs.com/job/databridge-tech-lead',
      },
      coverLetter: 'Tailored cover letter text.',
      pitch: 'Short pitch text for recruiter.',
      pdfPath,
      pitchPath,
      coverLetterPath,
      dryRun: false,
      validateAttachmentExists: true,
    });

    expect(pkg.to).toBe('https://nofluffjobs.com/job/databridge-tech-lead');
    expect(pkg.pitch).toBe('Short pitch text for recruiter.');
    expect(pkg.attachments).toEqual([pdfPath, pitchPath, coverLetterPath]);
    expect(pkg.metadata.deliveryMode).toBe('web_form');
    expect(pkg.metadata.dryRun).toBe(false);
    expect(pkg.metadata.pitchPath).toBe(pitchPath);
    expect(pkg.metadata.coverLetterPath).toBe(coverLetterPath);
    expect(pkg.metadata.applyUrl).toBe('https://nofluffjobs.com/job/databridge-tech-lead');

    const manifestPath = saveEmailPackage(pkg, tempDir);
    expect(fs.existsSync(manifestPath)).toBe(true);
  });
});
