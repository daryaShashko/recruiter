# ADR-016: LLM Provider Adapter Pattern — Model-Agnostic Evaluation Pipeline

─────────────────────────────────────────────────────────
**ADR-016:** Extract all LLM provider-specific code into isolated adapters
**Date:** 2026-05-28
**Status:** Accepted
**Extends:** ADR-011 (formalizes and implements LLM_PROVIDER env vars)
─────────────────────────────────────────────────────────

## CONTEXT

Currently all model-specific code is hardcoded for Ollama in **5 places**:

| Coupling point | Where | Why it breaks on provider switch |
|---|---|---|
| URL | `localhost:11434/api/chat` | Gemini/Anthropic have different hosts and paths |
| Auth | None | Gemini: `?key=` query; Anthropic: `x-api-key` header; Bedrock: AWS SigV4 |
| Request body | `{model, stream, keep_alive, messages}` | Gemini: `{contents, generationConfig}`; Anthropic: `{model, system, messages}` |
| Structured output | `format: {schema}` (Ollama grammar) | Anthropic: `output_config.format`; Gemini: `responseSchema`; incompatible |
| Response path | `response.message.content` | Gemini: `.candidates[0].content.parts[0].text`; Anthropic: `.content[0].text` |

ADR-011 proposed `LLM_PROVIDER` / `LLM_API_KEY` / `LLM_MODEL` env vars but
provided no adapter implementation. Switching providers today requires changing all 5 places
across n8n workflow JSON and promptfoo config.

Planned migrations that make this urgent:
- **ADR-010** (Oracle Cloud) → CPU-only ARM instance → no GPU → must switch to cloud LLM
- **ADR-011** (Groq/Gemini free tier) → already decided, not yet implemented
- Future: AWS Bedrock, Anthropic API for higher quality evaluation

## DECISION

Extract all provider-specific logic into isolated adapter modules under `n8n/providers/`:

```
n8n/providers/
  _interface.ts    — LLMRequest, LLMResponse, LLMProvider interface (the contract)
  ollama.ts        — OllamaAdapter: localhost HTTP API, format:{schema} grammar
  gemini.ts        — GeminiAdapter: generateContent API, responseSchema
  anthropic.ts     — AnthropicAdapter: Messages API, output_config.format
  index.ts         — getProvider(name: string): LLMProvider factory function
```

**Single contract (LLMProvider interface):**
```typescript
interface LLMRequest {
  systemPrompt: string;
  userMessage: string;
  outputSchema: object;  // JSON Schema — universal across providers
}

interface LLMResponse {
  content: string;       // always a string; caller does JSON.parse()
  provider: string;
  model: string;
}

interface LLMProvider {
  complete(req: LLMRequest): Promise<LLMResponse>;
}
```

**n8n:** Replace the hardcoded `HTTP Request: Ask Ollama` node with a single
`LLM Router` Code Node that reads `LLM_PROVIDER` / `LLM_API_KEY` / `LLM_MODEL`
from n8n environment credentials and delegates to the correct inline adapter.

**promptfoo:** Provider selection via `LLM_PROVIDER` env var in `promptfooconfig.yaml`.
Remove Ollama-specific assistant prefill from `evaluator-template.json`
(it is not supported by Gemini or Anthropic and causes request errors).

**AWS Bedrock:** Deferred — requires IAM/SigV4 authentication that cannot be done
via a simple HTTP call; needs AWS SDK as a dependency. Separate decision required.

## RATIONALE

- **One env change = provider switch** for both n8n pipeline and promptfoo evaluation
- **Adding a new provider** requires creating exactly one new file (`n8n/providers/new.ts`)
- **Downstream pipeline unchanged** — all nodes after LLM Router receive `{content, provider, model}`
- **Formalizes ADR-011** — env vars are defined, routing is actually implemented
- **Enables cross-provider consistency testing** in promptfoo (same 22 gold cases, 3 providers)
- **PE techniques** (ADR-017) require per-provider structured output — adapters provide clean hook

## CONSEQUENCES

### Positive
- `LLM_PROVIDER=gemini LLM_API_KEY=xxx` → n8n workflow works without any JSON changes
- Provider-specific bugs are isolated to one file; rest of pipeline is unaffected
- `npm run eval` tests any provider: `LLM_PROVIDER=anthropic:claude-haiku-4-5 npm run eval`
- Removes assistant prefill hack — prompts are now portable across providers
- Enables P13 (PE Best Practices) to implement structured output per-provider correctly

### Negative / Trade-offs
- n8n Code Node with inline adapter switch is larger than a simple HTTP Request node
  (mitigated: each adapter block is ~15 lines)
- `evaluator-template.json` loses assistant prefill → cold-start quality may differ on
  Gemini/Anthropic; compensated by few-shot examples in P13
- Bedrock requires AWS SDK — deferred, needs a follow-up ADR

### Interface changes
- New files: `n8n/providers/` directory with 5 TypeScript modules
- Changed: `n8n/workflows/ingest.json` — LLM Router Code Node replaces Ask Ollama
- Changed: `n8n/prompts/promptfooconfig.yaml` — env-driven provider
- Changed: `n8n/prompts/evaluator-template.json` — remove assistant prefill
- Changed: `.env.example` — add `LLM_PROVIDER`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_BASE_URL`
- New: `docs/llm-provider-switching.md` — one-command switch table

## IMPLEMENTATION

Phase P12 tasks: P12-1 through P12-8 (see `context/roadmap.yaml` phase P12).

Provider comparison reference:

| Aspect | Ollama | Gemini Flash | Anthropic Claude |
|---|---|---|---|
| Base URL | `http://localhost:11434` | `generativelanguage.googleapis.com` | `api.anthropic.com` |
| Auth | None | `?key={API_KEY}` query param | `x-api-key` header |
| Path | `/api/chat` | `/v1beta/models/{model}:generateContent` | `/v1/messages` |
| Body root | `{model, messages}` | `{contents, generationConfig}` | `{model, system, messages}` |
| Structured output | `format: {schema}` (grammar) | `generationConfig.responseSchema` | `output_config.format` |
| Response path | `.message.content` | `.candidates[0].content.parts[0].text` | `.content[0].text` |
| Rate limit (free) | Unlimited (local) | 15 RPM / 1500 RPD | 5 RPM (free tier) |

─────────────────────────────────────────────────────────
