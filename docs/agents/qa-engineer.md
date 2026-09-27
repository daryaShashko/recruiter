# Роль: QA / Test Engineer

> **Роль-заметка.** Обычный текстовый файл с правилами и чеклистами для тестов (Jest, Playwright, edge cases, покрытие). Читай его, когда задача касается тестов или расследования бага (см. `AGENTS.md`). Это не определение агента и не системный промпт; он не запускает других агентов и не передаёт им работу.

---

## Роль и контекст проекта

You are a **QA / Test Engineer** for an automated AI recruiter pipeline. Your job is to write tests that are fast, deterministic, and CI-safe by default, while also covering the real integration paths when explicitly enabled.

**Pipeline under test:**
```
GitHub Actions (Playwright scraper)
  → POST to n8n Webhook
    → Ollama LLM evaluation
      → Notion database + Telegram alerts
```

**Test toolchain (exact versions in use):**
- `jest` 29 + `ts-jest` 29 — unit and integration test runner
- `playwright` 1.45 — used in scraper tests via `page.route()` for mocking
- TypeScript 5.5, Node.js 20
- `jest.config` is embedded in `scraper/package.json` (`"jest": { "preset": "ts-jest", "testEnvironment": "node", "testTimeout": 60000 }`)

**Existing test files:**
- `scraper/tests/justjoin.test.ts` — live integration test for JustJoin scraper
- `scraper/tests/nofluffjobs.test.ts` — live integration test for NoFluffJobs scraper

**CI entry point:** `.github/workflows/scraper.yml` (scheduled daily + `workflow_dispatch`)

---

## Структура тестов

Tests live in `scraper/tests/`. Use this naming convention:

```
scraper/tests/
├── unit/
│   ├── justjoin.unit.test.ts      ← mock XHR, test normalizeOffer, filter logic
│   ├── nofluffjobs.unit.test.ts   ← same for NoFluffJobs
│   ├── sender.unit.test.ts        ← mock axios, test retry/backoff logic
│   ├── dedup.unit.test.ts         ← test deduplicateOffers from index.ts
│   └── schema.test.ts             ← JobOffer schema validation for all sources
├── integration/
│   ├── justjoin.integration.test.ts    ← live browser, skipped unless RUN_INTEGRATION=1
│   └── nofluffjobs.integration.test.ts ← live browser, skipped unless RUN_INTEGRATION=1
├── justjoin.test.ts       ← existing live test (keep as-is for backward compat)
└── nofluffjobs.test.ts    ← existing live test (keep as-is for backward compat)
```

When proposing new tests, always place them in the appropriate subdirectory and update the npm scripts in `package.json` if needed.

---

## Канонические интерфейсы (что тестируем)

All test assertions must validate against the `JobOffer` interface from `src/types.ts`:

```typescript
interface JobOffer {
  id: string;          // required, non-empty, unique within a source
  title: string;       // required, non-empty
  company: string;     // required (may be empty string for NoFluffJobs — known limitation)
  url: string;         // required, valid HTTPS URL
  body: string;        // required, non-empty (may equal title if description unavailable)
  source: 'justjoin' | 'nofluffjobs' | 'linkedin' | 'manual'; // required, matches site
  location?: string;   // optional — "Remote" or city name
  salary?: string;     // optional — human-readable
  tags?: string[];     // optional — lowercase strings
  scrapedAt: string;   // required — valid ISO 8601 timestamp
}
```

---

## Категории тестов

### 1. Unit Tests — мок браузера и HTTP

Unit tests must run in CI without network access. Every external dependency (Playwright browser, axios HTTP, `Date.now()`) must be mocked.

#### Scraper unit tests — mock XHR with `page.route()`

Use Playwright's `page.route()` to intercept and mock API responses without hitting real servers. Wrap in `describe.skip` guarded by the env flag, or use `jest.mock` to replace `openPage`.

**Preferred approach:** mock `openPage` at the module level, inject a fake `page` and `context`, then simulate the `response` event.

```typescript
// tests/unit/justjoin.unit.test.ts
import { scrapeJustJoin } from '../../src/scrapers/justjoin';

// Mock the entire browser utility so no real browser launches
jest.mock('../../src/utils/browser', () => ({
  openPage: jest.fn(),
}));

import { openPage } from '../../src/utils/browser';
const mockOpenPage = openPage as jest.MockedFunction<typeof openPage>;

const FIXTURE_OFFERS = [
  {
    id: 'abc',
    slug: 'senior-ts-dev',
    title: 'Senior TypeScript Developer',
    companyName: 'Acme Corp',
    city: 'Gdansk',
    workplaceType: 'hybrid',
    salaryFrom: 15000,
    salaryTo: 20000,
    salaryCurrency: 'PLN',
    requiredSkills: [{ name: 'TypeScript', level: 3 }, { name: 'Node.js', level: 2 }],
    body: 'We are looking for a senior TS developer...',
  },
];

function makeMockPage(responseHandlers: Array<(r: unknown) => void>) {
  return {
    on: (event: string, handler: (r: unknown) => void) => {
      if (event === 'response') responseHandlers.push(handler);
    },
    goto: jest.fn().mockResolvedValue(null),
    waitForTimeout: jest.fn().mockResolvedValue(undefined),
    setDefaultNavigationTimeout: jest.fn(),
    setDefaultTimeout: jest.fn(),
  };
}

function makeMockResponse(url: string, json: unknown, ok = true) {
  return {
    url: () => url,
    ok: () => ok,
    status: () => (ok ? 200 : 500),
    json: () => Promise.resolve(json),
  };
}

describe('scrapeJustJoin — unit', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('Given a valid API response, When scraping, Then returns normalized JobOffer[]', async () => {
    const responseHandlers: Array<(r: unknown) => void> = [];
    const mockContext = { close: jest.fn().mockResolvedValue(undefined) };
    const mockPage = makeMockPage(responseHandlers);

    mockOpenPage.mockResolvedValue({ page: mockPage as never, context: mockContext as never });

    // Schedule the mock response to fire after goto is called
    mockPage.goto.mockImplementation(async () => {
      const fakeResponse = makeMockResponse(
        'https://api.justjoin.it/v2/user-panel/offers?page=1',
        { data: FIXTURE_OFFERS }
      );
      for (const handler of responseHandlers) {
        await handler(fakeResponse);
      }
    });

    const offers = await scrapeJustJoin();

    expect(offers).toHaveLength(1);
    expect(offers[0].id).toBe('justjoin_senior-ts-dev');
    expect(offers[0].source).toBe('justjoin');
    expect(offers[0].title).toBe('Senior TypeScript Developer');
    expect(offers[0].salary).toBe('15000–20000 PLN');
    expect(offers[0].tags).toEqual(['typescript', 'node.js']);
    expect(mockContext.close).toHaveBeenCalledTimes(1);
  });

  it('Given an empty API response, When scraping, Then returns []', async () => {
    const responseHandlers: Array<(r: unknown) => void> = [];
    const mockContext = { close: jest.fn().mockResolvedValue(undefined) };
    const mockPage = makeMockPage(responseHandlers);
    mockOpenPage.mockResolvedValue({ page: mockPage as never, context: mockContext as never });

    mockPage.goto.mockImplementation(async () => {
      const fakeResponse = makeMockResponse(
        'https://api.justjoin.it/v2/user-panel/offers?page=1',
        { data: [] }
      );
      for (const handler of responseHandlers) await handler(fakeResponse);
    });

    const offers = await scrapeJustJoin();
    expect(offers).toEqual([]);
  });

  it('Given malformed JSON from the API, When scraping, Then returns [] without throwing', async () => {
    const responseHandlers: Array<(r: unknown) => void> = [];
    const mockContext = { close: jest.fn().mockResolvedValue(undefined) };
    const mockPage = makeMockPage(responseHandlers);
    mockOpenPage.mockResolvedValue({ page: mockPage as never, context: mockContext as never });

    mockPage.goto.mockImplementation(async () => {
      const badResponse = {
        url: () => 'https://api.justjoin.it/v2/user-panel/offers?page=1',
        ok: () => true,
        json: () => Promise.reject(new SyntaxError('Unexpected token < in JSON')),
      };
      for (const handler of responseHandlers) await handler(badResponse);
    });

    await expect(scrapeJustJoin()).resolves.toEqual([]);
  });

  it('Given a network timeout, When scraping, Then returns [] without throwing', async () => {
    const mockContext = { close: jest.fn().mockResolvedValue(undefined) };
    mockOpenPage.mockResolvedValue({
      page: {
        on: jest.fn(),
        goto: jest.fn().mockRejectedValue(new Error('Navigation timeout 30000ms exceeded')),
        setDefaultNavigationTimeout: jest.fn(),
        setDefaultTimeout: jest.fn(),
      } as never,
      context: mockContext as never,
    });

    await expect(scrapeJustJoin()).resolves.toEqual([]);
    expect(mockContext.close).toHaveBeenCalledTimes(1); // context always closed
  });
});
```

#### Sender unit tests — mock axios

```typescript
// tests/unit/sender.unit.test.ts
import { sendToWebhook } from '../../src/sender';
import { JobOffer } from '../../src/types';

jest.mock('axios');
import axios from 'axios';
const mockPost = axios.post as jest.MockedFunction<typeof axios.post>;

const SAMPLE_OFFER: JobOffer = {
  id: 'justjoin_test-offer',
  title: 'Test Offer',
  company: 'Test Corp',
  url: 'https://justjoin.it/job-offer/test-offer',
  body: 'Full description',
  source: 'justjoin',
  scrapedAt: new Date().toISOString(),
};

describe('sendToWebhook — unit', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.WEBHOOK_URL = 'https://n8n.example.com/webhook/test';
  });

  it('Given a 200 response, When sending, Then resolves without retrying', async () => {
    mockPost.mockResolvedValueOnce({ status: 200, statusText: 'OK' });

    await sendToWebhook([SAMPLE_OFFER], 'test');

    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith(
      'https://n8n.example.com/webhook/test',
      expect.objectContaining({ jobs: [SAMPLE_OFFER] }),
      expect.any(Object)
    );
  });

  it('Given two 5xx failures then a 200, When sending, Then retries and eventually resolves', async () => {
    const axiosError = Object.assign(new Error('Internal Server Error'), {
      response: { status: 500 },
      isAxiosError: true,
    });
    mockPost
      .mockRejectedValueOnce(axiosError)
      .mockRejectedValueOnce(axiosError)
      .mockResolvedValueOnce({ status: 200, statusText: 'OK' });

    await sendToWebhook([SAMPLE_OFFER], 'test');
    expect(mockPost).toHaveBeenCalledTimes(3);
  });

  it('Given all retries exhausted, When sending, Then throws with descriptive message', async () => {
    const axiosError = Object.assign(new Error('Service Unavailable'), {
      response: { status: 503 },
      isAxiosError: true,
    });
    mockPost.mockRejectedValue(axiosError);

    await expect(sendToWebhook([SAMPLE_OFFER], 'test')).rejects.toThrow(
      /All \d+ attempts failed/
    );
    expect(mockPost).toHaveBeenCalledTimes(3); // config.sender.maxRetries = 3
  });

  it('Given a webhook timeout, When sending, Then retries and eventually throws', async () => {
    mockPost.mockRejectedValue(Object.assign(new Error('timeout of 15000ms exceeded'), {
      code: 'ECONNABORTED',
      isAxiosError: true,
    }));

    await expect(sendToWebhook([SAMPLE_OFFER], 'test')).rejects.toThrow(/All.*attempts failed/);
  });

  it('Given an empty jobs array, When sending, Then still POSTs with count: 0', async () => {
    mockPost.mockResolvedValueOnce({ status: 200, statusText: 'OK' });

    await sendToWebhook([], 'test');

    expect(mockPost).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ jobs: [], meta: expect.objectContaining({ count: 0 }) }),
      expect.any(Object)
    );
  });
});
```

#### Deduplication unit tests

```typescript
// tests/unit/dedup.unit.test.ts
// deduplicateOffers is not exported — test it via the index behavior or extract it.
// Recommendation: export it from index.ts for testability.
import { JobOffer } from '../../src/types';

// If deduplicateOffers is not yet exported, paste the implementation here for isolated testing:
function deduplicateOffers(offers: JobOffer[]): JobOffer[] {
  const seen = new Set<string>();
  return offers.filter((offer) => {
    if (seen.has(offer.id)) return false;
    seen.add(offer.id);
    return true;
  });
}

const makeOffer = (id: string, source: JobOffer['source'] = 'justjoin'): JobOffer => ({
  id,
  title: `Job ${id}`,
  company: 'Corp',
  url: `https://example.com/${id}`,
  body: 'desc',
  source,
  scrapedAt: new Date().toISOString(),
});

describe('deduplicateOffers — unit', () => {
  it('Given unique IDs, When deduplicating, Then returns all offers unchanged', () => {
    const offers = [makeOffer('a'), makeOffer('b'), makeOffer('c')];
    expect(deduplicateOffers(offers)).toHaveLength(3);
  });

  it('Given duplicate IDs from different scrapers, When deduplicating, Then keeps only first occurrence', () => {
    const offers = [makeOffer('dup-1'), makeOffer('dup-1'), makeOffer('unique-1')];
    const result = deduplicateOffers(offers);
    expect(result).toHaveLength(2);
    expect(result.map((o) => o.id)).toEqual(['dup-1', 'unique-1']);
  });

  it('Given an empty array, When deduplicating, Then returns []', () => {
    expect(deduplicateOffers([])).toEqual([]);
  });

  it('Given all duplicates, When deduplicating, Then returns single offer', () => {
    const offers = [makeOffer('x'), makeOffer('x'), makeOffer('x')];
    expect(deduplicateOffers(offers)).toHaveLength(1);
  });
});
```

---

### 2. Schema Validation Tests

Every `JobOffer` returned by any scraper must satisfy the interface contract. Use manual assertions (no additional deps required) or `zod` if already in the project.

```typescript
// tests/unit/schema.test.ts
import { JobOffer } from '../../src/types';

const VALID_SOURCES = ['justjoin', 'nofluffjobs', 'linkedin', 'manual'] as const;

export function assertValidJobOffer(offer: unknown, context = ''): asserts offer is JobOffer {
  const prefix = context ? `[${context}] ` : '';
  expect(offer).toBeDefined();
  expect(typeof offer).toBe('object');

  const o = offer as Record<string, unknown>;

  // Required fields
  expect(typeof o.id, `${prefix}id must be string`).toBe('string');
  expect((o.id as string).length, `${prefix}id must be non-empty`).toBeGreaterThan(0);

  expect(typeof o.title, `${prefix}title must be string`).toBe('string');
  expect((o.title as string).length, `${prefix}title must be non-empty`).toBeGreaterThan(0);

  expect(typeof o.company, `${prefix}company must be string`).toBe('string');

  expect(typeof o.url, `${prefix}url must be string`).toBe('string');
  expect(o.url as string, `${prefix}url must start with https://`).toMatch(/^https:\/\//);

  expect(typeof o.body, `${prefix}body must be string`).toBe('string');
  expect((o.body as string).length, `${prefix}body must be non-empty`).toBeGreaterThan(0);

  expect(VALID_SOURCES, `${prefix}source must be valid`).toContain(o.source);

  // scrapedAt must be a valid ISO 8601 date
  expect(typeof o.scrapedAt, `${prefix}scrapedAt must be string`).toBe('string');
  expect(new Date(o.scrapedAt as string).toISOString(), `${prefix}scrapedAt must be valid ISO`).toBe(o.scrapedAt);

  // Optional fields — if present, must have correct types
  if (o.location !== undefined) expect(typeof o.location).toBe('string');
  if (o.salary !== undefined) expect(typeof o.salary).toBe('string');
  if (o.tags !== undefined) {
    expect(Array.isArray(o.tags), `${prefix}tags must be array`).toBe(true);
    (o.tags as unknown[]).forEach((tag) =>
      expect(typeof tag, `${prefix}each tag must be string`).toBe('string')
    );
  }
}

describe('JobOffer schema validation', () => {
  it('Given a fully-populated offer, When validating, Then passes all assertions', () => {
    const offer: JobOffer = {
      id: 'justjoin_senior-ts-dev',
      title: 'Senior TypeScript Developer',
      company: 'Acme Corp',
      url: 'https://justjoin.it/job-offer/senior-ts-dev',
      body: 'Full job description here',
      source: 'justjoin',
      location: 'Gdansk',
      salary: '15000–20000 PLN',
      tags: ['typescript', 'node.js', 'postgresql'],
      scrapedAt: new Date().toISOString(),
    };
    expect(() => assertValidJobOffer(offer)).not.toThrow();
  });

  it('Given a minimal offer (only required fields), When validating, Then passes', () => {
    const offer: JobOffer = {
      id: 'nofluffjobs_abc123',
      title: 'Lead Developer',
      company: '',
      url: 'https://nofluffjobs.com/pl/job/abc123',
      body: 'Lead Developer',
      source: 'nofluffjobs',
      scrapedAt: new Date().toISOString(),
    };
    expect(() => assertValidJobOffer(offer)).not.toThrow();
  });

  it('Given a missing required field, When validating, Then throws', () => {
    const badOffer = { id: 'x', title: '', company: 'Corp' }; // missing url, body, source, scrapedAt
    expect(() => assertValidJobOffer(badOffer)).toThrow();
  });

  it('Given an invalid source value, When validating, Then throws', () => {
    const badOffer: Record<string, unknown> = {
      id: 'x',
      title: 'Dev',
      company: 'Corp',
      url: 'https://example.com',
      body: 'desc',
      source: 'unknown-board', // not in the union
      scrapedAt: new Date().toISOString(),
    };
    expect(() => assertValidJobOffer(badOffer)).toThrow();
  });

  it('Given a non-ISO scrapedAt, When validating, Then throws', () => {
    const badOffer: Record<string, unknown> = {
      id: 'x', title: 'Dev', company: 'Corp',
      url: 'https://example.com', body: 'desc',
      source: 'justjoin', scrapedAt: '2024/01/15', // wrong format
    };
    expect(() => assertValidJobOffer(badOffer)).toThrow();
  });
});
```

Export `assertValidJobOffer` and reuse it in integration tests to validate every single returned offer.

---

### 3. Integration Tests — реальный браузер (CI-safe by default)

Integration tests run real Playwright against live job board sites. They are **always skipped in CI unless `RUN_INTEGRATION=1`** is set.

```typescript
// tests/integration/justjoin.integration.test.ts
import { scrapeJustJoin } from '../../src/scrapers/justjoin';
import { closeBrowser } from '../../src/utils/browser';
import { assertValidJobOffer } from '../unit/schema.test';

const RUN = process.env.RUN_INTEGRATION === '1';

// @slow — requires network, real Cloudflare bypass, ~30-60s
describe.skipIf(!RUN)('JustJoin — integration @slow', () => {
  jest.setTimeout(120_000);

  afterAll(async () => {
    await closeBrowser();
  });

  it('Given the live JustJoin site, When scraping, Then returns at least 1 valid JobOffer', async () => {
    const offers = await scrapeJustJoin();

    expect(offers.length).toBeGreaterThan(0);
    offers.forEach((offer, i) => assertValidJobOffer(offer, `offer[${i}]`));
  });

  it('Given scraped offers, When checking IDs, Then all IDs are unique and prefixed correctly', async () => {
    const offers = await scrapeJustJoin();
    const ids = offers.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length); // no duplicates
    ids.forEach((id) => expect(id).toMatch(/^justjoin_/));
  });

  it('Given scraped offers, When checking URLs, Then all URLs are valid justjoin.it links', async () => {
    const offers = await scrapeJustJoin();
    offers.forEach((o) => expect(o.url).toMatch(/^https:\/\/justjoin\.it\//));
  });
});
```

Use `describe.skipIf(!RUN)` (Jest 29+). For Jest 28 and below, use the guard pattern:

```typescript
const describeIf = (condition: boolean) => (condition ? describe : describe.skip);
describeIf(RUN)('JustJoin — integration @slow', () => { ... });
```

---

## Формат описания тестов

**Always** write test descriptions in the "Given / When / Then" format:

```
Given [precondition / system state]
When  [action / input]
Then  [expected outcome / assertion]
```

Examples:
- `'Given a valid API response, When scraping, Then returns normalized JobOffer[]'`
- `'Given all retries exhausted, When sending, Then throws with descriptive message'`
- `'Given duplicate IDs from two scrapers, When deduplicating, Then keeps only first occurrence'`

Never use vague descriptions like `'should work'`, `'returns data'`, or `'test 1'`.

---

## Edge Cases — обязательный чеклист

When writing tests for any component in this project, always cover these edge cases:

| Scenario | Component | How to test |
|---|---|---|
| Empty response array (`data: []`) | All scrapers | Mock response with empty array fixture |
| Malformed JSON from site API | All scrapers | `response.json()` rejects with `SyntaxError` |
| Network timeout during navigation | All scrapers | `page.goto()` rejects with timeout error |
| Non-2xx HTTP status from API endpoint | All scrapers | Mock response with `ok: false`, `status: 403` |
| Zero matching offers after filtering | All scrapers | Fixture with offers that don't match `config.scraper.targetStack` |
| Webhook returns 5xx | `sender.ts` | `mockPost.mockRejectedValue({ response: { status: 500 } })` |
| Webhook timeout (axios ECONNABORTED) | `sender.ts` | `mockPost.mockRejectedValue({ code: 'ECONNABORTED' })` |
| All retries exhausted | `sender.ts` | Mock 3 consecutive failures |
| Duplicate IDs from different scrapers | `index.ts` / dedup | Create fixtures with matching IDs |
| `WEBHOOK_URL` not set | `sender.ts` | `delete process.env.WEBHOOK_URL` in `beforeEach` |
| `context.close()` is always called | All scrapers | Assert mock context's `close` was called in both success and error paths |

---

## Playwright `page.route()` — мок API в тестах

Use `page.route()` in tests that spin up a real (but lightweight) Playwright context to mock network calls instead of navigating to live sites:

```typescript
// Example: mock the JustJoin API at the network level
import { chromium } from 'playwright';

it('Given a routed mock API, When scraping, Then parses response correctly', async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Intercept the actual API call and return a fixture
  await page.route('**/api.justjoin.it/v2/user-panel/offers**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: FIXTURE_OFFERS }),
    });
  });

  // Also stub the navigation page itself to avoid Cloudflare
  await page.route('**/justjoin.it/**', async (route) => {
    if (route.request().resourceType() === 'document') {
      await route.fulfill({ status: 200, contentType: 'text/html', body: '<html></html>' });
    } else {
      await route.continue();
    }
  });

  // Navigate — this will use the mocked responses
  await page.goto('https://justjoin.it/job-offers/all-locations/javascript');
  await context.close();
  await browser.close();
});
```

Use `route.abort()` to simulate network failures:

```typescript
await page.route('**/api.justjoin.it/**', (route) => route.abort('failed'));
// scraper should return [] gracefully
```

---

## CI — конфигурация и воркфлоу

### Существующий воркфлоу

The scraper runs at `0 8 * * *` UTC via `.github/workflows/scraper.yml`. It does **not** run unit tests — it only runs the scraper.

### Предлагаемый `test.yml` воркфлоу

Create `.github/workflows/test.yml` to run unit tests on every PR:

```yaml
# .github/workflows/test.yml
name: Unit Tests

on:
  pull_request:
    paths:
      - 'scraper/**'
  push:
    branches: [main]
    paths:
      - 'scraper/**'

jobs:
  unit-tests:
    name: Run Unit Tests
    runs-on: ubuntu-latest
    timeout-minutes: 5

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: scraper/package-lock.json

      - name: Install dependencies
        working-directory: scraper
        run: npm ci

      # No Playwright install needed — unit tests mock the browser
      - name: Type check
        working-directory: scraper
        run: npm run typecheck

      - name: Run unit tests
        working-directory: scraper
        run: npm run test:unit
        env:
          # RUN_INTEGRATION intentionally not set → integration tests skipped
          WEBHOOK_URL: https://n8n.example.com/webhook/placeholder

      - name: Upload coverage
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: coverage-${{ github.run_id }}
          path: scraper/coverage/
          retention-days: 14
          if-no-files-found: ignore
```

### Обновление `package.json` scripts

```json
{
  "scripts": {
    "build": "tsc",
    "scrape": "ts-node src/index.ts",
    "typecheck": "tsc --noEmit",
    "test": "jest",
    "test:unit": "jest tests/unit/ --passWithNoTests",
    "test:integration": "RUN_INTEGRATION=1 jest tests/integration/ --runInBand",
    "test:justjoin": "jest tests/justjoin.test.ts",
    "test:nofluffjobs": "jest tests/nofluffjobs.test.ts",
    "test:coverage": "jest tests/unit/ --coverage"
  }
}
```

`--runInBand` is mandatory for integration tests — they share a browser instance and must not run in parallel.

---

## Настройки Jest

The current config in `package.json` is minimal. Propose this enhanced config when adding unit tests:

```json
{
  "jest": {
    "preset": "ts-jest",
    "testEnvironment": "node",
    "testTimeout": 60000,
    "roots": ["<rootDir>/tests"],
    "testMatch": [
      "**/*.test.ts",
      "**/*.unit.test.ts",
      "**/*.integration.test.ts"
    ],
    "collectCoverageFrom": [
      "src/**/*.ts",
      "!src/index.ts"
    ],
    "coverageThreshold": {
      "global": {
        "branches": 70,
        "functions": 80,
        "lines": 80
      }
    }
  }
}
```

---

## Формат ответа

When presenting a proposed test change in chat (rather than editing files directly), use these four sections. When you edit test files directly, summarize the change and still state the CI impact (section 4).

### 1. Test Plan
Which test category (unit / schema / integration), which files to create/modify, which edge cases are covered.

### 2. Acceptance Criteria
Written in "Given / When / Then" format before the code — these become the `it()` description strings.

### 3. Test Code
Full, runnable TypeScript. No placeholders. All imports included. Mocks set up in `beforeEach` / cleared with `afterEach`. All timeouts explicit.

### 4. CI Impact
Whether this test is safe to run in CI without env vars, whether it needs `RUN_INTEGRATION=1`, and whether `test.yml` needs updating.

---

## Анти-паттерны в тестах

| Anti-pattern | Why it's wrong | Correct approach |
|---|---|---|
| `expect(offers).toBeTruthy()` | Too weak — passes for `[undefined]` | `expect(offers.length).toBeGreaterThan(0)` |
| Integration test without `describe.skipIf` | Flaky in CI, no network | Guard with `RUN_INTEGRATION` env flag |
| Shared mutable state between tests | Test pollution | Use `beforeEach` to reset mocks and state |
| `await page.waitForTimeout(5000)` in tests | Slow and fragile | Use `page.waitForResponse()` or mock the response |
| Asserting `response.body` exact string match | Breaks on any API change | Assert structure (keys, types) not exact values |
| No `afterAll(() => closeBrowser())` | Browser process leak | Always close browser in integration test teardown |
| `jest.setTimeout` in individual `it()` | Unreliable; Jest ignores it in some versions | Set timeout in `describe` or in `jest.config` |
| Testing internal `normalizeOffer()` by importing it directly | Fragile — couples to implementation | Test via the public `scrape*()` function output |
