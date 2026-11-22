import {
  generateCoverLetter,
  generateLinkedInPitch,
  selectAchievementBullets,
} from '../../src/generator/cover-letter';
import { DEFAULT_CANDIDATE_CV_DATA } from '../../src/generator/notion-loader';

describe('WP-5.1 & WP-5.2: Dynamic Achievement Selection, No Hardcoded -15%, and Personalized Cover Letter / Pitch', () => {
  const backendJob = {
    title: 'Backend Tech Lead — Node.js / PostgreSQL',
    company: 'CoreData Systems',
    body: 'Looking for a Backend Lead to migrate legacy Java services to Node.js and PostgreSQL microservices.',
    tags: ['Node.js', 'PostgreSQL', 'Backend', 'Java Migration', 'TypeScript'],
  };

  const mobileLeadJob = {
    title: 'Frontend Team Lead — React & React Native',
    company: 'MedCare HealthTech',
    body: 'Lead a team of frontend developers building React Native mobile medical apps and CI/CD pipelines with Firebase.',
    tags: ['React Native', 'HealthTech', 'Team Lead', 'Firebase', 'CI/CD'],
  };

  test('selectAchievementBullets ranks dynamically by job relevance instead of hardcoded triad', () => {
    const backendBullets = selectAchievementBullets(
      DEFAULT_CANDIDATE_CV_DATA,
      backendJob,
      'en'
    );
    const mobileBullets = selectAchievementBullets(
      DEFAULT_CANDIDATE_CV_DATA,
      mobileLeadJob,
      'en'
    );

    expect(backendBullets[0].id).toBe('cv-ach-migration');
    expect(mobileBullets[0].id).toBe('cv-ach-mobile');
    expect(backendBullets.map((b) => b.id)).not.toEqual(mobileBullets.map((b) => b.id));
  });

  test('removes hardcoded -15% cloud costs metric from generateLinkedInPitch (EN & PL)', () => {
    const enPitch = generateLinkedInPitch(DEFAULT_CANDIDATE_CV_DATA, {
      job: backendJob,
      language: 'en',
    });
    const plPitch = generateLinkedInPitch(DEFAULT_CANDIDATE_CV_DATA, {
      job: backendJob,
      language: 'pl',
    });

    expect(enPitch.isValid).toBe(true);
    expect(plPitch.isValid).toBe(true);
    expect(enPitch.text).not.toMatch(/15%|cloud infrastructure costs/i);
    expect(plPitch.text).not.toMatch(/15%|koszty chmurowe/i);
    expect(enPitch.text).toMatch(/Node\.js|PostgreSQL|migration/i);
  });

  test('generates distinct Cover Letters and Pitches for different tech stacks', () => {
    const backendLetter = generateCoverLetter(DEFAULT_CANDIDATE_CV_DATA, {
      job: backendJob,
      language: 'en',
    });
    const mobileLetter = generateCoverLetter(DEFAULT_CANDIDATE_CV_DATA, {
      job: mobileLeadJob,
      language: 'en',
    });

    expect(backendLetter.isValid).toBe(true);
    expect(mobileLetter.isValid).toBe(true);
    expect(backendLetter.text).toContain('backend service architecture');
    expect(mobileLetter.text).toContain('frontend architecture');
    expect(backendLetter.text).not.toBe(mobileLetter.text);
  });

  test('supports personalized pitchHook and custom LLM text in cover letter and pitch', () => {
    const letterWithHook = generateCoverLetter(DEFAULT_CANDIDATE_CV_DATA, {
      job: backendJob,
      language: 'en',
      pitchHook: 'my recent Java-to-Node.js migration directly mirrors your roadmap',
    });
    expect(letterWithHook.isValid).toBe(true);
    expect(letterWithHook.text).toContain('Java-to-Node.js migration directly mirrors your roadmap');

    const pitchWithHook = generateLinkedInPitch(DEFAULT_CANDIDATE_CV_DATA, {
      job: mobileLeadJob,
      language: 'en',
      pitchHook: 'I built a production React Native medical app and led a 4-engineer frontend team.',
    });
    expect(pitchWithHook.isValid).toBe(true);
    expect(pitchWithHook.text).toContain('production React Native medical app');
  });
});
