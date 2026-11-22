import {
  generateCvHtml,
  groupBulletsIntoRoles,
  tailorEmployerSummary,
} from '../../src/generator/cv-renderer';
import { DEFAULT_CANDIDATE_CV_DATA } from '../../src/generator/notion-loader';
import { preRankBullets } from '../../src/generator/pre-ranker';
import { assembleExperienceBullets } from '../../src/generator/bullet-assembler';

describe('WP-5.1: CV Renderer Role-Level Bullet Ordering & Summary Tailoring', () => {
  const experienceBullets = DEFAULT_CANDIDATE_CV_DATA.bullets.filter(
    (b) =>
      ![
        'Role & Summary',
        'Primary Stack',
        'Secondary Stack',
        'Target Role & Leadership',
        'Languages',
      ].includes(b.section)
  );

  const backendJob = {
    title: 'Backend Tech Lead — Node.js / PostgreSQL',
    company: 'ScaleBackend',
    body: 'Own Node.js and NestJS backend services, PostgreSQL schema optimization, and legacy Java migration.',
    tags: ['Node.js', 'NestJS', 'PostgreSQL', 'Backend', 'Java Migration', 'TypeScript'],
  };

  const frontendJob = {
    title: 'Senior Full-Stack / Frontend Engineer (React / TypeScript)',
    company: 'DesignFlow',
    body: 'Build scalable React and Next.js microfrontends, shared UI component library, and WCAG accessibility.',
    tags: ['React', 'TypeScript', 'Frontend', 'Next.js', 'Microfrontends'],
  };

  test('orders bullets within the same role (J&J) by job stack relevance', () => {
    const jjBullets = experienceBullets.filter((b) =>
      b.title.includes('J&J / EPAM Systems')
    );
    expect(jjBullets).toHaveLength(2);

    const backendRoles = groupBulletsIntoRoles(jjBullets, backendJob);
    const aiAnalyticsRoles = groupBulletsIntoRoles(jjBullets, {
      title: 'AI Analytics Lead — GenAI & React',
      body: 'Integrate custom AI agents, GitHub Copilot standards, and charting analytics with React.',
      tags: ['GenAI', 'React', 'GitHub Copilot', 'Mentoring'],
    });

    expect(backendRoles[0].bullets[0].id).toBe('cv-ach-migration');
    expect(aiAnalyticsRoles[0].bullets[0].id).toBe('cv-ach-cost');
    expect(backendRoles[0].tags[0]).toBe('TypeScript');
  });

  test('tailors Professional Summary differently for Backend Lead Node.js vs Full-Stack React/TypeScript', () => {
    const backendRanked = preRankBullets(
      experienceBullets,
      backendJob.title,
      backendJob.body,
      backendJob.tags,
      { limit: 5 }
    );
    const frontendRanked = preRankBullets(
      experienceBullets,
      frontendJob.title,
      frontendJob.body,
      frontendJob.tags,
      { limit: 5 }
    );

    const backendSelected = assembleExperienceBullets(
      backendRanked.map((r) => r.bulletId),
      experienceBullets,
      { sortByCvOrder: false, limit: 5 }
    );
    const frontendSelected = assembleExperienceBullets(
      frontendRanked.map((r) => r.bulletId),
      experienceBullets,
      { sortByCvOrder: false, limit: 5 }
    );

    const backendSummary = tailorEmployerSummary(
      DEFAULT_CANDIDATE_CV_DATA.summary,
      backendSelected,
      backendJob
    );
    const frontendSummary = tailorEmployerSummary(
      DEFAULT_CANDIDATE_CV_DATA.summary,
      frontendSelected,
      frontendJob
    );

    expect(backendSummary).not.toBe(frontendSummary);
    expect(backendSummary).toContain('Backend & Systems Architecture');
    expect(frontendSummary).toContain('Frontend & Full-Stack UI Architecture');

    const backendHtml = generateCvHtml(DEFAULT_CANDIDATE_CV_DATA, backendSelected, {
      language: 'en',
      job: backendJob,
    });
    const frontendHtml = generateCvHtml(DEFAULT_CANDIDATE_CV_DATA, frontendSelected, {
      language: 'en',
      job: frontendJob,
    });

    expect(backendHtml).toContain('Backend &amp; Systems Architecture');
    expect(frontendHtml).toContain('Frontend &amp; Full-Stack UI Architecture');
    expect(backendHtml).not.toBe(frontendHtml);
  });
});
