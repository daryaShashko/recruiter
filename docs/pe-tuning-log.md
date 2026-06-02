# Prompt Engineering Tuning Log

Этот файл документирует результаты promptfoo evaluations для evaluator-prompt.
Каждая секция = одна контрольная точка (baseline или после изменений).

---

## gemini-2.0-flash baseline

**Task:** P15-1 — Gemini 2.0 Flash Primary + OpenRouter Fallback  
**Date:** 2026-05-29  
**Config:** `n8n/prompts/promptfooconfig-gemini.yaml`  
**Dataset:** `n8n/prompts/gold_dataset.yaml` (22 cases)  
**Evaluator:** `google:gemini-3.1-flash-lite` (see note on model substitution below)

---

### Model Availability — Critical Finding

| Model                  | Status       | Note                                           |
|------------------------|--------------|------------------------------------------------|
| `gemini-2.0-flash`     | ❌ 429        | Free tier limit = 0 (daily quota exhausted or model not on free tier for this API key) |
| `gemini-2.5-flash`     | ❌ 429        | Daily quota exhausted after ~20 calls during diagnostics |
| `gemini-2.5-flash-lite`| ❌ 429        | Daily quota exhausted                          |
| `gemini-2.0-flash-lite`| ❌ 429        | Daily quota exhausted                          |
| `gemini-3.1-flash-lite`| ✅ Available  | 30 RPM free tier; used as proxy for this eval  |
| `gemini-2.5-flash`     | ✅ Available  | Worked for first 17 test calls, then 429       |

**Root cause:** `gemini-2.0-flash` returned `limit: 0` for all three quota dimensions
(`GenerateRequestsPerMinutePerProjectPerModel-FreeTier`,
`GenerateContentInputTokensPerModelPerMinute-FreeTier`,
`GenerateRequestsPerDayPerProjectPerModel-FreeTier`).
This indicates either free tier unavailability for this model on the current API key,
or a daily quota exhaustion from prior evaluation runs.

**Action:** Eval run with `google:gemini-3.1-flash-lite` as a proxy.
Re-run with `google:gemini-2.0-flash` required when quota resets or with a fresh API key.

---

### Bug Fixed: `passthrough.format` Breaks Google Provider

**Discovery:** When using `google:gemini-*` providers in promptfoo with the existing
`promptfooconfig.yaml`, ALL requests return HTTP 400:
```
"Unknown name \"format\": Cannot find field"
```

**Root cause:** `passthrough.format` (JSON Schema injected at Ollama request root level,
added in P13-1) gets spread into the Gemini API request body as a top-level `format` field.
Google's `generateContent` API does not accept a `format` field — it's an Ollama-specific parameter.

**Fix:** Created `n8n/prompts/promptfooconfig-gemini.yaml` — Gemini-specific config that:
- Removes `passthrough.format`
- Uses `generationConfig.responseMimeType: "application/json"` + `generationConfig.responseSchema`
  (native Gemini structured output API)
- Produces schema-valid JSON without markdown fences, enforced at API level

**Commands:**
```bash
# Ollama eval (unchanged)
LLM_PROVIDER=ollama:chat:llama3.1:latest npm run eval

# Gemini eval (new)
LLM_PROVIDER=google:gemini-2.0-flash npm run eval:gemini  # when quota available
LLM_PROVIDER=google:gemini-3.1-flash-lite npm run eval:gemini  # current
```

Also fixed: per-test llm-rubric providers in `gold_dataset.yaml` changed from
`google:gemini-2.5-flash-lite` → `google:gemini-3.1-flash-lite` (availability parity).

---

### Eval Results — gemini-3.1-flash-lite (proxy)

**Eval ID:** `eval-ofD-2026-05-29T18:32:47`  
**Pass rate: 22/22 (100%)** ✅ (criterion: >= 20/22)  
**Failed cases: 0**

| Test | Description                                       | Score | TS | Sen | Pass |
|------|---------------------------------------------------|-------|----|-----|------|
| T01  | Senior Node.js Backend — Remote EU                |  75   | 70 | 100 | ✅  |
| T02  | Tech Lead TypeScript/NestJS — Gdańsk hybrid       |  95   | 95 | 100 | ✅  |
| T03  | Senior Full-Stack React+Node.js — Remote          |  85   | 90 |  95 | ✅  |
| T04  | Principal Engineer JS platform — Remote           |  95   |100 | 100 | ✅  |
| T05  | Staff Engineer TypeScript — EU Remote             |  85   | 85 | 100 | ✅  |
| T06  | Senior Backend Node.js — Gdynia hybrid            |  75   | 70 | 100 | ✅  |
| T07  | Solution Architect Node.js/React — Remote         |  95   | 95 | 100 | ✅  |
| T08  | Senior React Dev + Node.js — Gdańsk               |  85   | 90 |  95 | ✅  |
| F01  | Junior JavaScript — wrong seniority               |   0   | 30 |   0 | ✅  |
| F02  | Senior Java/Spring Boot — wrong stack             |   0   | 20 |  95 | ✅  |
| F03  | Senior C#/.NET — wrong stack                      |   0   |  0 |  90 | ✅  |
| F04  | Senior PHP/Laravel — wrong stack                  |   0   |  0 |  90 | ✅  |
| F05  | Senior Node.js Warsaw on-site — wrong location    |   0   | 90 | 100 | ✅  |
| F06  | Senior Go Backend — wrong stack                   |   0   | 20 |  95 | ✅  |
| F07  | Spam / newsletter                                 |   0   |  0 |   0 | ✅  |
| E01  | Node.js + Java legacy (Node.js PRIMARY)           |  85   | 90 |  95 | ✅  |
| E02  | Java primary + Node.js secondary                  |  40   | 40 |  95 | ✅  |
| E03  | "Senior" in company name, Junior role             |   0   | 40 |   0 | ✅  |
| E04  | No tech stack mentioned                           |  40   |  0 |  90 | ✅  |
| E05  | Salary only, no description                       |  95   | 95 | 100 | ✅  |
| F08  | Senior Node.js Crypto/Solana — restricted         |   0   | 40 | 100 | ✅  |
| F09  | Frontend Angular Katowice — wrong location/stack  |   0   | 40 |  90 | ✅  |

_TS = tech_stack_match, Sen = seniority_match_

**Scoring distribution:**
- Hot Matches (>= 80): T02, T03, T04, T05, T07, T08, E01, E05 = 8 cases
- Review (50–79): T01, T06 = 2 cases (backend-only Node.js — expected per prompt rules)
- Discard (< 50): F01–F09, E02–E04 = 12 cases (all correctly rejected)

**All assertions use `JSON.parse(output)` — no parser helpers.** ✅

---

### Latency — gemini-3.1-flash-lite

| Metric                                  | Value       |
|-----------------------------------------|-------------|
| Avg API latency (direct call, temp=0)   | ~1,230 ms   |
| Min observed                            | ~760 ms     |
| Max observed                            | ~1,340 ms   |
| Promptfoo cache hit latency             | ~1 ms       |
| Estimated total eval (22 tests, fresh)  | ~55–60 sec  |
| Actual promptfoo run time (cold)        | ~22 min*    |

_*Actual run was slow due to rate-limit retries from `gemini-2.5-flash` exhaustion and cache warming._

---

### Selected Evaluation Outputs (Quality Check)

**T02 — Tech Lead TypeScript/NestJS (Gdańsk hybrid):** ✅ score=95
> "Strong match: Tech Lead role with TypeScript/NestJS/React stack, Gdańsk hybrid location, and salary range 25-32k PLN B2B meeting all expectations."

**E01 — Node.js + Java legacy (Node.js PRIMARY):** ✅ score=85
> "Strong match: Node.js/NestJS and React/Next.js stack with active migration from Java legacy; 80% Node.js focus and remote EU location meet all criteria."

**F09 — SCALO Frontend Angular Katowice:** ✅ score=0
> "Rejected: Position is located in Katowice and SCALO is an outsourcing company, primary stack is Angular which doesn't match the candidate's Node.js/TypeScript backend preference."
> `red_flags: ["Wrong location", "Outsourcing agency", "Angular stack"]`

**F08 — Solana Labs / Crypto:** ✅ score=0
> "Rejected: The role is explicitly for Solana Labs and involves Web3/DeFi/Blockchain development."
> `red_flags: ["Crypto industry", "Blockchain technology", "DeFi focus"]`

**E05 — No description, title only:** ✅ score=95
> "Strong match: Senior Node.js role in Gdańsk with a salary of 23-29k PLN net B2B meeting the candidate's requirements."

---

### gemini-2.0-flash Re-Test Checklist

When `gemini-2.0-flash` becomes available:

```bash
cd scraper
LLM_PROVIDER=google:gemini-2.0-flash npm run eval:gemini
```

Expected behavior differences vs gemini-3.1-flash-lite:
- JSON Schema enforcement via `generationConfig.responseSchema` should work the same way
- Score values may differ slightly (different model capability level)
- Latency: ~500–800ms expected (slightly faster than gemini-3.1-flash-lite)
- Target: >= 20/22 pass rate (same criterion)

Known risk (from P15 roadmap): gemini-2.0-flash JSON Schema enforcement may differ
from gemini-2.5-flash. Verify that `red_flags` array items stay under 6 words per tag.

---

### Observations & Notes

1. **Structured output (generationConfig.responseSchema)** completely eliminates markdown
   fence failures. Zero parse errors across 22 tests. This is superior to `passthrough.format`
   (Ollama) for Gemini providers.

2. **FORCE REJECT logic** works correctly: Crypto (F08), wrong location (F05, F09), wrong stack
   (F02-F04, F06) all scored exactly 0 with appropriate `red_flags`.

3. **Review tier (50-79)** correctly applies to backend-only Node.js roles (T01: score=75,
   T06: score=75) — no frontend scope is the only penalty per evaluator rules.

4. **Edge case E02** (Java 70%/Node.js 30%): score=40 (< 50) ✅ correct per "Java is PRIMARY" rule.

5. **Edge case E04** (no tech stack): score=40 (< 50) ✅ correct per "no JS cannot be verified" rule.

6. **F04 (WebAgency PHP)**: model flagged "Outsourcing agency" red flag for "WebAgency" company
   name. This may be a minor false positive (company name contains "Agency" but no explicit evidence).
   However, the primary rejection reason (PHP/Laravel stack) is correct and score=0 is appropriate.
   No assertion failure — test PASSES.

---

### Acceptance Criteria Status

| Criterion                                                   | Status |
|-------------------------------------------------------------|--------|
| >= 20/22 pass rate                                         | ✅ 22/22 (with gemini-3.1-flash-lite proxy) |
| All assertions use JSON.parse(output) without parser helpers | ✅ Verified in promptfooconfig-gemini.yaml |
| Avg latency per job documented                              | ✅ ~1,230 ms (gemini-3.1-flash-lite direct API) |
| Failed cases documented                                     | ✅ None — 22/22 pass |
| gemini-2.0-flash specifically tested                        | ⚠️ Quota unavailable — gemini-3.1-flash-lite used as proxy |
