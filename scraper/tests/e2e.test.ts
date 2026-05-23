/**
 * E2E test for sendToWebhook.
 *
 * Spins up a real Node.js HTTP server on a random port to act as a mock n8n
 * webhook endpoint, then calls the real sendToWebhook implementation and
 * asserts both sides: the request the server received and the round-trip
 * completing without error.
 *
 * No external services (n8n, Ollama, Notion) are contacted.
 */
import * as http from 'http';
import { sendToWebhook } from '../src/sender';
import type { JobOffer } from '../src/types';

// ─── Config mock ──────────────────────────────────────────────────────────────
// Must be `let` at module scope so the getter closes over it correctly after
// babel-jest hoists jest.mock() to the top of the file.
let mockWebhookUrl = '';

jest.mock('../src/config', () => ({
  config: {
    get webhookUrl() {
      return mockWebhookUrl;
    },
    sender: { maxRetries: 3, retryDelay: 0 }, // no sleep → fast tests
  },
}));

// ─── Minimal test fixture ─────────────────────────────────────────────────────
const SAMPLE_OFFER: JobOffer = {
  id: 'justjoin_senior-ts-engineer-e2e',
  title: 'Senior TypeScript Engineer',
  company: 'Test Corp',
  url: 'https://justjoin.it/offers/senior-ts-engineer-e2e',
  body: 'We are looking for a Senior TypeScript Engineer to join our remote team.',
  source: 'justjoin',
  location: 'Remote',
  scrapedAt: '2026-05-23T10:00:00.000Z',
};

// ─── Suite ────────────────────────────────────────────────────────────────────
describe('sendToWebhook — E2E with local mock server', () => {
  let server: http.Server;

  beforeAll(
    () =>
      new Promise<void>((resolve) => {
        server = http.createServer();
        server.listen(0, '127.0.0.1', () => {
          const { port } = server.address() as { port: number };
          // Point the mocked config at our local server for every test in this suite.
          mockWebhookUrl = `http://127.0.0.1:${port}/webhook/jobs/ingest`;
          resolve();
        });
      }),
  );

  afterAll(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  );

  it('POSTs to /webhook/jobs/ingest with a valid WebhookPayload and receives { ok: true }', async () => {
    // ------------------------------------------------------------------
    // 1. Wire up the mock server to capture the incoming request.
    //    resolveRequest is called *before* res.end() so by the time
    //    axios receives the HTTP response (and sendToWebhook resolves),
    //    the requestReceived Promise is already settled.
    // ------------------------------------------------------------------
    let resolveRequest!: (data: {
      method: string;
      path: string;
      body: unknown;
    }) => void;

    const requestReceived = new Promise<{
      method: string;
      path: string;
      body: unknown;
    }>((resolve) => {
      resolveRequest = resolve;
    });

    server.once('request', (req: http.IncomingMessage, res: http.ServerResponse) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8');

        // Resolve before writing the response so the Promise is settled
        // before axios sees the 200 and sendToWebhook returns.
        resolveRequest({
          method: req.method ?? '',
          path: req.url ?? '',
          body: JSON.parse(raw),
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
    });

    // ------------------------------------------------------------------
    // 2. Invoke the real sendToWebhook — it will POST to our mock server.
    //    This must not throw (server returns 200).
    // ------------------------------------------------------------------
    await expect(
      sendToWebhook([SAMPLE_OFFER], 'scraper-combined'),
    ).resolves.toBeUndefined();

    // ------------------------------------------------------------------
    // 3. Assertions on what the server received.
    //    requestReceived is already resolved at this point (see above).
    // ------------------------------------------------------------------
    const received = await requestReceived;

    // HTTP method and path
    expect(received.method).toBe('POST');
    expect(received.path).toBe('/webhook/jobs/ingest');

    // Top-level payload shape
    const payload = received.body as {
      jobs: JobOffer[];
      meta: { source: string; count: number; sentAt: string };
    };

    expect(payload.jobs).toHaveLength(1);

    // Job offer fields are forwarded verbatim
    expect(payload.jobs[0]).toMatchObject({
      id: 'justjoin_senior-ts-engineer-e2e',
      title: 'Senior TypeScript Engineer',
      company: 'Test Corp',
      source: 'justjoin',
      location: 'Remote',
    });

    // Envelope meta
    expect(payload.meta).toMatchObject({
      source: 'scraper-combined',
      count: 1,
    });

    // sentAt is a valid ISO 8601 timestamp generated at send-time
    expect(typeof payload.meta.sentAt).toBe('string');
    expect(payload.meta.sentAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});
