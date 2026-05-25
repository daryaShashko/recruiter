# ADR-011: Replace local Ollama with Cloud LLM API (Groq/Gemini) for evaluation

─────────────────────────────────────────────────────────
**ADR-011:** Migrate LLM evaluation from local Ollama to free cloud LLM API
**Date:** 2026-05-25
**Status:** Proposed
**Supersedes:** ADR-002 (Local Ollama instead of cloud LLM API) — partially
─────────────────────────────────────────────────────────

## CONTEXT

ADR-002 established "Local Ollama only — no cloud LLM" as a hard constraint.
This was correct for the local POC where the developer's machine had a GPU.

With ADR-010 (cloud migration to Oracle ARM), the situation changes fundamentally:
- Oracle Always Free instances have **no GPU** (ARM CPU only)
- Ollama on CPU produces ~2-5 tokens/second (vs ~10-30 tok/s with GPU)
- Evaluating 200 vacancies at ~2 tok/s would take **3-6 hours** per daily run
- CPU-bound LLM inference consumes 100% of all 4 vCPU, destabilizing n8n

The original ADR-002 concerns were:
1. **Rate limits break batch processing** — addressed by throttled queue pattern
2. **Per-token costs are unbounded** — addressed by free-tier APIs (Groq, Gemini)
3. **Job descriptions contain personal data** — incorrect: vacancies are public data

Free cloud LLM options (as of May 2026):
- **Groq**: Llama 3 / Mixtral, 15 RPM free, ~100 tok/s latency
- **Google Gemini 1.5 Flash**: 15 RPM / 1500 RPD free, fast
- Both have generous free tiers sufficient for 200 vacancies/day

## DECISION

Replace the `HTTP Request: Ask Ollama` node in the evaluate workflow with a
cloud LLM API call (primary: Groq, fallback: Gemini 1.5 Flash).

Implement a **Throttled Queue** pattern in n8n:
- After each LLM evaluation, add a `Wait` node (4 seconds delay)
- This ensures ≤15 requests/minute, staying within free-tier rate limits
- Total batch processing time: ~13-15 minutes for 200 vacancies

Implement **fallback routing**:
- If primary API returns 429 (rate limit exceeded), switch to fallback API
- Configurable via n8n environment variables: `LLM_PROVIDER`, `LLM_API_KEY`

## RATIONALE

- **Performance**: Cloud LLM processes 200 vacancies in ~15 min vs ~3-6 hours on CPU
- **Stability**: n8n remains responsive — no CPU saturation from inference
- **Cost**: $0 — both Groq and Gemini offer free tiers sufficient for this volume
- **Quality**: Gemini 1.5 Flash / Llama 3 on Groq are comparable to or better than
  local llama3.1:8b for JSON classification tasks
- **Data privacy**: Job postings are **public data** published on public websites.
  No PII is sent to the cloud API. Company names, salaries, and job descriptions
  are all intentionally published by the hiring company.

## CONSEQUENCES

### Positive
- 10-20x faster evaluation (15 min vs 3-6 hours)
- n8n CPU stays idle during evaluation — stable for concurrent webhooks
- No GPU/VRAM management (keep_alive, VRAM leaks become irrelevant)
- Higher model quality available (Gemini Flash, Llama 3 70B on Groq)
- Dual-provider fallback increases reliability

### Negative / Trade-offs
- **External dependency**: evaluation now depends on Groq/Google API availability
- **Rate limits**: must respect 15 RPM — enforced by Wait node in n8n
- **API key management**: new secrets to manage (LLM_API_KEY)
- **Free tier may change**: Groq or Google could reduce free limits
  (mitigated by dual-provider fallback)
- **Latency variance**: cloud API latency is less predictable than local Ollama

### Interface changes
- `EvaluationResult` schema: **no change** (same {match, reason, url} JSON)
- New env vars: `LLM_PROVIDER` (groq|gemini), `LLM_API_KEY`, `LLM_MODEL`
- `evaluator.md` prompt: **no change** (same system prompt works with all models)

### Follow-up tasks
- `CLOUD-9` through `CLOUD-11` (see roadmap.yaml Phase 7)
- Update `architect.md`: remove CLOUD_LLM anti-pattern, update constraints
- Update `architecture.md`: change data flow diagram
- Update `env.yaml`: add new env vars

### Constraint updates
- **Removes**: "Local Ollama only — no cloud LLM, no external AI APIs"
- **Adds**: "Free-tier cloud LLM only — no paid API usage"
- **Adds**: "Throttled Queue pattern mandatory for cloud LLM calls (≤15 RPM)"
- **Modifies** anti-pattern CLOUD_LLM → PAID_LLM (reject paid APIs, accept free-tier)

### Preserving local Ollama as option
Local Ollama remains available as a **development/testing** tool:
- Developers can run evaluations locally against Ollama for prompt testing
- The n8n workflow should support `LLM_PROVIDER=ollama` for local mode
- This is a configuration switch, not a code change

─────────────────────────────────────────────────────────
