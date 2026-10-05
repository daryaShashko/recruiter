/**
 * LLM provider fallback router.
 *
 * Ports the live n8n "Code: LLM Router" node (see ADR-019, context/decisions.yaml) —
 * tries each provider in order via n8n/providers' adapters, returns the first success,
 * and throws an aggregated error if every provider fails. The node's own two historical
 * "generator" scripts (scripts/p12_6_llm_router.py, scripts/patch_llm_router.py) both
 * drifted from what's actually deployed; this reads the live node's real behavior
 * directly (captured via the n8n API on 2026-10-05), not either script's assumption.
 */

import { getProvider } from "../providers";
import type { LLMRequest } from "../providers/_interface";

export interface RouterResult {
  readonly content: string;
  readonly provider: string;
}

/** Matches the live node's PROVIDER_ORDER as of 2026-10-05: OpenRouter primary, Gemini fallback. */
export const DEFAULT_PROVIDER_ORDER = ["openrouter", "gemini"] as const;

function stripCodeFence(content: string): string {
  const trimmed = content.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
}

/**
 * Try each provider in `order`, returning the first successful completion.
 * On total failure, throws with every provider's error joined by newlines.
 */
export async function routeCompletion(
  req: LLMRequest,
  order: readonly string[] = DEFAULT_PROVIDER_ORDER,
): Promise<RouterResult> {
  const errors: string[] = [];

  for (const name of order) {
    try {
      const provider = getProvider(name);
      const response = await provider.complete(req);
      return { content: stripCodeFence(response.content), provider: name };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${name}: ${message}`);
    }
  }

  throw new Error(`All providers failed:\n${errors.join("\n")}`);
}
