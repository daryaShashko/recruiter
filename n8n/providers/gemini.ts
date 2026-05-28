import type { LLMProvider, LLMRequest, LLMResponse } from './_interface';

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com';

/** Expected shape of a successful Gemini generateContent response. */
interface GeminiResponseBody {
  readonly candidates: ReadonlyArray<{
    readonly content: {
      readonly parts: ReadonlyArray<{ readonly text: string }>;
    };
  }>;
}

function isGeminiResponseBody(value: unknown): value is GeminiResponseBody {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v['candidates']) || v['candidates'].length === 0) return false;
  const candidate = v['candidates'][0] as Record<string, unknown>;
  if (!candidate['content'] || typeof candidate['content'] !== 'object') return false;
  const content = candidate['content'] as Record<string, unknown>;
  if (!Array.isArray(content['parts']) || content['parts'].length === 0) return false;
  const part = content['parts'][0] as Record<string, unknown>;
  return typeof part['text'] === 'string';
}

/**
 * LLM provider adapter for Google Gemini's generateContent API.
 *
 * Reads from process.env at construction time:
 *   LLM_API_KEY — Gemini API key (appended as ?key= query param)
 *   LLM_MODEL   — model name to use (default: gemini-2.0-flash)
 */
export class GeminiAdapter implements LLMProvider {
  private readonly apiKey: string;
  private readonly model: string;

  constructor() {
    this.apiKey = process.env['LLM_API_KEY'] ?? '';
    this.model = process.env['LLM_MODEL'] ?? 'gemini-2.0-flash';
  }

  /**
   * Send a completion request to Gemini's generateContent endpoint.
   * Passes outputSchema via generationConfig.responseSchema for structured JSON output.
   * @param req - Structured request containing system prompt, user message, and output schema.
   * @returns Resolved LLMResponse whose `content` is candidates[0].content.parts[0].text.
   */
  async complete(req: LLMRequest): Promise<LLMResponse> {
    const url = `${GEMINI_BASE_URL}/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: req.systemPrompt }],
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: req.userMessage }],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: req.outputSchema,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Gemini request failed: ${response.status} ${response.statusText}`);
    }

    const data: unknown = await response.json();
    if (!isGeminiResponseBody(data)) {
      throw new Error(`Unexpected Gemini response shape: ${JSON.stringify(data)}`);
    }

    return {
      content: data.candidates[0].content.parts[0].text,
      provider: 'gemini',
      model: this.model,
    };
  }
}
