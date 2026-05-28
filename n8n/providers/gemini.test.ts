import { GeminiAdapter } from './gemini';

/** Build a minimal fetch-compatible Response mock — only fields used by GeminiAdapter. */
function makeResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

const FIXTURE_TEXT = JSON.stringify({
  overall_score: 72,
  tech_stack_match: 80,
  seniority_match: 70,
  red_flags: ['Hybrid Warsaw'],
  reason: 'Good Node.js fit but wrong location.',
  url: 'https://example.com/job2',
});

const GEMINI_HAPPY_RESPONSE = {
  candidates: [
    {
      content: {
        role: 'model',
        parts: [{ text: FIXTURE_TEXT }],
      },
    },
  ],
  usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 50 },
};

const BASE_REQUEST = {
  systemPrompt: 'You are a recruiter assistant.',
  userMessage: 'Evaluate this job posting.',
  outputSchema: { type: 'object', properties: { overall_score: { type: 'number' } } },
};

describe('GeminiAdapter', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    process.env['LLM_API_KEY'] = 'test-gemini-key';
    process.env['LLM_MODEL'] = 'gemini-2.0-flash';
    fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(makeResponse(GEMINI_HAPPY_RESPONSE));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    delete process.env['LLM_API_KEY'];
    delete process.env['LLM_MODEL'];
  });

  describe('happy path', () => {
    it('resolves without errors and returns content from candidates[0].content.parts[0].text', async () => {
      const adapter = new GeminiAdapter();
      const result = await adapter.complete(BASE_REQUEST);

      expect(result.content).toBe(FIXTURE_TEXT);
      expect(result.provider).toBe('gemini');
      expect(result.model).toBe('gemini-2.0-flash');
    });

    it('POSTs to the correct generateContent URL with ?key= param', async () => {
      const adapter = new GeminiAdapter();
      await adapter.complete(BASE_REQUEST);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('generativelanguage.googleapis.com');
      expect(url).toContain('gemini-2.0-flash:generateContent');
      expect(url).toContain('?key=test-gemini-key');
    });

    it('sends correct body: system_instruction, contents, generationConfig with responseSchema', async () => {
      const adapter = new GeminiAdapter();
      await adapter.complete(BASE_REQUEST);

      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(init.method).toBe('POST');

      const body = JSON.parse(init.body as string) as Record<string, unknown>;

      expect(body['system_instruction']).toEqual({
        parts: [{ text: BASE_REQUEST.systemPrompt }],
      });

      const contents = body['contents'] as Array<{ role: string; parts: unknown[] }>;
      expect(contents).toHaveLength(1);
      expect(contents[0].role).toBe('user');
      expect(contents[0].parts).toEqual([{ text: BASE_REQUEST.userMessage }]);

      const genConfig = body['generationConfig'] as Record<string, unknown>;
      expect(genConfig['responseMimeType']).toBe('application/json');
      expect(genConfig['responseSchema']).toEqual(BASE_REQUEST.outputSchema);
    });

    it('uses LLM_MODEL default gemini-2.0-flash when env var is absent', async () => {
      delete process.env['LLM_MODEL'];
      const adapter = new GeminiAdapter();
      await adapter.complete(BASE_REQUEST);

      const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('gemini-2.0-flash:generateContent');
      expect(adapter['model']).toBe('gemini-2.0-flash');
    });
  });

  describe('error cases', () => {
    it('throws when the server returns a non-2xx status', async () => {
      fetchSpy.mockResolvedValue(makeResponse({ error: { code: 400, message: 'Bad Request' } }, 400));

      const adapter = new GeminiAdapter();
      await expect(adapter.complete(BASE_REQUEST)).rejects.toThrow('Gemini request failed: 400');
    });

    it('throws when response has no candidates array (invalid JSON structure)', async () => {
      fetchSpy.mockResolvedValue(makeResponse({ promptFeedback: { blockReason: 'SAFETY' } }));

      const adapter = new GeminiAdapter();
      await expect(adapter.complete(BASE_REQUEST)).rejects.toThrow(
        'Unexpected Gemini response shape',
      );
    });

    it('throws when candidates array is empty', async () => {
      fetchSpy.mockResolvedValue(makeResponse({ candidates: [] }));

      const adapter = new GeminiAdapter();
      await expect(adapter.complete(BASE_REQUEST)).rejects.toThrow(
        'Unexpected Gemini response shape',
      );
    });

    it('throws when json() rejects (simulate malformed body)', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.reject(new SyntaxError('Invalid JSON')),
      } as unknown as Response);

      const adapter = new GeminiAdapter();
      await expect(adapter.complete(BASE_REQUEST)).rejects.toThrow('Invalid JSON');
    });
  });
});
