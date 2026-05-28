import type { LLMProvider, LLMRequest, LLMResponse } from './_interface';

/** Expected shape of a successful Ollama /api/chat response. */
interface OllamaResponseBody {
  readonly message: {
    readonly content: string;
  };
}

function isOllamaResponseBody(value: unknown): value is OllamaResponseBody {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (!v['message'] || typeof v['message'] !== 'object') return false;
  const msg = v['message'] as Record<string, unknown>;
  return typeof msg['content'] === 'string';
}

/**
 * LLM provider adapter for Ollama's local HTTP API.
 *
 * Reads from process.env at construction time:
 *   LLM_BASE_URL — Ollama server base URL (default: http://localhost:11434)
 *   LLM_MODEL    — model name to use     (default: llama3.1:latest)
 */
export class OllamaAdapter implements LLMProvider {
  private readonly baseUrl: string;
  private readonly model: string;

  constructor() {
    this.baseUrl = process.env['LLM_BASE_URL'] ?? 'http://localhost:11434';
    this.model = process.env['LLM_MODEL'] ?? 'llama3.1:latest';
  }

  /**
   * Send a chat-completion request to Ollama's /api/chat endpoint.
   * Uses `format` for structured JSON output and sets stream=false, keep_alive=0.
   * @param req - Structured request containing system prompt, user message, and output schema.
   * @returns Resolved LLMResponse whose `content` is the raw string from message.content.
   */
  async complete(req: LLMRequest): Promise<LLMResponse> {
    const url = `${this.baseUrl}/api/chat`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        keep_alive: 0,
        messages: [
          { role: 'system', content: req.systemPrompt },
          { role: 'user', content: req.userMessage },
        ],
        format: req.outputSchema,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama request failed: ${response.status} ${response.statusText}`);
    }

    const data: unknown = await response.json();
    if (!isOllamaResponseBody(data)) {
      throw new Error(`Unexpected Ollama response shape: ${JSON.stringify(data)}`);
    }

    return {
      content: data.message.content,
      provider: 'ollama',
      model: this.model,
    };
  }
}
