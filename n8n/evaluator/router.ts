/**
 * LLM provider fallback router.
 *
 * Ports the live n8n "Code: LLM Router" node (see ADR-019, context/decisions.yaml) —
 * tries each provider in order via n8n/providers' adapters, returns the first success,
 * and throws an aggregated error if every provider fails. Historical generators both
 * drifted from what's actually deployed; this reads the live node's real behavior
 * directly (captured via the n8n API on 2026-10-05), not either generator's assumption.
 */

import { getProvider } from "../providers";
import type { LLMRequest } from "../providers/_interface";

export interface RouterResult {
  readonly content: string;
  readonly provider: string;
}

export interface RetryOptions {
  readonly maxAttempts?: number;
  readonly baseDelayMs?: number;
  readonly sleepFn?: (ms: number) => Promise<void>;
}

/** Matches the live node's PROVIDER_ORDER as of 2026-10-29: Gemini primary, OpenRouter fallback. */
export const DEFAULT_PROVIDER_ORDER = ["gemini", "openrouter"] as const;
export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_BASE_DELAY_MS = 1000;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isRetryableLlmError(err: unknown): boolean {
  const message = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    /\b(?:429|500|502|503|504)\b/.test(message) ||
    message.includes("rate limit") ||
    message.includes("too many requests") ||
    message.includes("quota") ||
    message.includes("service unavailable") ||
    message.includes("bad gateway") ||
    message.includes("gateway timeout")
  );
}

function stripCodeFence(content: string): string {
  const trimmed = content.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
}

/**
 * Try each provider in `order` with exponential backoff retries (1s -> 2s -> 4s, up to 3 attempts)
 * on 429 and 5xx errors, returning the first successful completion.
 * On total failure, throws with every provider's error joined by newlines.
 */
export async function routeCompletion(
  req: LLMRequest,
  order: readonly string[] = DEFAULT_PROVIDER_ORDER,
  retryOptions?: RetryOptions,
): Promise<RouterResult> {
  const errors: string[] = [];
  const maxAttempts = retryOptions?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseDelayMs = retryOptions?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const sleep = retryOptions?.sleepFn ?? defaultSleep;

  for (const name of order) {
    const provider = getProvider(name);
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await provider.complete(req);
        return { content: stripCodeFence(response.content), provider: name };
      } catch (err) {
        if (attempt < maxAttempts && isRetryableLlmError(err)) {
          const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
          await sleep(delayMs);
          continue;
        }
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`${name}: ${message}`);
        break;
      }
    }
  }

  throw new Error(`All providers failed:\n${errors.join("\n")}`);
}
