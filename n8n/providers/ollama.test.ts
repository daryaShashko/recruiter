import { OllamaAdapter } from './ollama';

/** Build a minimal fetch-compatible Response mock — only fields used by OllamaAdapter. */
function makeResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

const FIXTURE_INPUT = {
  overall_score: 85,
  tech_stack_match: 90,
  seniority_match: 80,
  red_flags: [],
  reason: 'Strong Node.js stack',
  url: 'https://example.com/job',
};
const FIXTURE_CONTENT = JSON.stringify(FIXTURE_INPUT);

const OLLAMA_HAPPY_RESPONSE = {
  model: 'llama3.1:latest',
  message: { role: 'assistant', content: FIXTURE_CONTENT },
  done: true,
};

const BASE_REQUEST = {
  systemPrompt: 'You are a recruiter assistant.',
  userMessage: 'Evaluate this job posting.',
  outputSchema: { type: 'object', properties: { overall_score: { type: 'number' } } },
};

describe('OllamaAdapter', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    process.env['LLM_BASE_URL'] = 'http://localhost:11434';
    process.env['LLM_MODEL'] = 'llama3.1:latest';
    fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(makeResponse(OLLAMA_HAPPY_RESPONSE));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    delete process.env['LLM_BASE_URL'];
    delete process.env['LLM_MODEL'];
  });

  describe('happy path', () => {
    it('resolves without errors and returns content matching the fixture', async () => {
      const adapter = new OllamaAdapter();
      const result = await adapter.complete(BASE_REQUEST);

      expect(result.content).toBe(FIXTURE_CONTENT);
      expect(result.provider).toBe('ollama');
      expect(result.model).toBe('llama3.1:latest');
    });

    it('POSTs to {LLM_BASE_URL}/api/chat', async () => {
      const adapter = new OllamaAdapter();
      await adapter.complete(BASE_REQUEST);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://localhost:11434/api/chat');
    });

    it('sends correct body fields: model, stream=false, keep_alive=0, messages, format', async () => {
      const adapter = new OllamaAdapter();
      await adapter.complete(BASE_REQUEST);

      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(init.method).toBe('POST');

      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body['model']).toBe('llama3.1:latest');
      expect(body['stream']).toBe(false);
      expect(body['keep_alive']).toBe(0);
      expect(body['format']).toEqual(BASE_REQUEST.outputSchema);

      const messages = body['messages'] as Array<{ role: string; content: string }>;
      expect(messages).toHaveLength(2);
      expect(messages[0]).toEqual({ role: 'system', content: BASE_REQUEST.systemPrompt });
      expect(messages[1]).toEqual({ role: 'user', content: BASE_REQUEST.userMessage });
    });

    it('uses LLM_BASE_URL default http://localhost:11434 when env var is absent', async () => {
      delete process.env['LLM_BASE_URL'];
      const adapter = new OllamaAdapter();
      await adapter.complete(BASE_REQUEST);

      const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://localhost:11434/api/chat');
    });
  });

  describe('error cases', () => {
    it('throws when the server returns a non-2xx status', async () => {
      fetchSpy.mockResolvedValue(makeResponse({ error: 'model not found' }, 404));

      const adapter = new OllamaAdapter();
      await expect(adapter.complete(BASE_REQUEST)).rejects.toThrow('Ollama request failed: 404');
    });

    it('throws when the response body is missing message.content (invalid JSON structure)', async () => {
      fetchSpy.mockResolvedValue(makeResponse({ unexpected: true }));

      const adapter = new OllamaAdapter();
      await expect(adapter.complete(BASE_REQUEST)).rejects.toThrow(
        'Unexpected Ollama response shape',
      );
    });

    it('throws when the response body is an empty object', async () => {
      fetchSpy.mockResolvedValue(makeResponse({}));

      const adapter = new OllamaAdapter();
      await expect(adapter.complete(BASE_REQUEST)).rejects.toThrow(
        'Unexpected Ollama response shape',
      );
    });

    it('throws when json() rejects (simulate timeout / malformed body)', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.reject(new SyntaxError('Unexpected token')),
      } as unknown as Response);

      const adapter = new OllamaAdapter();
      await expect(adapter.complete(BASE_REQUEST)).rejects.toThrow('Unexpected token');
    });
  });
});
