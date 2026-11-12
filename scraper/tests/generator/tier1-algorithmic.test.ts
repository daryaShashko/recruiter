import {
  loadGeneratorModule,
  mockCandidateCvData,
  mockJobOffers,
  findForbiddenStopWords,
  findForbiddenClichés,
} from './test-helpers';
import {
  CANONICAL_SKILLS_CATEGORIES,
  FORBIDDEN_STOP_WORDS,
  FORBIDDEN_OPENING_CLICHES,
  CandidateBullet,
  PreRankResult,
} from './test-contracts';

describe('Tier 1: Pure Algorithmic & Unit Logic (R1 & R2)', () => {
  // ─── Feature 4: Deterministic Pre-Ranker ──────────────────────────────────────
  describe('Feature 4: Deterministic Pre-Ranker (pre-ranker.ts)', () => {
    const preRankerMod = loadGeneratorModule<{
      preRankBullets: (
        bullets: CandidateBullet[],
        jobTitle: string,
        jobBody: string,
        jobTags?: string[]
      ) => PreRankResult[];
    }>('pre-ranker');

    const runPreRanker = (
      bullets: CandidateBullet[],
      jobTitle: string,
      jobBody: string,
      jobTags?: string[]
    ): PreRankResult[] => {
      if (!preRankerMod || typeof preRankerMod.preRankBullets !== 'function') {
        throw new Error('preRankBullets function is not implemented in scraper/src/generator/pre-ranker');
      }
      return preRankerMod.preRankBullets(bullets, jobTitle, jobBody, jobTags);
    };

    test('ranks bullets by matching tech stack tags with JD', () => {
      const results = runPreRanker(
        mockCandidateCvData.bullets,
        mockJobOffers.fullstackSenior.title,
        mockJobOffers.fullstackSenior.body,
        mockJobOffers.fullstackSenior.tags
      );

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);

      // Verify each result has required structure
      for (const res of results) {
        expect(res).toHaveProperty('bulletId');
        expect(res).toHaveProperty('score');
        expect(res).toHaveProperty('matchedTags');
        expect(typeof res.score).toBe('number');
        expect(Array.isArray(res.matchedTags)).toBe(true);
      }

      // First ranked item should have highest score
      for (let i = 0; i < results.length - 1; i++) {
        expect(results[i].score).toBeGreaterThanOrEqual(results[i + 1].score);
      }

      // Architecture microservices bullet with TypeScript/Node.js/Redis should rank high
      const topBullet = results[0];
      expect(topBullet.matchedTags.length).toBeGreaterThan(0);
    });

    test('guarantees deterministic ranking across multiple runs with identical inputs', () => {
      const run1 = runPreRanker(
        mockCandidateCvData.bullets,
        mockJobOffers.fullstackSenior.title,
        mockJobOffers.fullstackSenior.body,
        mockJobOffers.fullstackSenior.tags
      );
      const run2 = runPreRanker(
        mockCandidateCvData.bullets,
        mockJobOffers.fullstackSenior.title,
        mockJobOffers.fullstackSenior.body,
        mockJobOffers.fullstackSenior.tags
      );

      expect(run1).toEqual(run2);
    });

    test('handles empty job tags and empty JD body gracefully as 100% offline fallback', () => {
      const results = runPreRanker(mockCandidateCvData.bullets, 'Software Engineer', '', []);

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(mockCandidateCvData.bullets.length);
    });

    test('handles empty candidate bullets array without error', () => {
      const results = runPreRanker([], 'Senior Engineer', 'Job description', ['TypeScript']);
      expect(results).toEqual([]);
    });
  });

  // ─── Feature 5: Zero-Hallucination Bullet Assembler ──────────────────────────
  describe('Feature 5: Zero-Hallucination Bullet Assembler (bullet-assembler.ts)', () => {
    const assemblerMod = loadGeneratorModule<{
      assembleExperienceBullets: (
        bulletIds: string[],
        allBullets: CandidateBullet[]
      ) => CandidateBullet[];
    }>('bullet-assembler');

    const runAssembler = (bulletIds: string[], allBullets: CandidateBullet[]): CandidateBullet[] => {
      if (!assemblerMod || typeof assemblerMod.assembleExperienceBullets !== 'function') {
        throw new Error('assembleExperienceBullets function is not implemented in scraper/src/generator/bullet-assembler');
      }
      return assemblerMod.assembleExperienceBullets(bulletIds, allBullets);
    };

    test('verbatim matches bullet text and metadata by ID without altering content', () => {
      const requestedIds = ['bullet-arch-microservices', 'bullet-frontend-nextjs'];
      const assembled = runAssembler(requestedIds, mockCandidateCvData.bullets);

      expect(assembled.length).toBe(2);
      expect(assembled[0].id).toBe('bullet-arch-microservices');
      expect(assembled[0].highlight).toBe(
        'Architected and deployed microservices handling 25M daily requests with Node.js and TypeScript, reducing p99 latency by 35% through Redis caching and query optimization.'
      );
      expect(assembled[1].id).toBe('bullet-frontend-nextjs');
      expect(assembled[1].highlight).toBe(
        'Led migration of legacy monolith to Next.js and React 18 frontend, boosting Core Web Vitals to 98+ and improving conversion rate by 18%.'
      );
    });

    test('filters out unknown or hallucinated bullet IDs safely', () => {
      const mixedIds = [
        'bullet-arch-microservices',
        'hallucinated-id-999',
        'bullet-ci-cd-docker',
        'fake-bullet-xyz',
      ];
      const assembled = runAssembler(mixedIds, mockCandidateCvData.bullets);

      expect(assembled.length).toBe(2);
      expect(assembled.map((b) => b.id)).toEqual(['bullet-arch-microservices', 'bullet-ci-cd-docker']);
    });

    test('preserves exact requested ordering of bullet IDs', () => {
      const reversedIds = ['bullet-ci-cd-docker', 'bullet-arch-microservices'];
      const assembled = runAssembler(reversedIds, mockCandidateCvData.bullets);

      expect(assembled.map((b) => b.id)).toEqual(reversedIds);
    });

    test('returns empty array when bulletIds is empty', () => {
      const assembled = runAssembler([], mockCandidateCvData.bullets);
      expect(assembled).toEqual([]);
    });
  });

  // ─── Feature 6: 5-Category Skills Matrix ──────────────────────────────────────
  describe('Feature 6: 5-Category Skills Matrix (skills-matrix.ts)', () => {
    const skillsMod = loadGeneratorModule<{
      formatSkillsMatrix: (
        skills: Record<string, string[]>
      ) => Record<string, string[]>;
      formatSkillsMatrixHtml?: (skills: Record<string, string[]>) => string;
    }>('skills-matrix');

    const runFormatSkills = (skills: Record<string, string[]>): Record<string, string[]> => {
      if (!skillsMod || typeof skillsMod.formatSkillsMatrix !== 'function') {
        throw new Error('formatSkillsMatrix function is not implemented in scraper/src/generator/skills-matrix');
      }
      return skillsMod.formatSkillsMatrix(skills);
    };

    test('structures skills into strictly 5 canonical categories', () => {
      const formatted = runFormatSkills(mockCandidateCvData.skills);
      const categories = Object.keys(formatted);

      expect(categories.length).toBe(5);
      for (const cat of CANONICAL_SKILLS_CATEGORIES) {
        expect(categories).toContain(cat);
      }
    });

    test('canonicalizes technology names properly (e.g. Node.js, TypeScript, PostgreSQL)', () => {
      const unnormalized = {
        'Core Languages & Frameworks': ['typescript', 'node.js', 'reactjs', 'nextjs'],
        'State & Databases': ['postgres', 'redis db', 'mongo'],
        'Architecture & Infra': ['docker', 'k8s', 'aws cloud'],
        'Testing & Quality': ['jest', 'playwright e2e'],
        'AI Tooling & Productivity': ['genai', 'langchain'],
      };

      const formatted = runFormatSkills(unnormalized);

      // Verify canonical naming
      const coreSkills = formatted['Core Languages & Frameworks'] || [];
      const hasTs = coreSkills.some((s) => /TypeScript/i.test(s));
      const hasNode = coreSkills.some((s) => /Node\.js/i.test(s));
      expect(hasTs).toBe(true);
      expect(hasNode).toBe(true);
    });

    test('HTML rendering contains no graphical bars, meters, or rating indicators', () => {
      if (skillsMod && typeof skillsMod.formatSkillsMatrixHtml === 'function') {
        const html = skillsMod.formatSkillsMatrixHtml(mockCandidateCvData.skills);
        expect(html).not.toMatch(/<progress/i);
        expect(html).not.toMatch(/<meter/i);
        expect(html).not.toMatch(/class="[^"]*progress[^"]*"/i);
        expect(html).not.toMatch(/class="[^"]*bar[^"]*"/i);
        expect(html).not.toMatch(/[★☆●○■□]/); // graphical scale symbols
      }
    });
  });

  // ─── Feature 10: Stop Words & Clichés Filter ──────────────────────────────────
  describe('Feature 10: Stop Words & Clichés Filter (cover-letter.ts)', () => {
    test('identifies all 10 forbidden stop words accurately', () => {
      for (const word of FORBIDDEN_STOP_WORDS) {
        const testText = `I will ${word} in modern engineering systems.`;
        const detected = findForbiddenStopWords(testText);
        expect(detected).toContain(word);
      }
    });

    test('identifies forbidden opening clichés accurately', () => {
      for (const cliché of FORBIDDEN_OPENING_CLICHES) {
        const testText = `${cliché} for the Senior Full-Stack Engineer role.`;
        const detected = findForbiddenClichés(testText);
        expect(detected).toContain(cliché);
      }
    });

    test('passes clean, professional engineering sentences without false positives', () => {
      const cleanSentence =
        'As an engineer who has scaled Node.js backends and migrated monoliths to Next.js, I look forward to discussing how my experience fits your team.';
      expect(findForbiddenStopWords(cleanSentence)).toEqual([]);
      expect(findForbiddenClichés(cleanSentence)).toEqual([]);
    });
  });

  // ─── Feature 11: Language Selector ────────────────────────────────────────────
  describe('Feature 11: Language Selector (cover-letter.ts)', () => {
    const clMod = loadGeneratorModule<{
      detectLanguage?: (job: { title: string; body: string }) => 'en' | 'pl';
    }>('cover-letter');

    test('defaults to English for English language job postings', () => {
      if (clMod && typeof clMod.detectLanguage === 'function') {
        const lang = clMod.detectLanguage(mockJobOffers.fullstackSenior);
        expect(lang).toBe('en');
      }
    });

    test('selects Polish only when job posting is strictly in Polish', () => {
      if (clMod && typeof clMod.detectLanguage === 'function') {
        const lang = clMod.detectLanguage(mockJobOffers.polishBackend);
        expect(lang).toBe('pl');
      }
    });
  });
});
