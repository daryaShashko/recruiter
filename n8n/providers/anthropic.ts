import type { LLMProvider, LLMRequest, LLMResponse } from './_interface';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

/**
 * A tool_use block returned by Anthropic when tool_choice is forced to a specific tool.
 * The `input` field contains the model's structured JSON output.
 */
interface AnthropicToolUseBlock {
  readonly type: 'tool_use';
  readonly input: unknown;
}

/** Minimal expected shape of a successful Anthropic Messages API response. */
interface AnthropicResponseBody {
  readonly content: ReadonlyArray<{ readonly type: string }>;
}

function isAnthropicToolUseBlock(value: unknown): value is AnthropicToolUseBlock {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return v['type'] === 'tool_use' && 'input' in v;
}

function isAnthropicResponseBody(value: unknown): value is AnthropicResponseBody {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v['content']) && (v['content'] as unknown[]).length > 0;
}

/**
 * LLM provider adapter for Anthropic's Messages API.
 * Structured output is achieved via forced tool_use (tool_choice: { type: "tool" }).
 * The model is required to call "structured_output", and its input becomes the response.
 *
 * Reads from process.env at construction time:
 *   LLM_API_KEY — Anthropic API key (sent as x-api-key header)
 *   LLM_MODEL   — model name to use  (default: claude-haiku-4-5)
 */
export class AnthropicAdapter implements LLMProvider {
  private readonly apiKey: string;
  private readonly model: string;

  constructor() {
    this.apiKey = process.env['LLM_API_KEY'] ?? '';
    this.model = process.env['LLM_MODEL'] ?? 'claude-haiku-4-5';
  }

  /**
   * Send a completion request to the Anthropic Messages API.
   * Forces the model to call the "structured_output" tool, ensuring JSON output.
   * Returns JSON.stringify(content[0].input) as the response content.
   * @param req - Structured request containing system prompt, user message, and output schema.
   * @returns Resolved LLMResponse whose `content` is JSON.stringify(tool_use block's input).
   */
  async complete(req: LLMRequest): Promise<LLMResponse> {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1024,
        system: req.systemPrompt,
        messages: [{ role: 'user', content: req.userMessage }],
        tools: [
          {
            name: 'structured_output',
            description: 'Return evaluation result',
            input_schema: req.outputSchema,
          },
        ],
        tool_choice: { type: 'tool', name: 'structured_output' },
      }),
    });

    if (!response.ok) {
      throw new Error(`Anthropic request failed: ${response.status} ${response.statusText}`);
    }

    const data: unknown = await response.json();
    if (!isAnthropicResponseBody(data)) {
      throw new Error(`Unexpected Anthropic response shape: ${JSON.stringify(data)}`);
    }

    const firstBlock = data.content[0];
    if (!isAnthropicToolUseBlock(firstBlock)) {
      throw new Error(
        `Expected tool_use block as first content item, got type: "${(firstBlock as Record<string, unknown>)['type']}"`,
      );
    }

    return {
      content: JSON.stringify(firstBlock.input),
      provider: 'anthropic',
      model: this.model,
    };
  }
}
