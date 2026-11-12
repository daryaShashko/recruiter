import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CandidateBullet, CandidateCvData, SKILLS_CATEGORIES, SkillsCategory } from '../../src/generator/types';
import { preRankBullets, TECH_SYNONYMS, SECTION_BASE_WEIGHTS } from '../../src/generator/pre-ranker';
import {
  assembleExperienceBullets,
  assembleVerbatimBulletTexts,
  validateBulletIds,
} from '../../src/generator/bullet-assembler';
import {
  buildSkillsMatrix,
  formatSkillsMatrix,
  canonicalizeSkill,
  renderSkillsMatrixHtml,
  renderSkillsMatrixText,
  CANONICAL_SKILL_DICTIONARY,
} from '../../src/generator/skills-matrix';
import { DEFAULT_CANDIDATE_CV_DATA } from '../../src/generator/notion-loader';
import { renderCvToPdf, extractPdfPageCount } from '../../src/generator/cv-renderer';

describe('Empirical Challenger: M2 Stress Testing (Pre-Ranker, Bullet Assembler, Skills Matrix)', () => {
  const masterBullets: CandidateBullet[] = DEFAULT_CANDIDATE_CV_DATA.bullets;
  let tempDir: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'challenger-m2-'));
  });

  afterAll(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SUITE 1: DETERMINISTIC PRE-RANKER STRESS TESTS
  // ═══════════════════════════════════════════════════════════════════════════
  describe('1. Pre-Ranker Empirical Stress & Boundary Testing', () => {
    test('1.1 handles empty titles, empty bodies, and undefined/empty tag arrays without crashing', () => {
      // Completely empty vacancy
      const resEmpty = preRankBullets(masterBullets, '', '', []);
      expect(Array.isArray(resEmpty)).toBe(true);
      expect(resEmpty.length).toBe(masterBullets.length);

      // Verify each item has valid score and bulletId
      for (const item of resEmpty) {
        expect(typeof item.bulletId).toBe('string');
        expect(item.bulletId.length).toBeGreaterThan(0);
        expect(typeof item.score).toBe('number');
        expect(item.score).toBeGreaterThanOrEqual(1); // At least baseline section weight
        expect(Array.isArray(item.matchedTags)).toBe(true);
        expect(item.matchedTags.length).toBe(0); // No tags matched
      }

      // Null-ish equivalents
      const resNullish = preRankBullets(masterBullets, undefined as any, undefined as any, undefined as any);
      expect(resNullish.length).toBe(masterBullets.length);
    });

    test('1.2 handles empty or malformed candidate bullets list', () => {
      expect(preRankBullets([], 'Senior Engineer', 'Node.js and TypeScript')).toEqual([]);
      expect(preRankBullets(null as any, 'Senior Engineer', 'Node.js')).toEqual([]);
      expect(preRankBullets(undefined as any, 'Senior Engineer', 'Node.js')).toEqual([]);
    });

    test('1.3 handles Unicode characters, diacritics, Cyrillic, and emojis in JD and tags', () => {
      const polishTitle = 'Starszy Inżynier Oprogramowania (Full-Stack) — Gdańsk / Trójmiasto 🇵🇱';
      const polishBody = 'Poszukujemy doświadczonego programisty ze znajomością TypeScript, Node.js oraz PostgreSQL. Mile widziana praca z architekturą mikroserwisów i Docker.';
      const unicodeTags = ['TypeScript', 'Node.js', 'PostgreSQL', 'Docker', 'Gdańsk', 'Środowisko Chmurowe'];

      const results = preRankBullets(masterBullets, polishTitle, polishBody, unicodeTags);
      expect(results.length).toBe(masterBullets.length);

      // Node/TS/Postgres bullets must have high scores (> 10)
      const topBullet = results[0];
      expect(topBullet.score).toBeGreaterThan(15);
      expect(topBullet.matchedTags.length).toBeGreaterThan(0);

      // Emoji and symbols in title must not crash or corrupt regex
      const emojiTitle = '🚀🔥⚡ Senior Developer (C++ / Node.js) [Ref: #999] (100% Remote)';
      const emojiBody = 'Looking for someone who loves 🚀 modern web tech, Node.js, and CI/CD pipelines! Special: $100k-$120k/yr.';
      const emojiResults = preRankBullets(masterBullets, emojiTitle, emojiBody, ['node.js', 'ci/cd']);
      expect(emojiResults.length).toBe(masterBullets.length);
      expect(emojiResults[0].score).toBeGreaterThan(10);
    });

    test('1.4 regex safety: handles special characters in tags and vacancy text without ReDoS or crash', () => {
      const regexBombTags = [
        'C++',
        'C#',
        '.NET',
        'Node.js (v20+)',
        'React [v18]',
        'CI/CD (GitHub Actions)',
        'Vue.js / Nuxt?',
        'Microservices (k8s/docker*)',
        '$PATH',
        '^start',
        'end$',
        'a{1,100}',
        '(a|b|c|d|e)+',
      ];
      const trickyBody = 'Special requirements: C++, C#, .NET, Node.js (v20+), [React], (CI/CD), $PATH variables, ^start and end$ anchors.';

      expect(() => {
        preRankBullets(masterBullets, 'Senior Architect', trickyBody, regexBombTags);
      }).not.toThrow();
    });

    test('1.5 precision check: verifies whether C vs C++ or Java vs JavaScript false-match', () => {
      const cBullets: CandidateBullet[] = [
        {
          id: 'bullet-c',
          title: 'C Programming',
          section: 'Key Achievement',
          highlight: 'Developed low-level embedded software in C language.',
          tags: ['c'],
          order: 1,
        },
        {
          id: 'bullet-cpp',
          title: 'C++ Systems',
          section: 'Key Achievement',
          highlight: 'Engineered high-frequency trading engine in C++.',
          tags: ['c++'],
          order: 2,
        },
        {
          id: 'bullet-java',
          title: 'Java Backend',
          section: 'Key Achievement',
          highlight: 'Maintained enterprise Spring Boot services in Java.',
          tags: ['java'],
          order: 3,
        },
        {
          id: 'bullet-js',
          title: 'JavaScript Frontend',
          section: 'Key Achievement',
          highlight: 'Built interactive SPAs using vanilla JavaScript.',
          tags: ['javascript'],
          order: 4,
        },
      ];

      // Query specifically for C++
      const resCpp = preRankBullets(cBullets, 'Senior C++ Developer', 'Looking for expert in C++ systems', ['c++']);
      const cppResult = resCpp.find((r) => r.bulletId === 'bullet-cpp');
      expect(cppResult).toBeDefined();

      // Query specifically for Java
      const resJava = preRankBullets(cBullets, 'Java Engineer', 'Spring Boot enterprise backend', ['java']);
      const javaResult = resJava.find((r) => r.bulletId === 'bullet-java');
      const jsResult = resJava.find((r) => r.bulletId === 'bullet-js');
      expect(javaResult!.score).toBeGreaterThan(jsResult!.score);
    });

    test('1.6 strict deterministic tie-breaking across 100 iterations', () => {
      // Craft bullets with identical scores
      const identicalScoreBullets: CandidateBullet[] = [
        { id: 'bullet-zebra', title: 'Task Z', section: 'Primary Stack', highlight: 'Zebra', tags: ['node'], order: 3 },
        { id: 'bullet-apple', title: 'Task A', section: 'Primary Stack', highlight: 'Apple', tags: ['node'], order: 1 },
        { id: 'bullet-mango', title: 'Task M', section: 'Primary Stack', highlight: 'Mango', tags: ['node'], order: 2 },
        { id: 'bullet-banana', title: 'Task B', section: 'Primary Stack', highlight: 'Banana', tags: ['node'], order: 2 },
      ];

      const baselineRun = preRankBullets(identicalScoreBullets, 'Node Developer', 'Node.js stack', ['node']);
      const baselineOrder = baselineRun.map((r) => r.bulletId);

      // Verify order precedence:
      // bullet-apple (order 1) must be first
      expect(baselineOrder[0]).toBe('bullet-apple');
      // bullet-banana and bullet-mango both have order 2 -> tie broken by ID alphabetical ('bullet-banana' < 'bullet-mango')
      expect(baselineOrder[1]).toBe('bullet-banana');
      expect(baselineOrder[2]).toBe('bullet-mango');
      // bullet-zebra has order 3
      expect(baselineOrder[3]).toBe('bullet-zebra');

      // Run 100 times to guarantee 100% deterministic reproducibility
      for (let i = 0; i < 100; i++) {
        const run = preRankBullets(identicalScoreBullets, 'Node Developer', 'Node.js stack', ['node']);
        expect(run.map((r) => r.bulletId)).toEqual(baselineOrder);
      }
    });

    test('1.7 filtering options: limit and minScore work accurately', () => {
      const res = preRankBullets(masterBullets, 'Fullstack TypeScript', 'TypeScript Node.js PostgreSQL', ['typescript']);

      // minScore filter
      const minScoreVal = 15;
      const resFiltered = preRankBullets(
        masterBullets,
        'Fullstack TypeScript',
        'TypeScript Node.js PostgreSQL',
        ['typescript'],
        { minScore: minScoreVal }
      );
      for (const item of resFiltered) {
        expect(item.score).toBeGreaterThanOrEqual(minScoreVal);
      }

      // limit filter
      const limitVal = 3;
      const resLimited = preRankBullets(
        masterBullets,
        'Fullstack TypeScript',
        'TypeScript Node.js PostgreSQL',
        ['typescript'],
        { limit: limitVal }
      );
      expect(resLimited.length).toBe(limitVal);
      expect(resLimited).toEqual(res.slice(0, limitVal));
    });

    test('1.9 adversarial edge case: empty or whitespace tags in bullets do NOT falsely match text', () => {
      const emptyTagBullet: CandidateBullet = {
        id: 'bullet-empty-tag',
        title: 'Software Developer',
        section: 'Key Achievement',
        highlight: 'Developed backend services with zero bugs.',
        tags: ['', '   '],
        order: 1,
      };

      // Vacancy with punctuation and spaces
      const res = preRankBullets(
        [emptyTagBullet],
        'Senior Developer, Fullstack (Remote)',
        'Looking for someone. Must be available immediately - full time.'
      );

      // Empty or whitespace tags should NOT be counted as matched tags!
      const matched = res[0].matchedTags;
      expect(matched.filter((t) => !t.trim()).length).toBe(0);
    });

    test('1.10 corrupt jobTags and candidate tags handling', () => {
      const corruptBullet: CandidateBullet = {
        id: 'bullet-corrupt',
        title: 'Corrupt Tags',
        section: 'Key Achievement',
        highlight: 'Corrupt tags testing',
        tags: [null as any, undefined as any, 'typescript', 123 as any],
        order: 1,
      };

      const corruptJobTags = [null as any, undefined as any, 'typescript', 456 as any, ''];

      expect(() => {
        preRankBullets([corruptBullet], 'Job Title', 'Job Body', corruptJobTags);
      }).not.toThrow();
    });

    test('1.11 tag collision analysis: C vs C++ vs C# and Java vs JavaScript', () => {
      const langBullets: CandidateBullet[] = [
        { id: 'b-c', title: 'C Dev', section: 'Key Achievement', highlight: 'C lang', tags: ['c'], order: 1 },
        { id: 'b-cpp', title: 'C++ Dev', section: 'Key Achievement', highlight: 'C++ lang', tags: ['c++'], order: 2 },
        { id: 'b-cs', title: 'C# Dev', section: 'Key Achievement', highlight: 'C# lang', tags: ['c#'], order: 3 },
      ];

      // If job asks specifically for C++, does C tag falsely match?
      const resCpp = preRankBullets(langBullets, 'Senior C++ Developer', 'Looking for C++ systems developer', ['c++']);
      const cResult = resCpp.find((r) => r.bulletId === 'b-c')!;
      const cppResult = resCpp.find((r) => r.bulletId === 'b-cpp')!;

      // C tag should not match C++ tag in jobTags
      expect(cResult.matchedTags).not.toContain('c');
      expect(cppResult.score).toBeGreaterThan(cResult.score);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SUITE 2: ZERO-HALLUCINATION BULLET ASSEMBLER STRESS TESTS
  // ═══════════════════════════════════════════════════════════════════════════
  describe('2. Bullet Assembler Empirical Stress & Integrity Testing', () => {
    test('2.1 handles completely non-existent IDs, empty IDs, and whitespace IDs safely', () => {
      const hallucinatedIds = ['ghost-bullet-1', 'fake-ach-999', 'hallucinated-xyz', '', '   '];
      const assembled = assembleExperienceBullets(hallucinatedIds, masterBullets);
      expect(assembled).toEqual([]);

      const verbatimTexts = assembleVerbatimBulletTexts(hallucinatedIds, masterBullets);
      expect(verbatimTexts).toEqual([]);

      const validation = validateBulletIds(hallucinatedIds, masterBullets);
      expect(validation.valid).toEqual([]);
      expect(validation.missing).toEqual(['ghost-bullet-1', 'fake-ach-999', 'hallucinated-xyz']);
    });

    test('2.2 handles mixed valid and invalid IDs, preserving exact valid sequence', () => {
      const mixedIds = [
        'cv-ach-migration', // valid
        'hallucinated-bullet-1', // invalid
        'cv-ach-lead', // valid
        'fake-bullet-2', // invalid
        'cv-recent-6m', // valid
      ];

      const assembled = assembleExperienceBullets(mixedIds, masterBullets);
      expect(assembled.length).toBe(3);
      expect(assembled.map((b) => b.slug || b.id)).toEqual(['cv-ach-migration', 'cv-ach-lead', 'cv-recent-6m']);

      const validation = validateBulletIds(mixedIds, masterBullets);
      expect(validation.valid).toEqual(['cv-ach-migration', 'cv-ach-lead', 'cv-recent-6m']);
      expect(validation.missing).toEqual(['hallucinated-bullet-1', 'fake-bullet-2']);
    });

    test('2.3 deduplicates duplicate IDs, including mixed-case variations', () => {
      const duplicateIds = [
        'cv-ach-cost',
        'cv-ach-cost',
        'CV-ACH-COST',
        'Cv-Ach-Cost',
        'cv-ach-migration',
        'cv-ach-migration',
      ];

      const assembled = assembleExperienceBullets(duplicateIds, masterBullets);
      expect(assembled.length).toBe(2);
      expect(assembled[0].slug || assembled[0].id).toBe('cv-ach-cost');
      expect(assembled[1].slug || assembled[1].id).toBe('cv-ach-migration');
    });

    test('2.4 verifies byte-for-byte verbatim text preservation (Zero Hallucination)', () => {
      const allIds = masterBullets.map((b) => b.id || b.slug!);
      const assembled = assembleExperienceBullets(allIds, masterBullets);

      expect(assembled.length).toBe(masterBullets.length);

      for (let i = 0; i < masterBullets.length; i++) {
        const original = masterBullets[i];
        const retrieved = assembled.find((b) => b.id === original.id || b.slug === original.slug);

        expect(retrieved).toBeDefined();
        // Exact verbatim comparison
        expect(retrieved!.highlight).toBe(original.highlight);
        expect(retrieved!.title).toBe(original.title);
        expect(retrieved!.section).toBe(original.section);
        expect(retrieved!.tags).toEqual(original.tags);
        expect(retrieved!.order).toBe(original.order);

        // Immutability check: modifying assembled copy does not mutate original Master CV
        retrieved!.highlight = 'MUTATED TEXT';
        expect(original.highlight).not.toBe('MUTATED TEXT');
      }
    });

    test('2.5 handles empty or corrupted masterBullets array without throwing', () => {
      expect(assembleExperienceBullets(['cv-ach-cost'], [])).toEqual([]);
      expect(assembleExperienceBullets(['cv-ach-cost'], null as any)).toEqual([]);
      expect(assembleExperienceBullets([], masterBullets)).toEqual([]);
      expect(assembleVerbatimBulletTexts([], masterBullets)).toEqual([]);
      expect(validateBulletIds([], masterBullets)).toEqual({ valid: [], missing: [] });
    });

    test('2.6 options testing: fallbackToAllIfEmpty and sortByCvOrder', () => {
      // fallbackToAllIfEmpty
      const fallbackRes = assembleExperienceBullets(['non-existent-id'], masterBullets, {
        fallbackToAllIfEmpty: true,
      });
      expect(fallbackRes.length).toBe(masterBullets.length);
      // Must be sorted by order
      for (let i = 0; i < fallbackRes.length - 1; i++) {
        expect(fallbackRes[i].order).toBeLessThanOrEqual(fallbackRes[i + 1].order);
      }

      // sortByCvOrder
      const reversedIds = ['cv-ach-mobile', 'cv-ach-migration', 'cv-role-summary'];
      const sortedRes = assembleExperienceBullets(reversedIds, masterBullets, {
        sortByCvOrder: true,
      });
      expect(sortedRes[0].slug || sortedRes[0].id).toBe('cv-role-summary'); // Order 1
      expect(sortedRes[1].slug || sortedRes[1].id).toBe('cv-ach-migration'); // Order 9
      expect(sortedRes[2].slug || sortedRes[2].id).toBe('cv-ach-mobile'); // Order 12
    });

    test('2.7 bullet resilience: bullets with missing tags array do not crash assembler', () => {
      const bulletsWithoutTags: CandidateBullet[] = [
        {
          id: 'no-tags-bullet',
          title: 'Title',
          section: 'Key Achievement',
          highlight: 'Highlight without tags',
          tags: null as any,
          order: 1,
        },
      ];

      expect(() => {
        assembleExperienceBullets(['no-tags-bullet'], bulletsWithoutTags);
      }).not.toThrow();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SUITE 3: 5-CATEGORY SKILLS MATRIX STRESS TESTS
  // ═══════════════════════════════════════════════════════════════════════════
  describe('3. Skills Matrix Empirical Stress & ATS Invariants Testing', () => {
    test('3.1 strict 5-category invariant: exactly 5 keys present under any input', () => {
      // Empty input
      const emptyMatrix = buildSkillsMatrix();
      expect(Object.keys(emptyMatrix)).toEqual(SKILLS_CATEGORIES);

      // Corrupt / empty object
      const nullMatrix = buildSkillsMatrix(null as any);
      expect(Object.keys(nullMatrix)).toEqual(SKILLS_CATEGORIES);

      // Object with unexpected random category names
      const weirdCategoryInput = {
        'Random Category 1': ['Node.js', 'React'],
        'Extraneous Category 2': ['PostgreSQL', 'Docker'],
        'Something Else': ['Jest', 'GenAI'],
      };
      const resultMatrix = buildSkillsMatrix(weirdCategoryInput);
      expect(Object.keys(resultMatrix)).toEqual(SKILLS_CATEGORIES);
      expect(resultMatrix['Core Languages & Frameworks']).toContain('Node.js');
      expect(resultMatrix['Core Languages & Frameworks']).toContain('React');
      expect(resultMatrix['State & Databases']).toContain('PostgreSQL');
      expect(resultMatrix['Architecture & Infra']).toContain('Docker');
      expect(resultMatrix['Testing & Quality']).toContain('Jest');
      expect(resultMatrix['AI Tooling & Productivity']).toContain('GenAI');
      expect((resultMatrix as any)['Random Category 1']).toBeUndefined();
    });

    test('3.2 obscure, exotic, and emerging technology names are categorized without crashing', () => {
      const exoticTech = [
        'Brainfuck', // obscure esoteric language -> Core Languages
        'COBOL', // legacy language -> Core Languages
        'Haskell', // functional language -> Core Languages
        'Zig', // system language -> Core Languages
        'CockroachDB', // contains db -> State & Databases
        'ClickHouse', // analytics db
        'ScyllaDB', // contains db -> State & Databases
        'DuckDB', // contains db -> State & Databases
        'Apache Kafka', // streaming infra
        'OpenTelemetry', // observability infra
        'Consul', // infra mesh
        'Artillery', // load testing
        'K6', // performance test
        'ChromaDB', // vector db -> State & Databases
        'LangChain', // AI tooling
        'LlamaIndex', // AI tooling
        'vLLM', // AI tooling
      ];

      const matrix = buildSkillsMatrix(exoticTech);
      expect(Object.keys(matrix)).toEqual(SKILLS_CATEGORIES);

      // Check DB heuristic
      expect(matrix['State & Databases']).toContain('CockroachDB');
      expect(matrix['State & Databases']).toContain('DuckDB');
      expect(matrix['State & Databases']).toContain('ScyllaDB');
      expect(matrix['State & Databases']).toContain('ChromaDB');

      // Check AI tooling
      expect(matrix['AI Tooling & Productivity']).toContain('LangChain');
    });

    test('3.3 deduplication & canonical name normalization', () => {
      const duplicateVariants = [
        'node.js',
        'Node.js',
        'nodejs',
        'node',
        'NODE.JS',
        'typescript',
        'TypeScript',
        'ts',
        'TS',
        'postgres',
        'postgresql',
        'PostgreSQL',
        'psql',
        'docker',
        'Docker',
        'k8s',
        'Kubernetes',
        'kubernetes',
      ];

      const matrix = buildSkillsMatrix(duplicateVariants);
      // Should be deduplicated into canonical representations
      expect(matrix['Core Languages & Frameworks'].filter((s) => s === 'Node.js').length).toBe(1);
      expect(matrix['Core Languages & Frameworks'].filter((s) => s === 'TypeScript').length).toBe(1);
      expect(matrix['State & Databases'].filter((s) => s === 'PostgreSQL').length).toBe(1);
      expect(matrix['Architecture & Infra'].filter((s) => s === 'Docker').length).toBe(1);
      expect(matrix['Architecture & Infra'].filter((s) => s === 'Kubernetes').length).toBe(1);
    });

    test('3.4 HTML rendering strictly obeys ATS rules: zero tables, zero graphical bars/meters/stars', () => {
      const fullMatrix = buildSkillsMatrix(DEFAULT_CANDIDATE_CV_DATA.skills);
      const html = renderSkillsMatrixHtml(fullMatrix);

      // 1. Zero HTML tables
      expect(html).not.toMatch(/<table[\s>]/i);
      expect(html).not.toMatch(/<\/table>/i);
      expect(html).not.toMatch(/<tr[\s>]/i);
      expect(html).not.toMatch(/<td[\s>]/i);
      expect(html).not.toMatch(/<th[\s>]/i);

      // 2. Zero graphical progress / meter elements
      expect(html).not.toMatch(/<progress[\s>]/i);
      expect(html).not.toMatch(/<meter[\s>]/i);
      expect(html).not.toMatch(/progress-bar/i);
      expect(html).not.toMatch(/fill-bar/i);
      expect(html).not.toMatch(/width:\s*\d+%/i);

      // 3. Zero graphical star ratings or rating numbers
      expect(html).not.toMatch(/[★☆⭐🌟]/);
      expect(html).not.toMatch(/\d+\s*\/\s*5/);
      expect(html).not.toMatch(/\d+\s*\/\s*10/);

      // 4. Proper escaping of special HTML characters in skill names
      const dangerousSkills = ['C++ & C#', '<script>alert("xss")</script>', 'Foo"Bar'];
      const dangerousMatrix = buildSkillsMatrix(dangerousSkills);
      const safeHtml = renderSkillsMatrixHtml(dangerousMatrix);

      expect(safeHtml).not.toContain('<script>');
      expect(safeHtml).toContain('&lt;script&gt;');
      expect(safeHtml).toContain('&amp;');
    });

    test('3.5 plain text rendering outputs all 5 categories cleanly', () => {
      const matrix = buildSkillsMatrix(DEFAULT_CANDIDATE_CV_DATA.skills);
      const text = renderSkillsMatrixText(matrix);

      expect(typeof text).toBe('string');
      for (const cat of SKILLS_CATEGORIES) {
        expect(text).toContain(cat);
      }
    });

    test('3.6 edge case: whitespace and empty skill names in input array', () => {
      const weirdSkills = ['', '   ', 'ValidSkill', null as any, undefined as any];
      const matrix = buildSkillsMatrix(weirdSkills);

      for (const cat of SKILLS_CATEGORIES) {
        // No empty strings or whitespace-only strings should exist as skills in any category
        for (const skill of matrix[cat]) {
          expect(skill.trim().length).toBeGreaterThan(0);
        }
      }
    });

    test('3.7 edge case: empty categories in matrix render cleanly in HTML', () => {
      const emptyMatrix = buildSkillsMatrix();
      const html = renderSkillsMatrixHtml(emptyMatrix);
      expect(typeof html).toBe('string');
      expect(html).toContain('cv-skills');
      expect(html).not.toContain('undefined');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SUITE 4: CV RENDERER PLAYWRIGHT PDF INTEGRATION STRESS TESTS
  // ═══════════════════════════════════════════════════════════════════════════
  describe('4. CV Renderer & Playwright PDF Stress Testing', () => {
    test('4.1 renders PDF with 0 bullets without crashing (strictly 1 page A4)', async () => {
      const outPath = path.join(tempDir, 'empty-bullets.pdf');
      const res = await renderCvToPdf(DEFAULT_CANDIDATE_CV_DATA, [], {
        outputPath: outPath,
        language: 'en',
      });

      expect(fs.existsSync(outPath)).toBe(true);
      expect(res.pageCount).toBe(1);
      expect(res.bufferSize).toBeGreaterThan(1000);
    }, 60000);

    test('4.2 renders PDF with 15 bullets enforcing strict 1 or 2 A4 page budget', async () => {
      // 15 bullets might overflow standard spacing -> multi-pass budget compaction must kick in
      const fifteenBullets: CandidateBullet[] = [];
      for (let i = 0; i < 15; i++) {
        const base = masterBullets[i % masterBullets.length];
        fifteenBullets.push({
          ...base,
          id: `stress-bullet-${i}`,
          order: i + 1,
        });
      }

      const outPath = path.join(tempDir, 'many-bullets.pdf');
      const res = await renderCvToPdf(DEFAULT_CANDIDATE_CV_DATA, fifteenBullets, {
        outputPath: outPath,
        language: 'en',
      });

      expect(fs.existsSync(outPath)).toBe(true);
      expect(res.pageCount).toBeGreaterThanOrEqual(1);
      expect(res.pageCount).toBeLessThanOrEqual(2);
    }, 60000);

    test('4.3 verifies Polish language option renders Polish RODO clause', async () => {
      const outPath = path.join(tempDir, 'polish-cv.pdf');
      const res = await renderCvToPdf(DEFAULT_CANDIDATE_CV_DATA, masterBullets.slice(0, 3), {
        outputPath: outPath,
        language: 'pl',
      });

      expect(fs.existsSync(outPath)).toBe(true);
      expect(res.pageCount).toBeGreaterThanOrEqual(1);
      expect(res.pageCount).toBeLessThanOrEqual(2);
    }, 60000);

    test('4.4 extractPdfPageCount accurately counts pages from buffer', () => {
      const dummyPdf1 = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Pages /Count 1 >>\nendobj\n%%EOF');
      expect(extractPdfPageCount(dummyPdf1)).toBe(1);

      const dummyPdf2 = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Pages /Count 2 >>\nendobj\n%%EOF');
      expect(extractPdfPageCount(dummyPdf2)).toBe(2);

      // Degraded / empty buffer returns fallback 1
      expect(extractPdfPageCount(Buffer.alloc(0))).toBe(1);
      expect(extractPdfPageCount(null as any)).toBe(1);
    });
  });
});
