import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  DEFAULT_CANDIDATE_CV_DATA,
  DEFAULT_CV_BULLETS,
  DEFAULT_SKILLS_MATRIX,
  loadCandidateCvData,
  normalizeSnapshotData,
  sanitizeProfileHighlightText,
  sanitizeProfileTags,
} from '../../src/generator/notion-loader';

describe('WP-7.1: Unified Notion Snapshot Loader & Strict No-Python Sync', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notion-loader-unit-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('removes all mentions of Python from DEFAULT_SKILLS_MATRIX, DEFAULT_CV_BULLETS, and DEFAULT_CANDIDATE_CV_DATA', () => {
    const allSkills = Object.values(DEFAULT_SKILLS_MATRIX).flat();
    expect(allSkills.some((s) => /python/i.test(s))).toBe(false);
    expect(DEFAULT_CANDIDATE_CV_DATA.summary).not.toMatch(/\bpython\b/i);

    for (const bullet of DEFAULT_CV_BULLETS) {
      expect(bullet.title).not.toMatch(/\bpython\b/i);
      expect(bullet.highlight).not.toMatch(/\bpython\b/i);
      expect(bullet.tags.some((t) => /python/i.test(t))).toBe(false);
    }

    // Core JS/TS/Node.js/React/NestJS/AWS stack remains intact
    expect(DEFAULT_SKILLS_MATRIX['Core Languages & Frameworks']).toEqual(
      expect.arrayContaining(['TypeScript', 'JavaScript', 'Node.js', 'React', 'Next.js', 'NestJS'])
    );
    expect(DEFAULT_SKILLS_MATRIX['Architecture & Infra']).toContain('AWS');
  });

  test('loads candidate profile from unified .notion-snapshot.json structure (cvEntries / rawCv) and strips internal negative directives', async () => {
    const snapshotPath = path.join(tempDir, '.notion-snapshot.json');
    const mockSnapshot = {
      syncedAt: '2026-11-16T11:19:02.438Z',
      activeCvCount: 2,
      cvEntries: [
        {
          id: 'page-uuid-1',
          title: 'Senior Forward Deployed & Full-Stack Engineer',
          section: 'Role & Summary',
          highlight:
            'Senior Forward Deployed & Full-Stack Engineer with 10 years in JS/TS. Strictly works with JavaScript, TypeScript, and Node.js (no Java, Python, C#, or Go backend). Not seeking roles setting up infrastructure or DevOps from scratch.',
          tags: ['TypeScript', 'React', 'Node.js', 'Python'],
          period: 'Core Profile',
          order: 1,
          active: true,
        },
        {
          id: 'page-uuid-9',
          title: 'Backend Migration: Java to Node.js',
          section: 'Key Achievement',
          highlight: 'Migrated core backend from Java to Node.js and MySQL to PostgreSQL.',
          tags: ['Node.js', 'PostgreSQL', 'Backend'],
          period: 'Key Win',
          order: 9,
          active: true,
        },
      ],
    };
    fs.writeFileSync(snapshotPath, JSON.stringify(mockSnapshot), 'utf-8');

    const loaded = await loadCandidateCvData(true, { snapshotPath });
    expect(loaded.bullets).toHaveLength(2);
    expect(loaded.summary).not.toMatch(/\bpython\b/i);
    expect(loaded.summary).not.toMatch(/Not seeking roles setting up infrastructure/i);
    expect(loaded.bullets[0].tags).not.toContain('Python');
    expect(loaded.bullets[1].slug).toBe('cv-ach-migration');
  });

  test('supports rawCv array fallback when cvEntries is absent in snapshot', () => {
    const normalized = normalizeSnapshotData({
      rawCv: [
        {
          id: 'raw-1',
          title: 'Primary Tech Stack',
          section: 'Primary Stack',
          highlight: 'JavaScript, TypeScript, React, Node.js, NestJS. Strictly JavaScript/TypeScript ecosystem only (no Python, Java, C#, Go, PHP).',
          tags: ['TypeScript', 'Node.js', 'Python'],
          order: 3,
          active: true,
        },
      ],
    });

    expect(normalized).not.toBeNull();
    expect(normalized!.bullets[0].highlight).not.toMatch(/\bpython\b/i);
    expect(normalized!.bullets[0].tags).toEqual(['TypeScript', 'Node.js']);
  });

  test('sanitize helpers strip Python and internal evaluator notes cleanly', () => {
    expect(
      sanitizeProfileHighlightText('Node.js/NestJS and Python backend delivery')
    ).toBe('Node.js/NestJS backend delivery');
    expect(sanitizeProfileTags(['TypeScript', 'Python', 'Node.js', 'python'])).toEqual([
      'TypeScript',
      'Node.js',
    ]);
  });
});
