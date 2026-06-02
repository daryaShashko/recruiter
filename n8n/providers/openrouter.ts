import type { LLMProvider, LLMRequest, LLMResponse } from './_interface';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'deepseek/deepseek-chat-v3-0324:free';

/** Expected shape of a successful OpenRouter (OpenAI-compatible) chat completions response. */
interface OpenRouterResponseBody {
  readonly choices: ReadonlyArray<{
    readonly message: {
      readonly content: string;
    };
  }>;
}

/**
 * Type guard for OpenRouter response body.
 * Validates the OpenAI-compatible shape: choices[0].message.content (string).
 */
function isOpenRouterResponseBody(value: unknown): value is OpenRouterResponseBody {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v['choices']) || v['choices'].length === 0) return false;
  const choice = v['choices'][0] as Record<string, unknown>;
  if (!choice['message'] || typeof choice['message'] !== 'object') return false;
  const message = choice['message'] as Record<string, unknown>;
  return typeof message['content'] === 'string';
}

/**
 * LLM provider adapter for OpenRouter's OpenAI-compatible chat completions API.
 * Used as a fallback provider when the primary LLM (Gemini) is unavailable.
 *
 * Reads from process.env at construction time:
 *   OPENROUTER_API_KEY — Bearer token for Authorization header (required)
 *   OPENROUTER_MODEL   — model name to use (default: deepseek/deepseek-chat-v3-0324:free)
 */
export class OpenRouterAdapter implements LLMProvider {
  private readonly apiKey: string;
  private readonly model: string;

  constructor() {
    this.apiKey = process.env['OPENROUTER_API_KEY'] ?? '';
    this.model = process.env['OPENROUTER_MODEL'] ?? DEFAULT_MODEL;
  }

  /**
   * Send a chat completion request to the OpenRouter API.
   * Uses the OpenAI-compatible /v1/chat/completions endpoint.
   * Response content is extracted from choices[0].message.content.
   * @param req - Structured request containing system prompt, user message, and output schema.
   * @returns Resolved LLMResponse whose `content` is choices[0].message.content.
   */
  async complete(req: LLMRequest): Promise<LLMResponse> {
    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: req.systemPrompt },
          { role: 'user', content: req.userMessage },
        ],
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenRouter request failed: ${response.status} ${response.statusText}`);
    }

    const data: unknown = await response.json();
    if (!isOpenRouterResponseBody(data)) {
      throw new Error(`Unexpected OpenRouter response shape: ${JSON.stringify(data)}`);
    }

    return {
      content: data.choices[0].message.content,
      provider: 'openrouter',
      model: this.model,
    };
  }
}
