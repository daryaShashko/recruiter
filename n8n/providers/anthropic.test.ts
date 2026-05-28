import { AnthropicAdapter } from './anthropic';

/** Build a minimal fetch-compatible Response mock — only fields used by AnthropicAdapter. */
function makeResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

const FIXTURE_INPUT = {
  overall_score: 90,
  tech_stack_match: 95,
  seniority_match: 85,
  red_flags: [],
  reason: 'Excellent TS/Node.js senior role, fully remote.',
  url: 'https://example.com/job3',
};

const ANTHROPIC_HAPPY_RESPONSE = {
  id: 'msg_01XFDUDYJgAACzvnptvVoYEL',
  type: 'message',
  role: 'assistant',
  model: 'claude-haiku-4-5',
  content: [
    {
      type: 'tool_use',
      id: 'toolu_01T1x1fJ34qAmk2tzvAqgeEo',
      name: 'structured_output',
      input: FIXTURE_INPUT,
    },
  ],
  stop_reason: 'tool_use',
};

const BASE_REQUEST = {
  systemPrompt: 'You are a recruiter assistant.',
  userMessage: 'Evaluate this job posting.',
  outputSchema: { type: 'object', properties: { overall_score: { type: 'number' } } },
};

describe('AnthropicAdapter', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    process.env['LLM_API_KEY'] = 'test-anthropic-key';
    process.env['LLM_MODEL'] = 'claude-haiku-4-5';
    fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(makeResponse(ANTHROPIC_HAPPY_RESPONSE));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    delete process.env['LLM_API_KEY'];
    delete process.env['LLM_MODEL'];
  });

  describe('happy path', () => {
    it('resolves without errors and returns JSON.stringify of content[0].input', async () => {
      const adapter = new AnthropicAdapter();
      const result = await adapter.complete(BASE_REQUEST);

      expect(result.content).toBe(JSON.stringify(FIXTURE_INPUT));
      expect(result.provider).toBe('anthropic');
      expect(result.model).toBe('claude-haiku-4-5');
    });

    it('POSTs to https://api.anthropic.com/v1/messages', async () => {
      const adapter = new AnthropicAdapter();
      await adapter.complete(BASE_REQUEST);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.anthropic.com/v1/messages');
    });

    it('sends correct headers: x-api-key, anthropic-version, content-type', async () => {
      const adapter = new AnthropicAdapter();
      await adapter.complete(BASE_REQUEST);

      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers['x-api-key']).toBe('test-anthropic-key');
      expect(headers['anthropic-version']).toBe('2023-06-01');
      expect(headers['content-type']).toBe('application/json');
    });

    it('sends correct body: model, max_tokens, system, messages, tools, tool_choice', async () => {
      const adapter = new AnthropicAdapter();
      await adapter.complete(BASE_REQUEST);

      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(init.method).toBe('POST');

      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body['model']).toBe('claude-haiku-4-5');
      expect(body['max_tokens']).toBe(1024);
      expect(body['system']).toBe(BASE_REQUEST.systemPrompt);

      const messages = body['messages'] as Array<{ role: string; content: string }>;
      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({ role: 'user', content: BASE_REQUEST.userMessage });

      const tools = body['tools'] as Array<Record<string, unknown>>;
      expect(tools).toHaveLength(1);
      expect(tools[0]['name']).toBe('structured_output');
      expect(tools[0]['input_schema']).toEqual(BASE_REQUEST.outputSchema);

      expect(body['tool_choice']).toEqual({ type: 'tool', name: 'structured_output' });
    });

    it('uses LLM_MODEL default claude-haiku-4-5 when env var is absent', async () => {
      delete process.env['LLM_MODEL'];
      const adapter = new AnthropicAdapter();
      await adapter.complete(BASE_REQUEST);

      expect(adapter['model']).toBe('claude-haiku-4-5');
    });
  });

  describe('error cases', () => {
    it('throws when the server returns a non-2xx status', async () => {
      fetchSpy.mockResolvedValue(
        makeResponse({ type: 'error', error: { type: 'authentication_error' } }, 401),
      );

      const adapter = new AnthropicAdapter();
      await expect(adapter.complete(BASE_REQUEST)).rejects.toThrow('Anthropic request failed: 401');
    });

    it('throws when response body is missing content array', async () => {
      fetchSpy.mockResolvedValue(makeResponse({ id: 'msg_xxx', type: 'message' }));

      const adapter = new AnthropicAdapter();
      await expect(adapter.complete(BASE_REQUEST)).rejects.toThrow(
        'Unexpected Anthropic response shape',
      );
    });

    it('throws when first content block is not tool_use (e.g. plain text block)', async () => {
      fetchSpy.mockResolvedValue(
        makeResponse({
          content: [{ type: 'text', text: 'I cannot help with that.' }],
        }),
      );

      const adapter = new AnthropicAdapter();
      await expect(adapter.complete(BASE_REQUEST)).rejects.toThrow(
        'Expected tool_use block as first content item, got type: "text"',
      );
    });

    it('throws when json() rejects (simulate malformed body)', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.reject(new SyntaxError('Unexpected end of JSON input')),
      } as unknown as Response);

      const adapter = new AnthropicAdapter();
      await expect(adapter.complete(BASE_REQUEST)).rejects.toThrow(
        'Unexpected end of JSON input',
      );
    });
  });
});
