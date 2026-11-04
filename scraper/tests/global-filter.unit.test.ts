import {
  evaluateGlobalFilter,
  parseDate,
  stripHtml,
} from '../src/utils/global-filter';

const NOW = new Date('2026-11-04T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe('evaluateGlobalFilter', () => {
  const base = {
    title: 'Senior Full-Stack Engineer',
    description: 'We use TypeScript, React and Node.js.',
    publishedAt: daysAgo(3),
  };

  it('keeps a fresh senior JS posting', () => {
    expect(evaluateGlobalFilter(base, NOW)).toBe('ok');
  });

  it('rejects junior titles even with senior words', () => {
    expect(evaluateGlobalFilter({ ...base, title: 'Junior to Senior Developer' }, NOW)).toBe('rejected-level');
  });

  it('rejects titles without a seniority signal', () => {
    expect(evaluateGlobalFilter({ ...base, title: 'Software Engineer' }, NOW)).toBe('not-senior');
  });

  it('rejects postings older than maxAgeDays', () => {
    expect(evaluateGlobalFilter({ ...base, publishedAt: daysAgo(61) }, NOW)).toBe('too-old');
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
