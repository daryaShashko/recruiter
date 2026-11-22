import {
  assembleExperienceBullets,
  DEFAULT_CV_BULLET_LIMIT,
} from '../../src/generator/bullet-assembler';
import { DEFAULT_CV_BULLETS } from '../../src/generator/notion-loader';
import { preRankBullets } from '../../src/generator/pre-ranker';

describe('WP-5.1: Bullet Assembler Real Ranking & Limit Preservation', () => {
  const experienceBullets = DEFAULT_CV_BULLETS.filter(
    (b) =>
      ![
        'Role & Summary',
        'Primary Stack',
        'Secondary Stack',
        'Target Role & Leadership',
        'Languages',
      ].includes(b.section)
  );

  test('preserves real preRankBullets relevance order when sortByCvOrder is false', () => {
    const backendRanked = preRankBullets(
      experienceBullets,
      'Backend Lead — Node.js / PostgreSQL',
      'Lead backend migration from Java/MySQL to Node.js and PostgreSQL microservices.',
      ['Node.js', 'PostgreSQL', 'Backend', 'Java Migration', 'TypeScript'],
      { limit: 4 }
    );
    const frontendRanked = preRankBullets(
      experienceBullets,
      'Frontend Team Lead — React / React Native',
      'Lead a frontend team building React Native mobile apps and microfrontends in HealthTech.',
      ['React', 'React Native', 'Frontend', 'Team Lead', 'HealthTech'],
      { limit: 4 }
    );

    const backendAssembled = assembleExperienceBullets(
      backendRanked.map((r) => r.bulletId),
      experienceBullets,
      { sortByCvOrder: false, limit: 4 }
    );
    const frontendAssembled = assembleExperienceBullets(
      frontendRanked.map((r) => r.bulletId),
      experienceBullets,
      { sortByCvOrder: false, limit: 4 }
    );

    expect(backendAssembled).toHaveLength(4);
    expect(frontendAssembled).toHaveLength(4);
    expect(backendAssembled.map((b) => b.id)).not.toEqual(
      frontendAssembled.map((b) => b.id)
    );
    expect(backendAssembled[0].id).toBe('cv-ach-migration');
    expect(frontendAssembled[0].id).toBe('cv-ach-mobile');
  });

  test('applies limit to top-ranked bullets BEFORE optional sortByCvOrder', () => {
    const rankedIds = ['cv-ach-mobile', 'cv-ach-migration', 'cv-recent-6m', 'cv-ai-tools'];
    const result = assembleExperienceBullets(rankedIds, experienceBullets, {
      limit: 2,
      sortByCvOrder: true,
    });

    expect(result).toHaveLength(2);
    // Top 2 ranked are cv-ach-mobile (order 12) and cv-ach-migration (order 9) -> sorted by order: 9, 12
    expect(result.map((b) => b.id)).toEqual(['cv-ach-migration', 'cv-ach-mobile']);
  });

  test('exports sensible DEFAULT_CV_BULLET_LIMIT', () => {
    expect(DEFAULT_CV_BULLET_LIMIT).toBeGreaterThanOrEqual(4);
    expect(DEFAULT_CV_BULLET_LIMIT).toBeLessThanOrEqual(6);
  });
});
