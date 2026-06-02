import { OpenRouterAdapter } from './openrouter';

/** Build a minimal fetch-compatible Response mock — only fields used by OpenRouterAdapter. */
function makeResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

const FIXTURE_CONTENT = JSON.stringify({
  overall_score: 78,
  tech_stack_match: 85,
  seniority_match: 70,
  red_flags: [],
  reason: 'Good TypeScript and Node.js background',
  url: 'https://example.com/job/42',
});

const OPENROUTER_HAPPY_RESPONSE = {
  id: 'chatcmpl-abc123',
  object: 'chat.completion',
  choices: [
    {
      index: 0,
      message: {
        role: 'assistant',
        content: FIXTURE_CONTENT,
      },
      finish_reason: 'stop',
    },
  ],
  model: 'deepseek/deepseek-chat-v3-0324:free',
};

const BASE_REQUEST = {
  systemPrompt: 'You are a recruiter assistant.',
  userMessage: 'Evaluate this job posting.',
  outputSchema: { type: 'object', properties: { overall_score: { type: 'number' } } },
};

describe('OpenRouterAdapter', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    process.env['OPENROUTER_API_KEY'] = 'test-api-key';
    process.env['OPENROUTER_MODEL'] = 'deepseek/deepseek-chat-v3-0324:free';
    fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(makeResponse(OPENROUTER_HAPPY_RESPONSE));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    delete process.env['OPENROUTER_API_KEY'];
    delete process.env['OPENROUTER_MODEL'];
  });

  describe('happy path', () => {
    it('resolves without errors and returns content matching the fixture', async () => {
      const adapter = new OpenRouterAdapter();
      const result = await adapter.complete(BASE_REQUEST);

      expect(result.content).toBe(FIXTURE_CONTENT);
      expect(result.provider).toBe('openrouter');
      expect(result.model).toBe('deepseek/deepseek-chat-v3-0324:free');
    });

    it('POSTs to https://openrouter.ai/api/v1/chat/completions', async () => {
      const adapter = new OpenRouterAdapter();
      await adapter.complete(BASE_REQUEST);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    });

    it('sends Authorization: Bearer header with OPENROUTER_API_KEY', async () => {
      const adapter = new OpenRouterAdapter();
      await adapter.complete(BASE_REQUEST);

      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(init.method).toBe('POST');

      const headers = init.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer test-api-key');
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('sends correct body: model, system + user messages', async () => {
      const adapter = new OpenRouterAdapter();
      await adapter.complete(BASE_REQUEST);

      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as Record<string, unknown>;

      expect(body['model']).toBe('deepseek/deepseek-chat-v3-0324:free');

      const messages = body['messages'] as Array<{ role: string; content: string }>;
      expect(messages).toHaveLength(2);
      expect(messages[0]).toEqual({ role: 'system', content: BASE_REQUEST.systemPrompt });
      expect(messages[1]).toEqual({ role: 'user', content: BASE_REQUEST.userMessage });
    });

    it('uses DEFAULT_MODEL when OPENROUTER_MODEL env var is absent', async () => {
      delete process.env['OPENROUTER_MODEL'];
      const adapter = new OpenRouterAdapter();
      await adapter.complete(BASE_REQUEST);

      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body['model']).toBe('deepseek/deepseek-chat-v3-0324:free');
      expect(adapter).toMatchObject({ model: 'deepseek/deepseek-chat-v3-0324:free' });
    });
  });

  describe('error cases', () => {
    it('throws when the server returns a non-2xx status', async () => {
      fetchSpy.mockResolvedValue(makeResponse({ error: { message: 'Invalid API key' } }, 401));

      const adapter = new OpenRouterAdapter();
      await expect(adapter.complete(BASE_REQUEST)).rejects.toThrow(
        'OpenRouter request failed: 401',
      );
    });

    it('throws when choices array is empty (model returned no completions)', async () => {
      fetchSpy.mockResolvedValue(makeResponse({ id: 'x', choices: [] }));

      const adapter = new OpenRouterAdapter();
      await expect(adapter.complete(BASE_REQUEST)).rejects.toThrow(
        'Unexpected OpenRouter response shape',
      );
    });

    it('throws when the response body has an unexpected shape (no choices field)', async () => {
      fetchSpy.mockResolvedValue(makeResponse({ unexpected: true }));

      const adapter = new OpenRouterAdapter();
      await expect(adapter.complete(BASE_REQUEST)).rejects.toThrow(
        'Unexpected OpenRouter response shape',
      );
    });

    it('throws when json() rejects (simulate network timeout / malformed body)', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.reject(new SyntaxError('Unexpected end of JSON input')),
      } as unknown as Response);

      const adapter = new OpenRouterAdapter();
      await expect(adapter.complete(BASE_REQUEST)).rejects.toThrow(
        'Unexpected end of JSON input',
      );
    });

    it('throws when fetch itself rejects (network-level failure / timeout)', async () => {
      fetchSpy.mockRejectedValue(new TypeError('fetch failed'));

      const adapter = new OpenRouterAdapter();
      await expect(adapter.complete(BASE_REQUEST)).rejects.toThrow('fetch failed');
    });

    it('throws when choices[0].message.content is not a string (invalid shape)', async () => {
      fetchSpy.mockResolvedValue(
        makeResponse({
          choices: [{ message: { content: null } }],
        }),
      );

      const adapter = new OpenRouterAdapter();
      await expect(adapter.complete(BASE_REQUEST)).rejects.toThrow(
        'Unexpected OpenRouter response shape',
      );
    });
  });
});
