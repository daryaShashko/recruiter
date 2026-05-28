/**
 * Core LLM provider contract for the AI Recruiter pipeline.
 * All provider adapters must implement LLMProvider.
 * ADR-016: LLM Provider Adapter Pattern
 */

export interface LLMRequest {
  /** System-level instructions for the model. */
  readonly systemPrompt: string;
  /** The user-facing message to evaluate. */
  readonly userMessage: string;
  /** JSON Schema describing the expected structured output. */
  readonly outputSchema: object;
}

export interface LLMResponse {
  /** Raw string content returned by the model; caller is responsible for JSON.parse(). */
  readonly content: string;
  /** Provider identifier, e.g. "ollama", "gemini", "anthropic". */
  readonly provider: string;
  /** Model name as reported by the adapter, e.g. "llama3.1:latest". */
  readonly model: string;
}

export interface LLMProvider {
  /**
   * Send a completion request to the underlying LLM API.
   * @param req - The structured request containing prompts and output schema.
   * @returns A promise resolving to the model's response.
   */
  complete(req: LLMRequest): Promise<LLMResponse>;
}
