/**
 * Factory module for LLM provider adapters.
 * ADR-016: LLM Provider Adapter Pattern
 *
 * Usage:
 *   const provider = getProvider('ollama');
 *   const result = await provider.complete({ systemPrompt, userMessage, outputSchema });
 */

// Re-export interfaces so consumers can import everything from one place.
export type { LLMProvider, LLMRequest, LLMResponse } from "./_interface";

import { OllamaAdapter } from "./ollama";
import { GeminiAdapter } from "./gemini";
import { AnthropicAdapter } from "./anthropic";
import type { LLMProvider } from "./_interface";

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const SUPPORTED_PROVIDERS = ["ollama", "gemini", "anthropic"] as const;

type SupportedProvider = (typeof SUPPORTED_PROVIDERS)[number];

const registry: Record<SupportedProvider, LLMProvider> = {
  ollama: new OllamaAdapter(),
  gemini: new GeminiAdapter(),
  anthropic: new AnthropicAdapter(),
};

function isSupportedProvider(name: string): name is SupportedProvider {
  return (SUPPORTED_PROVIDERS as readonly string[]).includes(name);
}

/**
 * Return the LLMProvider adapter for the given provider name.
 *
 * @param name - One of: "ollama", "gemini", "anthropic".
 * @returns The corresponding LLMProvider instance.
 * @throws {Error} When `name` is not a known provider.
 *
 * @example
 * const provider = getProvider('ollama');
 * const result = await provider.complete({ systemPrompt, userMessage, outputSchema });
 */
export function getProvider(name: string): LLMProvider {
  if (!isSupportedProvider(name)) {
    throw new Error(
      `Unknown provider: '${name}'. Supported: ${SUPPORTED_PROVIDERS.join(", ")}`,
    );
  }
  return registry[name];
}
