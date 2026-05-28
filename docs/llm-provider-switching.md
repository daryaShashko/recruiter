# LLM Provider Switching Guide

> Related ADR: [ADR-016 — LLM Provider Adapter Pattern](./adr/ADR-016-llm-provider-adapter-pattern.md)

The AI Recruiter pipeline supports three LLM providers via the adapter pattern introduced in ADR-016.
Switching providers requires changing two environment variables and restarting n8n — no workflow JSON edits needed.

---

## Quick-reference table

| Provider | One-command switch | Required secrets |
|---|---|---|
| **Ollama** (local, default) | `LLM_PROVIDER=ollama` | None |
| **Gemini** (Google AI Studio) | `LLM_PROVIDER=gemini LLM_API_KEY=<key>` | `LLM_API_KEY` |
| **Anthropic** (Claude API) | `LLM_PROVIDER=anthropic LLM_API_KEY=<key>` | `LLM_API_KEY` |

---

## Provider setup commands

### Ollama (default)

No API key needed. Ollama must be running locally (or accessible via `LLM_BASE_URL`).

**.env**
```env
LLM_PROVIDER=ollama
LLM_BASE_URL=http://localhost:11434
LLM_MODEL=llama3.1:latest
LLM_API_KEY=
```

**Run evaluation:**
```bash
LLM_PROVIDER=ollama npm run eval
```

---

### Gemini (Google AI Studio)

Get a free API key at [aistudio.google.com](https://aistudio.google.com).

**.env**
```env
LLM_PROVIDER=gemini
LLM_MODEL=gemini-2.0-flash
LLM_API_KEY=AIzaSy...
LLM_BASE_URL=
```

**Run evaluation:**
```bash
LLM_PROVIDER=gemini LLM_API_KEY=AIzaSy... npm run eval
```

**n8n environment (Settings → Environment Variables):**
```
LLM_PROVIDER  = gemini
LLM_MODEL     = gemini-2.0-flash
LLM_API_KEY   = AIzaSy...
```

---

### Anthropic (Claude API)

Get an API key at [console.anthropic.com](https://console.anthropic.com).

**.env**
```env
LLM_PROVIDER=anthropic
LLM_MODEL=claude-haiku-4-5
LLM_API_KEY=sk-ant-...
LLM_BASE_URL=
```

**Run evaluation:**
```bash
LLM_PROVIDER=anthropic LLM_API_KEY=sk-ant-... npm run eval
```

**n8n environment (Settings → Environment Variables):**
```
LLM_PROVIDER  = anthropic
LLM_MODEL     = claude-haiku-4-5
LLM_API_KEY   = sk-ant-...
```

---

## Model defaults per provider

| Provider | Default model | Override via |
|---|---|---|
| `ollama` | `llama3.1:latest` | `LLM_MODEL` env var |
| `gemini` | `gemini-2.0-flash` | `LLM_MODEL` env var |
| `anthropic` | `claude-haiku-4-5` | `LLM_MODEL` env var |

---

## Rate limits (free tiers)

| Provider | Limit |
|---|---|
| Ollama | Unlimited (local) |
| Gemini | 15 RPM / 1500 RPD |
| Anthropic | 5 RPM (free tier) |

---

## Adding a new provider

1. **Create the adapter file** — add `n8n/providers/<name>.ts` implementing the `LLMProvider` interface from `n8n/providers/_interface.ts`:

   ```typescript
   import type { LLMProvider, LLMRequest, LLMResponse } from './_interface';

   export class MyProviderAdapter implements LLMProvider {
     async complete(req: LLMRequest): Promise<LLMResponse> {
       // call your API, return { content, provider, model }
     }
   }
   ```

2. **Register in the factory** — add the new provider to the `getProvider` switch in `n8n/providers/index.ts`:

   ```typescript
   case 'myprovider':
     return new MyProviderAdapter();
   ```

3. **Update documentation** — add the new provider to `.env.example` (the `LLM_PROVIDER` comment line and a setup example), and to the tables in this file and in `context/env.yaml`.

---

## Storing secrets safely

| Context | How to store `LLM_API_KEY` |
|---|---|
| Local development | `.env` file (git-ignored) |
| n8n (self-hosted) | Settings → Environment Variables |
| GitHub Actions | Repository Settings → Secrets → `LLM_API_KEY` |

Never commit real API keys to the repository.
