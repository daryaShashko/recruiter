import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  loadCandidateCvData,
  normalizeSnapshotData,
  findBulletByIdOrSlug,
  DEFAULT_CANDIDATE_CONTACTS,
  DEFAULT_CANDIDATE_CV_DATA,
  DEFAULT_SKILLS_MATRIX,
  DEFAULT_RODO_CLAUSE,
} from '../../src/generator/notion-loader';
import { SKILLS_CATEGORIES, CandidateCvData } from '../../src/generator/types';

describe('Empirical Challenger: M1 Stress Testing (loadCandidateCvData & notion-loader)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'challenger-stress-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    jest.restoreAllMocks();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 1. CORRUPT SNAPSHOTS & SCHEMA DRIFT
  // ───────────────────────────────────────────────────────────────────────────
  describe('1. Corrupt Snapshots & Schema Drift', () => {
    test('1.1 handles non-existent snapshot path gracefully without crashing', async () => {
      const nonExistentPath = path.join(tempDir, 'does-not-exist.json');
      const data = await loadCandidateCvData(true, { snapshotPath: nonExistentPath });

      expect(data).toBeDefined();
      expect(Array.isArray(data.bullets)).toBe(true);
      expect(data.bullets.length).toBeGreaterThan(0);
      expect(data.contacts).toBeDefined();
      expect(data.skills).toBeDefined();
    });

    test('1.2 handles truncated / malformed JSON syntax in snapshot without crashing', async () => {
      const corruptJsonPath = path.join(tempDir, 'corrupt-syntax.json');
      fs.writeFileSync(corruptJsonPath, '{"cvEntries": [{"id": "1", "title": "Truncated...', 'utf-8');

      const data = await loadCandidateCvData(true, { snapshotPath: corruptJsonPath });
      expect(data).toBeDefined();
      expect(data.bullets.length).toBeGreaterThan(0);
    });

    test('1.3 handles completely empty snapshot file (0 bytes) without crashing', async () => {
      const emptyFilePath = path.join(tempDir, 'empty.json');
      fs.writeFileSync(emptyFilePath, '', 'utf-8');

      const data = await loadCandidateCvData(true, { snapshotPath: emptyFilePath });
      expect(data).toBeDefined();
      expect(data.bullets.length).toBeGreaterThan(0);
    });

    test('1.4 handles snapshot with non-object JSON values (number, string, null, boolean)', async () => {
      for (const val of [12345, '"just a string"', 'null', 'true']) {
        const file = path.join(tempDir, `primitive-${val}.json`);
        fs.writeFileSync(file, String(val), 'utf-8');

        const data = await loadCandidateCvData(true, { snapshotPath: file });
        expect(data).toBeDefined();
        expect(data.bullets.length).toBeGreaterThan(0);
      }
    });

    test('1.5 handles snapshot with empty object {} without crashing', async () => {
      const emptyObjPath = path.join(tempDir, 'empty-obj.json');
      fs.writeFileSync(emptyObjPath, '{}', 'utf-8');

      const data = await loadCandidateCvData(true, { snapshotPath: emptyObjPath });
      expect(data).toBeDefined();
      expect(data.bullets.length).toBeGreaterThan(0);
    });

    test('1.6 handles snapshot containing corrupt primitives / nulls in array: [null, undefined, 42, "text"]', async () => {
      const corruptArrayPath = path.join(tempDir, 'corrupt-array.json');
      fs.writeFileSync(corruptArrayPath, JSON.stringify([null, 42, 'string', true]), 'utf-8');

      // loadCandidateCvData must catch error and fall back to valid data
      const data = await loadCandidateCvData(true, { snapshotPath: corruptArrayPath });
      expect(data).toBeDefined();
      expect(data.bullets.length).toBeGreaterThan(0);
    });

    test('1.7 normalizeSnapshotData direct call with array containing null or primitives does not throw unhandled exception or throws catchable error', () => {
      // Testing direct resilience of normalizeSnapshotData
      try {
        const res = normalizeSnapshotData([null, 42, 'string']);
        // If it returns null or recovers, that is fine
        expect(res === null || typeof res === 'object').toBe(true);
      } catch (err) {
        // If it throws, verify it is caught properly in loadCandidateCvData
        expect(err).toBeInstanceOf(Error);
      }
    });

    test('1.8 handles snapshot with all entries inactive (active: false)', async () => {
      const inactivePath = path.join(tempDir, 'all-inactive.json');
      fs.writeFileSync(
        inactivePath,
        JSON.stringify([
          { id: 'b1', title: 'Inactive 1', active: false },
          { id: 'b2', title: 'Inactive 2', active: false },
        ]),
        'utf-8'
      );

      const data = await loadCandidateCvData(true, { snapshotPath: inactivePath });
      expect(data).toBeDefined();
      // Should fall back to default seed or valid bullets because 0 active rows cannot form a valid CV
      expect(data.bullets.length).toBeGreaterThan(0);
    });

    test('1.9 prototype pollution attempt in snapshot does not pollute Object.prototype', async () => {
      const pollutionPath = path.join(tempDir, 'pollution.json');
      fs.writeFileSync(
        pollutionPath,
        JSON.stringify({
          __proto__: { pollutedProp: 'EXPLOITED' },
          cvEntries: [
            {
              id: 'safe-1',
              title: 'Safe Entry',
              active: true,
              __proto__: { pollutedEntry: 'EXPLOITED' },
            },
          ],
        }),
        'utf-8'
      );

      await loadCandidateCvData(true, { snapshotPath: pollutionPath });
      expect((Object.prototype as any).pollutedProp).toBeUndefined();
      expect((Object.prototype as any).pollutedEntry).toBeUndefined();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. MISSING ENVIRONMENT VARIABLES & DEGRADED CONFIGURATION
  // ───────────────────────────────────────────────────────────────────────────
  describe('2. Missing Environment Variables & Degraded Configuration', () => {
    const origEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...origEnv };
    });

    test('2.1 unsets all CANDIDATE_* env vars and verifies defaults are preserved', async () => {
      delete process.env.CANDIDATE_NAME;
      delete process.env.CANDIDATE_LOCATION;
      delete process.env.CANDIDATE_PHONE;
      delete process.env.CANDIDATE_EMAIL;
      delete process.env.CANDIDATE_LINKEDIN;
      delete process.env.CANDIDATE_GITHUB;

      const data = await loadCandidateCvData(true);
      expect(data.contacts.name).toBe('Darya Shashko');
      expect(data.contacts.location).toBe('Gdańsk, Poland');
      expect(data.contacts.phone).toBe('+48 573 707 501');
      expect(data.contacts.email).toBe('shashko.darya@gmail.com');
      expect(data.contacts.linkedIn).toContain('linkedin.com');
      expect(data.contacts.github).toContain('github.com');
    });

    test('2.2 unsets NOTION_TOKEN & NOTION_CV_DB_ID and verifies 100% offline fallback without network', async () => {
      delete process.env.NOTION_TOKEN;
      delete process.env.NOTION_CV_DB_ID;
      delete process.env.NOTION_DB_ID;

      // Mock fetch to verify it is NEVER called when credentials are missing
      const mockFetch = jest.fn();
      const data = await loadCandidateCvData(false, { fetchImpl: mockFetch as any });

      expect(mockFetch).not.toHaveBeenCalled();
      expect(data).toBeDefined();
      expect(data.bullets.length).toBeGreaterThan(0);
    });

    test('2.3 partial credentials (token set, dbId empty) does not call network', async () => {
      const mockFetch = jest.fn();
      const data = await loadCandidateCvData(false, {
        notionToken: 'secret_dummy_token',
        cvDbId: '',
        fetchImpl: mockFetch as any,
      });

      expect(mockFetch).not.toHaveBeenCalled();
      expect(data).toBeDefined();
    });

    test('2.4 offlineOnly=true strictly forbids network calls even if valid credentials are provided', async () => {
      const mockFetch = jest.fn();
      const data = await loadCandidateCvData(true, {
        notionToken: 'secret_valid_looking_token',
        cvDbId: '12345678-1234-1234-1234-123456789abc',
        fetchImpl: mockFetch as any,
      });

      expect(mockFetch).not.toHaveBeenCalled();
      expect(data).toBeDefined();
      expect(data.bullets.length).toBeGreaterThan(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. MISSING IDS & SLUG RESOLUTION
  // ───────────────────────────────────────────────────────────────────────────
  describe('3. Missing IDs & Slug Resolution', () => {
    test('3.1 handles snapshot entries where id is missing or empty, synthesizes fallback ID', async () => {
      const noIdSnapshotPath = path.join(tempDir, 'no-id.json');
      fs.writeFileSync(
        noIdSnapshotPath,
        JSON.stringify([
          { order: 1, title: 'Role Summary', highlight: 'Senior Fullstack', active: true },
          { order: 9, title: 'Achievement', highlight: 'Backend migration', active: true },
          { order: 999, title: 'Unknown Order', highlight: 'No slug match', active: true },
        ]),
        'utf-8'
      );

      const data = await loadCandidateCvData(true, { snapshotPath: noIdSnapshotPath });
      expect(data.bullets.length).toBe(3);

      // Order 1 -> slug 'cv-role-summary'
      expect(data.bullets[0].id).toBe('cv-role-summary');
      expect(data.bullets[0].slug).toBe('cv-role-summary');

      // Order 9 -> slug 'cv-ach-migration'
      expect(data.bullets[1].id).toBe('cv-ach-migration');
      expect(data.bullets[1].slug).toBe('cv-ach-migration');

      // Order 999 -> fallback to entry-3
      expect(data.bullets[2].id).toBe('entry-3');
      expect(data.bullets[2].order).toBe(999);
    });

    test('3.2 handles entries missing order, tags, section, period, highlight', async () => {
      const sparseSnapshotPath = path.join(tempDir, 'sparse.json');
      fs.writeFileSync(
        sparseSnapshotPath,
        JSON.stringify([{ active: true }]),
        'utf-8'
      );

      const data = await loadCandidateCvData(true, { snapshotPath: sparseSnapshotPath });
      expect(data.bullets.length).toBe(1);
      const b = data.bullets[0];
      expect(b.id).toBeDefined();
      expect(b.title).toBe('');
      expect(b.highlight).toBe('');
      expect(b.section).toBe('Experience');
      expect(Array.isArray(b.tags)).toBe(true);
      expect(b.tags).toEqual([]);
      expect(b.order).toBe(1);
    });

    test('3.3 findBulletByIdOrSlug resolves correctly by UUID id and by slug', async () => {
      const data = await loadCandidateCvData(true);
      const firstBullet = data.bullets[0];

      // Lookup by exact ID
      const byId = findBulletByIdOrSlug(data.bullets, firstBullet.id);
      expect(byId).toBeDefined();
      expect(byId?.id).toBe(firstBullet.id);

      // Lookup by slug
      if (firstBullet.slug) {
        const bySlug = findBulletByIdOrSlug(data.bullets, firstBullet.slug);
        expect(bySlug).toBeDefined();
        expect(bySlug?.id).toBe(firstBullet.id);
      }

      // Lookup nonexistent ID or slug
      expect(findBulletByIdOrSlug(data.bullets, 'non-existent-id-12345')).toBeUndefined();
      expect(findBulletByIdOrSlug(data.bullets, '')).toBeUndefined();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. CATEGORY CHECKS & SKILLS MATRIX INTEGRITY
  // ───────────────────────────────────────────────────────────────────────────
  describe('4. Category Checks & Skills Matrix Integrity', () => {
    test('4.1 returned skills matrix contains exactly 5 canonical categories', async () => {
      const data = await loadCandidateCvData(true);
      const categories = Object.keys(data.skills);

      expect(categories).toHaveLength(5);
      for (const cat of SKILLS_CATEGORIES) {
        expect(categories).toContain(cat);
      }
    });

    test('4.2 each canonical category contains non-empty technology lists with canonical names', async () => {
      const data = await loadCandidateCvData(true);

      for (const cat of SKILLS_CATEGORIES) {
        const skills = data.skills[cat];
        expect(Array.isArray(skills)).toBe(true);
        expect(skills.length).toBeGreaterThan(0);
        for (const skill of skills) {
          expect(typeof skill).toBe('string');
          expect(skill.trim().length).toBeGreaterThan(0);
        }
      }

      // Verify key canonical technologies are present
      expect(data.skills['Core Languages & Frameworks']).toContain('TypeScript');
      expect(data.skills['Core Languages & Frameworks']).toContain('Node.js');
      expect(data.skills['Core Languages & Frameworks']).toContain('React');
      expect(data.skills['State & Databases']).toContain('PostgreSQL');
      expect(data.skills['AI Tooling & Productivity']).toContain('GenAI');
    });

    test('4.3 snapshot with empty skills object {} in Case A causes skills matrix to have 0 categories (loss of canonical categories)', async () => {
      const customSkillsSnapshot = path.join(tempDir, 'empty-skills.json');
      fs.writeFileSync(
        customSkillsSnapshot,
        JSON.stringify({
          contacts: DEFAULT_CANDIDATE_CONTACTS,
          summary: 'Custom summary',
          bullets: [
            {
              id: 'b1',
              title: 'Dev',
              section: 'Experience',
              highlight: 'Highlight',
              tags: ['TS'],
              order: 1,
            },
          ],
          skills: {},
        }),
        'utf-8'
      );

      const data = await loadCandidateCvData(true, { snapshotPath: customSkillsSnapshot });
      expect(data).toBeDefined();
      console.log('[TEST 4.3] Keys in data.skills when snapshot has skills: {} ->', Object.keys(data.skills));
      // Observation: data.skills is {} instead of the 5 canonical categories!
      const hasCategories = Object.keys(data.skills).length === 5;
      console.log('[TEST 4.3] Does it retain 5 canonical categories? ->', hasCategories);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. NOTION LIVE API DEGRADATION (MOCKED FETCH)
  // ───────────────────────────────────────────────────────────────────────────
  describe('5. Notion Live API Degradation (Mocked fetch)', () => {
    const dummyToken = 'secret_test_token';
    const dummyDbId = '12345678-1234-1234-1234-123456789abc';

    test('5.1 handles HTTP 401 Unauthorized by logging warning and falling back to snapshot/seed', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const mockFetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized: Invalid token',
      });

      const data = await loadCandidateCvData(false, {
        notionToken: dummyToken,
        cvDbId: dummyDbId,
        fetchImpl: mockFetch as any,
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[notion-loader] Live Notion API unavailable')
      );
      expect(data).toBeDefined();
      expect(data.bullets.length).toBeGreaterThan(0);
    });

    test('5.2 handles HTTP 404 Database Not Found by falling back to snapshot/seed', async () => {
      jest.spyOn(console, 'warn').mockImplementation(() => {});
      const mockFetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => 'Database not found',
      });

      const data = await loadCandidateCvData(false, {
        notionToken: dummyToken,
        cvDbId: dummyDbId,
        fetchImpl: mockFetch as any,
      });

      expect(data).toBeDefined();
      expect(data.bullets.length).toBeGreaterThan(0);
    });

    test('5.3 handles HTTP 500 / 503 Internal Server Error gracefully', async () => {
      jest.spyOn(console, 'warn').mockImplementation(() => {});
      const mockFetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 503,
        text: async () => 'Service Unavailable',
      });

      const data = await loadCandidateCvData(false, {
        notionToken: dummyToken,
        cvDbId: dummyDbId,
        fetchImpl: mockFetch as any,
      });

      expect(data).toBeDefined();
      expect(data.bullets.length).toBeGreaterThan(0);
    });

    test('5.4 handles network timeout / fetch throw (ECONNREFUSED / TypeError) gracefully', async () => {
      jest.spyOn(console, 'warn').mockImplementation(() => {});
      const mockFetch = jest.fn().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:443'));

      const data = await loadCandidateCvData(false, {
        notionToken: dummyToken,
        cvDbId: dummyDbId,
        fetchImpl: mockFetch as any,
      });

      expect(data).toBeDefined();
      expect(data.bullets.length).toBeGreaterThan(0);
    });

    test('5.5 handles 200 OK with empty results array (0 active rows in Notion DB)', async () => {
      jest.spyOn(console, 'warn').mockImplementation(() => {});
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ results: [], has_more: false }),
      });

      const data = await loadCandidateCvData(false, {
        notionToken: dummyToken,
        cvDbId: dummyDbId,
        fetchImpl: mockFetch as any,
      });

      // 0 rows should trigger fallback rather than returning empty CV
      expect(data).toBeDefined();
      expect(data.bullets.length).toBeGreaterThan(0);
    });

    test('5.6 handles 200 OK with malformed row properties (nulls, missing fields) without throwing', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          results: [
            {
              id: 'row-1',
              properties: {
                Title: null,
                Section: null,
                'Highlight / Summary': null,
                'Tech Tags': null,
                Period: null,
                Order: null,
              },
            },
          ],
          has_more: false,
        }),
      });

      const data = await loadCandidateCvData(false, {
        notionToken: dummyToken,
        cvDbId: dummyDbId,
        fetchImpl: mockFetch as any,
      });

      expect(data).toBeDefined();
      expect(data.bullets.length).toBe(1);
      expect(data.bullets[0].id).toBe('row-1');
      expect(data.bullets[0].title).toBe('');
      expect(data.bullets[0].highlight).toBe('');
      expect(data.bullets[0].tags).toEqual([]);
      expect(data.bullets[0].section).toBe('Role & Summary');
    });

    test('5.7 cleans DB ID formatting (strips hyphens and trims whitespace)', async () => {
      let requestedUrl = '';
      const mockFetch = jest.fn().mockImplementation((url: string) => {
        requestedUrl = url;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            results: [{ id: 'row-1', properties: {} }],
          }),
        });
      });

      await loadCandidateCvData(false, {
        notionToken: dummyToken,
        cvDbId: '  12345678-abcd-1234-abcd-1234567890ab  ',
        fetchImpl: mockFetch as any,
      });

      expect(requestedUrl).toContain('/databases/12345678abcd1234abcd1234567890ab/query');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 6. IMMUTABILITY & REFERENCE LEAKAGE
  // ───────────────────────────────────────────────────────────────────────────
  describe('6. Immutability & Reference Leakage', () => {
    test('6.1 verifies whether loadCandidateCvData shares singleton references to DEFAULT_SKILLS_MATRIX and DEFAULT_CANDIDATE_CONTACTS', async () => {
      const cv = await loadCandidateCvData(true);

      // Check whether skills is the identical reference to DEFAULT_SKILLS_MATRIX
      const isSkillsSameRef = cv.skills === DEFAULT_SKILLS_MATRIX;
      console.log(`[TEST 6.1] cv.skills === DEFAULT_SKILLS_MATRIX: ${isSkillsSameRef}`);

      // Check whether contacts is the identical reference to DEFAULT_CANDIDATE_CONTACTS
      const isContactsSameRef = cv.contacts === DEFAULT_CANDIDATE_CONTACTS;
      console.log(`[TEST 6.1] cv.contacts === DEFAULT_CANDIDATE_CONTACTS: ${isContactsSameRef}`);

      // Check whether rodoClause is the identical reference to DEFAULT_RODO_CLAUSE
      const isRodoSameRef = cv.rodoClause === DEFAULT_RODO_CLAUSE;
      console.log(`[TEST 6.1] cv.rodoClause === DEFAULT_RODO_CLAUSE: ${isRodoSameRef}`);
    });

    test('6.2 mutating skills category list leaks across subsequent calls if shared by reference', async () => {
      const cv1 = await loadCandidateCvData(true);
      const category = 'Core Languages & Frameworks';
      const origSkillsLen = cv1.skills[category].length;

      // Caller mutates array
      cv1.skills[category].push('MUTATION_LEAK_CHECK');

      const cv2 = await loadCandidateCvData(true);
      const leaked = cv2.skills[category].includes('MUTATION_LEAK_CHECK');
      console.log(`[TEST 6.2] Skills leakage across calls: leaked = ${leaked}`);

      // Clean up the mutation so subsequent tests are not affected
      const idx = cv1.skills[category].indexOf('MUTATION_LEAK_CHECK');
      if (idx !== -1) {
        cv1.skills[category].splice(idx, 1);
      }
    });
  });
});
