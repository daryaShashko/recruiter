import {
  evaluateGlobalFilter,
  matchesRoleFamily,
  parseDate,
  passesAgeFilter,
  passesTitleFilter,
  stripHtml,
} from '../src/utils/global-filter';

const NOW = new Date('2026-11-04T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe('passesTitleFilter', () => {
  it('allows standard product and engineering titles without requiring senior keywords', () => {
    expect(passesTitleFilter('Product Engineer')).toBe(true);
    expect(passesTitleFilter('Software Engineer')).toBe(true);
    expect(passesTitleFilter('Fullstack Developer')).toBe(true);
    expect(passesTitleFilter('Frontend Engineer')).toBe(true);
    expect(passesTitleFilter('Senior Software Engineer')).toBe(true);
    expect(passesTitleFilter('Staff Product Engineer')).toBe(true);
  });

  it('rejects junior and trainee titles', () => {
    expect(passesTitleFilter('Junior Software Engineer')).toBe(false);
    expect(passesTitleFilter('Frontend Intern')).toBe(false);
    expect(passesTitleFilter('Software Engineering Trainee')).toBe(false);
    expect(passesTitleFilter('Junior to Senior Developer')).toBe(false);
  });

  it('rejects non-target role families (ADR-028)', () => {
    expect(passesTitleFilter('Senior QA Engineer')).toBe(false);
    expect(passesTitleFilter('Lead DevOps Architect')).toBe(false);
    expect(passesTitleFilter('Site Reliability Engineer')).toBe(false);
    expect(passesTitleFilter('SRE Lead')).toBe(false);
    expect(passesTitleFilter('Customer Support Specialist')).toBe(false);
    expect(passesTitleFilter('Technical Support Engineer')).toBe(false);
    expect(passesTitleFilter('Senior Sales Engineer')).toBe(false);
    expect(passesTitleFilter('Data Engineer')).toBe(false);
    expect(passesTitleFilter('Senior Data Scientist')).toBe(false);
    expect(passesTitleFilter('Mobile Developer (iOS)')).toBe(false);
    expect(passesTitleFilter('Android Engineer')).toBe(false);
  });

  it('does not falsely reject words containing role substrings without word boundaries', () => {
    // "qa" inside "equal", "sre" inside "disregard"
    expect(passesTitleFilter('Equal Opportunity Software Engineer')).toBe(true);
    expect(passesTitleFilter('Disregard Test Role')).toBe(true);
  });
});

describe('matchesRoleFamily', () => {
  it('matches role families on word boundaries', () => {
    expect(matchesRoleFamily('QA Engineer')).toBe(true);
    expect(matchesRoleFamily('Senior SRE')).toBe(true);
    expect(matchesRoleFamily('DevOps Specialist')).toBe(true);
  });

  it('does not match substrings without word boundaries', () => {
    expect(matchesRoleFamily('Equal Opportunity Employer')).toBe(false);
    expect(matchesRoleFamily('Disregard')).toBe(false);
  });
});

describe('passesAgeFilter', () => {
  it('evaluates freshness with default 60 days for aggregators', () => {
    expect(passesAgeFilter(daysAgo(30), NOW)).toBe(true);
    expect(passesAgeFilter(daysAgo(59), NOW)).toBe(true);
    expect(passesAgeFilter(daysAgo(61), NOW)).toBe(false);
    expect(passesAgeFilter(daysAgo(100), NOW)).toBe(false);
  });

  it('evaluates freshness with custom maxAgeDays (e.g. 180 days for ATS)', () => {
    expect(passesAgeFilter(daysAgo(70), NOW, 180)).toBe(true);
    expect(passesAgeFilter(daysAgo(179), NOW, 180)).toBe(true);
    expect(passesAgeFilter(daysAgo(181), NOW, 180)).toBe(false);
  });

  it('allows numeric maxAgeDays as second argument', () => {
    expect(passesAgeFilter(daysAgo(70), 180)).toBe(true);
  });

  it('allows postings without publish date', () => {
    expect(passesAgeFilter(undefined)).toBe(true);
  });
});

describe('evaluateGlobalFilter', () => {
  const base = {
    title: 'Senior Full-Stack Engineer',
    description: 'We use TypeScript, React and Node.js.',
    publishedAt: daysAgo(3),
  };

  it('keeps a fresh senior JS posting', () => {
    expect(evaluateGlobalFilter(base, NOW)).toBe('ok');
  });

  it('allows titles without senior words like Product Engineer and Software Engineer', () => {
    expect(evaluateGlobalFilter({ ...base, title: 'Software Engineer' }, NOW)).toBe('ok');
    expect(evaluateGlobalFilter({ ...base, title: 'Product Engineer' }, NOW)).toBe('ok');
    expect(evaluateGlobalFilter({ ...base, title: 'Frontend Developer' }, NOW)).toBe('ok');
  });

  it('rejects junior titles even with senior words', () => {
    expect(evaluateGlobalFilter({ ...base, title: 'Junior to Senior Developer' }, NOW)).toBe('rejected-level');
  });

  it('rejects role families with rejected-role status', () => {
    expect(evaluateGlobalFilter({ ...base, title: 'Senior QA Engineer' }, NOW)).toBe('rejected-role');
    expect(evaluateGlobalFilter({ ...base, title: 'DevOps Engineer' }, NOW)).toBe('rejected-role');
    expect(evaluateGlobalFilter({ ...base, title: 'Customer Support Lead' }, NOW)).toBe('rejected-role');
    expect(evaluateGlobalFilter({ ...base, title: 'Staff Data Engineer' }, NOW)).toBe('rejected-role');
  });

  it('ensures Product Engineer without explicit stack in title or description is not dropped by no-js-signal', () => {
    expect(
      evaluateGlobalFilter(
        {
          title: 'Product Engineer',
          description: 'We build intuitive workflows and delightful user experiences.',
          publishedAt: daysAgo(3),
        },
        NOW,
      ),
    ).toBe('ok');
  });

  it('rejects postings older than maxAgeDays (default 60 days)', () => {
    expect(evaluateGlobalFilter({ ...base, publishedAt: daysAgo(61) }, NOW)).toBe('too-old');
  });

  it('allows postings older than 60 days when atsMaxAgeDays (180 days) is used', () => {
    expect(
      evaluateGlobalFilter(
        { ...base, publishedAt: daysAgo(90), maxAgeDays: 180 },
        NOW,
      ),
    ).toBe('ok');
    expect(
      evaluateGlobalFilter(
        { ...base, publishedAt: daysAgo(90), source: 'ats' },
        NOW,
      ),
    ).toBe('ok');
    expect(
      evaluateGlobalFilter(
        { ...base, publishedAt: daysAgo(90), source: 'greenhouse' },
        NOW,
      ),
    ).toBe('ok');
    expect(
      evaluateGlobalFilter(
        { ...base, publishedAt: daysAgo(181), source: 'greenhouse' },
        NOW,
      ),
    ).toBe('too-old');
  });

  it('keeps postings without a publish date', () => {
    expect(evaluateGlobalFilter({ ...base, publishedAt: undefined }, NOW)).toBe('ok');
  });

  it('rejects expired postings', () => {
    expect(evaluateGlobalFilter({ ...base, expiresAt: daysAgo(1) }, NOW)).toBe('expired');
  });

  it('does not treat "java" as a JS signal', () => {
    expect(
      evaluateGlobalFilter({ ...base, title: 'Senior Java Engineer', description: 'Java, Spring, Kotlin' }, NOW),
    ).toBe('no-js-signal');
  });

  it('ignores optional JavaScript mentions', () => {
    expect(
      evaluateGlobalFilter({
        ...base,
        title: 'Senior Software Engineer',
        description: 'JavaScript is a nice to have, not a requirement.',
      }, NOW),
    ).toBe('no-js-signal');
  });

  it('keeps required JS/TS signals beside optional technologies', () => {
    expect(
      evaluateGlobalFilter({
        ...base,
        title: 'Senior Software Engineer',
        description: 'TypeScript is required; React is a plus.',
      }, NOW),
    ).toBe('ok');
  });

  it('ignores technologies listed under an optional section', () => {
    expect(
      evaluateGlobalFilter({
        ...base,
        title: 'Senior Java Engineer',
        description: 'Requirements:\nJava and Spring.\nNice to have:\nJavaScript, React',
      }, NOW),
    ).toBe('no-js-signal');
  });

  it('does not match the verb "react" as the React framework', () => {
    expect(
      evaluateGlobalFilter({
        ...base,
        title: 'Senior Engagement Manager',
        description: 'Have situational awareness and react appropriately in group settings.',
      }, NOW),
    ).toBe('no-js-signal');
  });

  it('requires explicit JS/TS relevance for Java and C# primary roles', () => {
    expect(
      evaluateGlobalFilter({
        ...base,
        title: 'Senior Java Engineer',
        description: 'JavaScript is a plus.',
      }, NOW),
    ).toBe('no-js-signal');
    expect(
      evaluateGlobalFilter({
        ...base,
        title: 'Senior C# Engineer',
        description: 'React is preferred.',
      }, NOW),
    ).toBe('no-js-signal');
  });

  it('keeps Java primary roles when TypeScript is explicitly required', () => {
    expect(
      evaluateGlobalFilter({
        ...base,
        title: 'Senior Java Engineer',
        description: 'Requirements:\nJava and TypeScript.',
      }, NOW),
    ).toBe('ok');
  });

  it('accepts JS signal from tags only', () => {
    expect(
      evaluateGlobalFilter({ ...base, description: '', tags: ['TypeScript'] }, NOW),
    ).toBe('ok');
  });

  it('rejects hard legal blockers', () => {
    expect(
      evaluateGlobalFilter({ ...base, description: 'React. Must be a US citizen. Security clearance required.' }, NOW),
    ).toBe('legal-blocker');
  });
});

describe('parseDate', () => {
  it('parses ISO strings', () => {
    expect(parseDate('2026-11-01T10:00:00Z')?.toISOString()).toBe('2026-11-01T10:00:00.000Z');
  });
  it('parses dd.mm.yyyy', () => {
    expect(parseDate('04.10.2023')?.toISOString()).toBe('2023-10-04T00:00:00.000Z');
  });
  it('parses epoch ms', () => {
    expect(parseDate(1700000000000)?.getTime()).toBe(1700000000000);
  });
  it('returns undefined for garbage', () => {
    expect(parseDate('not a date')).toBeUndefined();
    expect(parseDate(null)).toBeUndefined();
    expect(parseDate('')).toBeUndefined();
  });
});

describe('stripHtml', () => {
  it('removes tags and decodes basic entities', () => {
    expect(stripHtml('<p>A &amp; B</p><ul><li>React</li></ul>')).toBe('A & B\nReact');
  });

  it('strips HTML-escaped tags before stack matching', () => {
    const description = stripHtml(
      '&lt;p data-path-to-node="2"&gt;Campaign planning&lt;/p&gt;',
    );

    expect(description).toBe('Campaign planning');
    expect(
      evaluateGlobalFilter({
        title: 'Principal Campaign Manager',
        description,
        publishedAt: daysAgo(3),
      }, NOW),
    ).toBe('no-js-signal');
  });
});
