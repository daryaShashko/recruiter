import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  preRankBullets,
  TECH_SYNONYMS,
  SECTION_BASE_WEIGHTS,
} from '../../src/generator/pre-ranker';
import {
  assembleExperienceBullets,
  assembleVerbatimBulletTexts,
  validateBulletIds,
} from '../../src/generator/bullet-assembler';
import {
  canonicalizeSkill,
  buildSkillsMatrix,
  formatSkillsMatrix,
  renderSkillsMatrixHtml,
  renderSkillsMatrixText,
  escapeHtml as escapeSkillsHtml,
} from '../../src/generator/skills-matrix';
import {
  generateCoverLetter,
  validateCoverLetter,
  countWords,
  findStopWords,
  findCliches,
  detectLanguage,
  FORBIDDEN_STOP_WORDS,
} from '../../src/generator/cover-letter';
import {
  buildEmailPackage,
  extractRecipientEmail,
  formatSubjectLine,
  validatePdfAttachment,
  saveEmailPackage,
  loadEmailPackage,
  serializeEmailPackage,
  DEFAULT_MANIFEST_FILENAME,
} from '../../src/generator/email-package';
import {
  runCli,
  parseCliArgs,
  loadMockJob,
  slugify,
  DEFAULT_MOCK_JOB,
} from '../../src/generator/cli';
import {
  loadCandidateCvData,
  normalizeSnapshotData,
  DEFAULT_CANDIDATE_CV_DATA,
  DEFAULT_SKILLS_MATRIX,
  DEFAULT_CANDIDATE_CONTACTS,
  DEFAULT_RODO_CLAUSE,
} from '../../src/generator/notion-loader';
import {
  CandidateBullet,
  CandidateCvData,
  SkillsCategory,
  SKILLS_CATEGORIES,
} from '../../src/generator/types';
import {
  generateCvHtml,
  extractPdfPageCount,
  formatContactLinks,
  formatSkillsMatrixHtml,
  formatExperienceHtml,
  getCvCss,
} from '../../src/generator/cv-renderer';

describe('Empirical Challenger Tier 5: White-Box Adversarial Coverage Hardening & Defect Reproduction', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'challenger-tier5-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    jest.restoreAllMocks();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 1. WHITE-BOX BRANCH COVERAGE & EDGE CONDITIONS
  // ───────────────────────────────────────────────────────────────────────────
  describe('1. White-Box Branch Coverage & Boundary Edge Conditions', () => {
    test('1.1 preRankBullets handles null/undefined/empty tags, minScore, and limit = 0 / limit > 0', () => {
      const bullets: CandidateBullet[] = [
        {
          id: 'b1',
          title: 'Full-stack Engineer',
          section: 'Key Achievement',
          highlight: 'Refactoring and architecture migration for high scalability.',
          tags: ['', '   ', 'typescript', 'unknown-tag-xyz'],
          order: 1,
        },
        {
          id: 'b2',
          title: 'Java Migration',
          section: 'Key Achievement',
          highlight: 'Migration of backend services.',
          tags: ['java', 'nodejs'],
          order: 2,
        },
      ];

      // Empty tags, null job tags, undefined options
      const res1 = preRankBullets(bullets, 'Senior TypeScript Engineer', 'Working on Node.js and TypeScript', undefined);
      expect(res1.length).toBe(2);
      expect(res1[0].matchedTags).toContain('typescript');

      // minScore filtering
      const res2 = preRankBullets(bullets, 'Java Migration', 'Need java', ['java'], { minScore: 100 });
      expect(res2.length).toBe(0);

      // limit edge condition
      const res3 = preRankBullets(bullets, 'Engineer', 'body', [], { limit: 1 });
      expect(res3.length).toBe(1);

      // empty bullets
      expect(preRankBullets([], 'job', 'body')).toEqual([]);
    });

    test('1.2 bulletAssembler covers limit parameter and fallbackToAllIfEmpty', () => {
      const allBullets: CandidateBullet[] = [
        { id: 'b1', title: 'T1', section: 'S1', highlight: 'H1', tags: [], order: 2 },
        { id: 'b2', title: 'T2', section: 'S2', highlight: 'H2', tags: [], order: 1 },
      ];

      // Limit when assembled.length > 0
      const assembledWithLimit = assembleExperienceBullets(['b1', 'b2'], allBullets, { limit: 1 });
      expect(assembledWithLimit.length).toBe(1);
      expect(assembledWithLimit[0].id).toBe('b1');

      // Fallback with limit
      const fallbackWithLimit = assembleExperienceBullets(['non-existent'], allBullets, {
        fallbackToAllIfEmpty: true,
        limit: 1,
      });
      expect(fallbackWithLimit.length).toBe(1);
      expect(fallbackWithLimit[0].id).toBe('b2'); // Sorted by order (order 1 comes first)

      // Verbatim helper
      const texts = assembleVerbatimBulletTexts(['b1'], allBullets);
      expect(texts).toEqual(['H1']);

      // Validate IDs helper
      const validation = validateBulletIds(['b1', 'unknown'], allBullets);
      expect(validation.valid).toEqual(['b1']);
      expect(validation.missing).toEqual(['unknown']);
    });

    test('1.3 skillsMatrix covers fallback categorization heuristics, empty inputs, and acronym casing', () => {
      // Empty input
      expect(buildSkillsMatrix()).toEqual({
        'Core Languages & Frameworks': [],
        'State & Databases': [],
        'Architecture & Infra': [],
        'Testing & Quality': [],
        'AI Tooling & Productivity': [],
      });

      // Array input with database heuristic
      const dbMatrix = buildSkillsMatrix(['cockroachdb', 'clickhouse sql']);
      expect(dbMatrix['State & Databases'].length).toBeGreaterThan(0);

      // Infra heuristic
      const infraMatrix = buildSkillsMatrix(['service mesh cloud']);
      expect(infraMatrix['Architecture & Infra']).toContain('Service mesh cloud');

      // QA heuristic
      const qaMatrix = buildSkillsMatrix(['assert testing mock']);
      expect(qaMatrix['Testing & Quality']).toContain('Assert testing mock');

      // AI heuristic
      const aiMatrix = buildSkillsMatrix(['gpt fine-tuning ml']);
      expect(aiMatrix['AI Tooling & Productivity']).toContain('Gpt fine-tuning ml');

      // All-caps acronym preservation (SDK, CLI, AWS)
      const sdkEntry = canonicalizeSkill('SDK');
      expect(sdkEntry.canonicalName).toBe('SDK');

      // HTML and text rendering
      const renderedText = renderSkillsMatrixText(dbMatrix);
      expect(renderedText).toContain('State & Databases:');

      const renderedHtml = renderSkillsMatrixHtml(dbMatrix);
      expect(renderedHtml).toContain('class="skill-category-row"');
    });

    test('1.4 coverLetter covers elastic expansion for short letters, custom stop words, and disabling clichés', () => {
      // Generate cover letter for short bullets to trigger underflow expansion
      const shortCvData: CandidateCvData = {
        ...DEFAULT_CANDIDATE_CV_DATA,
        bullets: [
          {
            id: 'cv-ach-cost',
            title: 'Cost',
            section: 'Key Achievement',
            highlight: 'Saved 15% costs.',
            tags: ['GenAI'],
            order: 10,
          },
          {
            id: 'cv-ach-migration',
            title: 'Migration',
            section: 'Key Achievement',
            highlight: 'Migrated backend.',
            tags: ['Node.js'],
            order: 9,
          },
        ],
      };

      const cl = generateCoverLetter(shortCvData, {
        job: { title: 'Engineer', company: 'ShortCo', body: 'Build apps' },
        language: 'en',
      });
      expect(cl.wordCount).toBeGreaterThanOrEqual(130);
      expect(cl.wordCount).toBeLessThanOrEqual(180);

      // Polish letter generation
      const plCl = generateCoverLetter(shortCvData, {
        job: { title: 'Programista', company: 'PolskaFirma', body: 'Wymagania: doświadczenie w pracy z TypeScript' },
        language: 'pl',
      });
      expect(plCl.language).toBe('pl');
      expect(plCl.wordCount).toBeGreaterThanOrEqual(130);

      // Validation with custom options
      const val = validateCoverLetter('Test text for validation check', {
        minWords: 3,
        maxWords: 10,
        stopWords: ['custombadword'],
        checkCliches: false,
      });
      expect(val.isValid).toBe(true);

      const valWithBad = validateCoverLetter('Test text with custombadword in it', {
        minWords: 3,
        maxWords: 10,
        stopWords: ['custombadword'],
      });
      expect(valWithBad.isValid).toBe(false);
      expect(valWithBad.stopWordsFound).toContain('custombadword');
    });

    test('1.5 emailPackage covers mailto parsing, custom options, serialization, and disk operations', () => {
      // Extract email from mailto in job.email with query string
      const email1 = extractRecipientEmail({ email: 'mailto:recruitment@example.com?subject=JobApplication' });
      expect(email1).toBe('recruitment@example.com');

      // Extract email from job.applyUrl
      const email2 = extractRecipientEmail({ applyUrl: 'mailto:apply@startup.io' });
      expect(email2).toBe('apply@startup.io');

      // Fallback email
      const email3 = extractRecipientEmail({}, 'fallback@example.com');
      expect(email3).toBe('fallback@example.com');

      // Empty title formatting
      expect(formatSubjectLine('Candidate', '')).toBe('Application: Candidate');

      // Save and load manifest from disk
      const dummyPdfPath = path.join(tempDir, 'sample.pdf');
      fs.writeFileSync(dummyPdfPath, '%PDF-1.4\n%%EOF');

      const pkg = buildEmailPackage({
        job: { title: 'Staff Engineer', company: 'Global Corp' },
        coverLetter: 'A valid cover letter body text.',
        pdfPath: dummyPdfPath,
        dryRun: true,
      });

      const manifestPath = saveEmailPackage(pkg, tempDir);
      expect(fs.existsSync(manifestPath)).toBe(true);

      const loaded = loadEmailPackage(manifestPath);
      expect(loaded.metadata.company).toBe('Global Corp');
      expect(loaded.metadata.dryRun).toBe(true);
      expect(loaded.attachments).toContain(dummyPdfPath);
    });

    test('1.6 cli argument parsing covers all supported CLI flags and edge cases', () => {
      expect(parseCliArgs(['--dry-run'])).toEqual({ dryRun: true, target: 'all' });
      expect(parseCliArgs(['--no-dry-run'])).toEqual({ dryRun: false, target: 'all' });
      expect(parseCliArgs(['--cv-only'])).toEqual({ dryRun: true, target: 'cv', cvOnly: true });
      expect(parseCliArgs(['--letter-only'])).toEqual({ dryRun: true, target: 'letter', letterOnly: true });
      expect(parseCliArgs(['--target=cv'])).toEqual({ dryRun: true, target: 'cv' });
      expect(parseCliArgs(['--target', 'letter'])).toEqual({ dryRun: true, target: 'letter' });
      expect(parseCliArgs(['--job=T02'])).toEqual({ dryRun: true, target: 'all', job: 'T02' });
      expect(parseCliArgs(['--job', 'E01'])).toEqual({ dryRun: true, target: 'all', job: 'E01' });
      expect(parseCliArgs(['--lang=pl'])).toEqual({ dryRun: true, target: 'all', lang: 'pl' });
      expect(parseCliArgs(['--lang', 'en'])).toEqual({ dryRun: true, target: 'all', lang: 'en' });
      expect(parseCliArgs(['--outDir=output/test'])).toEqual({ dryRun: true, target: 'all', outDir: 'output/test' });
      expect(parseCliArgs(['--outDir', 'output/test'])).toEqual({ dryRun: true, target: 'all', outDir: 'output/test' });
      expect(parseCliArgs(['--outputDir=output/test'])).toEqual({ dryRun: true, target: 'all', outputDir: 'output/test' });
      expect(parseCliArgs(['--outputDir', 'output/test'])).toEqual({ dryRun: true, target: 'all', outputDir: 'output/test' });
    });

    test('1.7 loadMockJob handles custom JSON file and smoke dataset case IDs', () => {
      // 1. JSON file
      const jsonJobPath = path.join(tempDir, 'custom-job.json');
      fs.writeFileSync(
        jsonJobPath,
        JSON.stringify({
          title: 'Custom Architect',
          company: 'Custom Systems',
          body: 'Custom description text',
        })
      );
      const loadedFromFile = loadMockJob(jsonJobPath);
      expect(loadedFromFile.company).toBe('Custom Systems');

      // 2. Smoke dataset resolution
      const t01 = loadMockJob('T01');
      expect(t01.company).toBe('TechFlow Solutions');

      // 3. Fallback to default
      const unknown = loadMockJob('NON_EXISTENT_CASE_999');
      expect(unknown.id).toBe(DEFAULT_MOCK_JOB.id);
    });

    test('1.8 runCli rejects live sends (dryRun: false) to prevent unauthorized network delivery', async () => {
      await expect(runCli({ dryRun: false })).rejects.toThrow(
        'Live email sending is not yet implemented. Only --dry-run is currently supported.'
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. DEFECT REMEDIATION VERIFICATION (EMPIRICAL VERIFICATION OF HARDENED BEHAVIORS)
  // ───────────────────────────────────────────────────────────────────────────
  describe('2. Defect Reproductions (White-Box Vulnerabilities)', () => {
    test('DEFECT 1: findStopWords crashes with TypeError when prototype property "constructor" is passed', () => {
      // Prototype property shadow is guarded: STOP_WORDS_PATTERNS['constructor'] no longer resolves to Function Object
      let errorThrown: Error | null = null;
      let matches: string[] = [];
      try {
        matches = findStopWords('Some candidate cover letter text with constructor function', ['constructor']);
      } catch (err) {
        errorThrown = err as Error;
      }

      expect(errorThrown).toBeNull();
      expect(matches).toContain('constructor');
    });

    test('DEFECT 2: preRankBullets corrupts score with string concatenation when bullet.section is "toString"', () => {
      const bullets: CandidateBullet[] = [
        {
          id: 'proto-bullet',
          title: 'Test Title',
          section: 'toString', // Object.prototype.toString shadow
          highlight: 'Highlight text',
          tags: ['typescript'],
          order: 1,
        },
      ];

      const results = preRankBullets(bullets, 'TypeScript Developer', 'Need typescript');
      expect(results.length).toBe(1);

      // Score must be a number conforming to interface PreRankResult { score: number }
      expect(typeof results[0].score).toBe('number');
      expect(Number.isFinite(results[0].score)).toBe(true);
      expect(String(results[0].score)).not.toContain('function toString');
    });

    test('DEFECT 3: canonicalizeSkill returns [Function: Object] instead of CanonicalSkillEntry when passed "constructor"', () => {
      const result = canonicalizeSkill('constructor');

      // Must return a valid CanonicalSkillEntry rather than Function Object
      expect(typeof result).toBe('object');
      expect(result).not.toBeNull();
      expect(typeof result.canonicalName).toBe('string');
      expect(typeof result.category).toBe('string');
      expect(result.canonicalName).toBe('Constructor');
    });

    test('DEFECT 4: normalizeSnapshotData crashes with unhandled TypeError on { bullets: [null] }', () => {
      let errorThrown: Error | null = null;
      try {
        normalizeSnapshotData({ bullets: [null] });
      } catch (err) {
        errorThrown = err as Error;
      }

      expect(errorThrown).toBeNull();
    });

    test('DEFECT 5: runCli silently bypasses CoverLetter validation failure (word count > 180)', async () => {
      const longCompany =
        'Very Long Company Name With Multiple Words That Pushes Word Count Past One Hundred And Eighty Words Threshold In The Cover Letter Generator Pipeline Easily Leading To An Overflow Condition Corporation Sp. z o.o.';
      const job = {
        title: 'Senior Engineer',
        company: longCompany,
        body: 'We need an engineer',
      };

      const result = await runCli({ job, outDir: tempDir, target: 'letter' });

      expect(result.success).toBe(true);

      const letterContent = fs.readFileSync(result.artifacts.coverLetter!, 'utf-8');
      const words = countWords(letterContent);

      // Verifies that elastic compression successfully constrained word count to valid bounds (<= 180 words)
      expect(words).toBeLessThanOrEqual(180);
      expect(words).toBeGreaterThanOrEqual(130);
    });

    test('DEFECT 6: loadCandidateCvData shares mutable singleton reference across invocations', async () => {
      const cv1 = await loadCandidateCvData(true);
      const testCategory: SkillsCategory = 'Core Languages & Frameworks';

      // Mutate cv1 skills
      cv1.skills[testCategory].push('MUTATED_VULNERABILITY_PROBE');

      const cv2 = await loadCandidateCvData(true);
      const leaked = cv2.skills[testCategory].includes('MUTATED_VULNERABILITY_PROBE');

      // Cleanup mutation if any
      const idx = cv1.skills[testCategory].indexOf('MUTATED_VULNERABILITY_PROBE');
      if (idx !== -1) {
        cv1.skills[testCategory].splice(idx, 1);
      }

      // Proves that DEFAULT_SKILLS_MATRIX was NOT mutated across calls
      expect(leaked).toBe(false);
    });
  });
});
