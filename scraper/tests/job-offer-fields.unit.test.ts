import { computeJobFingerprint, JobOffer } from '../src/types';
import { normalizeOffer } from '../src/scrapers/justjoin';
import { parseDate } from '../src/utils/global-filter';

test('computeJobFingerprint produces deterministic 16-char hex', () => {
  const fp = computeJobFingerprint('Acme Corp', 'Senior Engineer');
  expect(fp).toMatch(/^[0-9a-f]{16}$/);
  expect(computeJobFingerprint('Acme Corp', 'Senior Engineer')).toBe(fp);
});

test('normalizeOffer populates publishedAt and fingerprint', () => {
  const raw = {
    guid: '123',
    slug: 'test-slug',
    title: 'Backend Engineer',
    workplaceType: 'remote',
    workingTime: '',
    experienceLevel: 'senior',
    city: 'Warsaw',
    companyName: 'TechCo',
    publishedAt: '2023-01-15T12:00:00Z',
    locations: [],
    employmentTypes: [],
    requiredSkills: [],
    niceToHaveSkills: [],
  } as any;

  const offer = normalizeOffer(raw);
  expect(offer.publishedAt).toBe('2023-01-15T12:00:00.000Z');
  expect(offer.fingerprint).toBe(computeJobFingerprint('TechCo', 'Backend Engineer'));
});

test('computeJobFingerprint is invariant to legal forms, case, seniority and spelling variants', () => {
  const base = computeJobFingerprint('Acme', 'Fullstack Engineer');
  expect(computeJobFingerprint('ACME Sp. z o.o.', 'Senior Full-Stack Engineer')).toBe(base);
  expect(computeJobFingerprint('Acme GmbH', 'Full Stack Engineer (m/f/d)')).toBe(base);
  expect(computeJobFingerprint('Acme', 'Backend Engineer')).not.toBe(base);
  expect(computeJobFingerprint('Other', 'Fullstack Engineer')).not.toBe(base);
});
