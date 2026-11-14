import { JobOffer, WebhookPayload, EvaluationResult } from '../../src/types';

export function assertValidJobOffer(offer: unknown): asserts offer is JobOffer {
  expect(typeof offer).toBe('object');
  expect(offer).not.toBeNull();
  const o = offer as Record<string, unknown>;
  expect(typeof o.id).toBe('string');
  expect(typeof o.title).toBe('string');
  expect(typeof o.company).toBe('string');
  expect(typeof o.url).toBe('string');
  expect(o.url as string).toMatch(/^https?:\/\//);
  expect([
    'justjoin',
    'nofluffjobs',
    'thehub',
    'swissdevjobs',
    'adzuna',
    'linkedin',
    'manual',
    'greenhouse',
    'lever',
    'ashby',
    'workable',
    'recruitee',
    'personio',
  ]).toContain(o.source);
  expect(typeof o.body).toBe('string');
  expect(typeof o.scrapedAt).toBe('string');
}

export function assertValidWebhookPayload(payload: unknown): asserts payload is WebhookPayload {
  expect(typeof payload).toBe('object');
  expect(payload).not.toBeNull();
  const p = payload as Record<string, unknown>;
  expect(Array.isArray(p.jobs)).toBe(true);
  for (const job of p.jobs as unknown[]) {
    assertValidJobOffer(job);
  }
  expect(typeof p.meta).toBe('object');
  expect(p.meta).not.toBeNull();
  const meta = p.meta as Record<string, unknown>;
  expect(typeof meta.source).toBe('string');
  expect(typeof meta.count).toBe('number');
  expect(typeof meta.sentAt).toBe('string');
}

export function assertValidEvaluationResult(evalRes: unknown): asserts evalRes is EvaluationResult {
  expect(typeof evalRes).toBe('object');
  expect(evalRes).not.toBeNull();
  const e = evalRes as Record<string, unknown>;
  expect(typeof e.match).toBe('boolean');
  expect(typeof e.reason).toBe('string');
  expect(typeof e.url).toBe('string');
}

describe('Tier 2: Core Schema Contracts', () => {
  it('validates a compliant JobOffer', () => {
    const offer: JobOffer = {
      id: 'test-job-123',
      title: 'Senior TypeScript Engineer',
      company: 'TechCorp Sp. z o.o.',
      url: 'https://example.com/jobs/123',
      body: 'Full stack development with Node.js and React.',
      source: 'justjoin',
      scrapedAt: new Date().toISOString(),
    };
    expect(() => assertValidJobOffer(offer)).not.toThrow();
  });

  it('validates a compliant WebhookPayload', () => {
    const payload: WebhookPayload = {
      jobs: [
        {
          id: 'jj-456',
          title: 'Full Stack Developer',
          company: 'Acme',
          url: 'https://justjoin.it/offers/456',
          body: 'Job description text',
          source: 'justjoin',
          scrapedAt: new Date().toISOString(),
        },
      ],
      meta: {
        source: 'justjoin',
        count: 1,
        sentAt: new Date().toISOString(),
      },
    };
    expect(() => assertValidWebhookPayload(payload)).not.toThrow();
  });

  it('validates a compliant EvaluationResult', () => {
    const evalResult: EvaluationResult = {
      match: true,
      reason: 'Strong match on TypeScript and backend engineering experience.',
      url: 'https://example.com/jobs/123',
    };
    expect(() => assertValidEvaluationResult(evalResult)).not.toThrow();
  });
});
