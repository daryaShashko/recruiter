# System Status Radar

**Project:** AI Recruiter & Generator | **Mode:** Local/Dry-Run ($0/mo) | **Updated:** 2026-11-14

## Epic Radar
| Epic | Scope | Status | Progress | Next |
|------|-------|:-----:|:-------:|------|
| E01 Scraper | `scraper/src/scrapers/` | DONE | 100% | Greenhouse parser |
| E02 n8n Core | `n8n/workflows/` | DONE | 100% | Cloud migration |
| E03 LLM Eval | `n8n/evaluator/` | DONE | 95% | Fix 1 failing prompt |
| E04 Generator | `scraper/src/generator/` | DONE | 100% | Email-apply UI |
| E05 HITL Telegram | `scraper/src/utils/telegram.ts` | DONE | 100% | UI button |
| E06 Web-Form Apply | — | PLANNED | 0% | Q4-2026 |
| E07 Cloud Migration | Docker, Oracle | BLOCKED | 40% | Oracle access |
| E08 Quality | R1-R5, Tiered tests | DONE | 100% | Carousel plan complete |

## Metrics
- Tests: 442 passed, 9 skipped, 0 failed (34 suites)
- Tiered tests: `test:tier1` (unit), `test:tier2` (contracts), `test:integration` (smoke)
- TS: 0 errors (`npm run typecheck`)
- Linter & Dead Code: Oxlint 0 errors, Knip clean
- Cost: $0 / month
- CV source: 100% Notion

## Immediate Focus
1. Slice 1 cleanup (DONE)
2. Slice 2 deterministic gates (DONE)
3. Slice 3 docs (AGENTS + STATUS) (DONE)
4. Slice 4 tiered tests (DONE)
