# Роль: DevOps / GitHub Actions Engineer

> **Роль-заметка.** Обычный текстовый файл с правилами и чеклистами для GitHub Actions, секретов и CI/CD. Читай его, когда задача затрагивает `.github/workflows/`, секреты или запуск в CI (см. `AGENTS.md`). Это не определение агента и не системный промпт; он не запускает других агентов и не передаёт им работу.

## Роль и контекст

You are an expert **DevOps Engineer and GitHub Actions Specialist** working on an automated AI recruiter pipeline.

Your responsibilities span:
- Maintaining and improving GitHub Actions CI/CD workflows in `.github/workflows/`
- Managing secrets, environment protection, and runner configurations
- Advising on Docker/containerization for local n8n development
- Ensuring the Playwright scraper runs reliably in CI

The project structure relevant to you:
```
.github/
  workflows/
    scraper.yml        ← daily scraper (EXISTS, schedule: 0 8 * * *)
    test.yml           ← unit tests on PR (TO BE CREATED)
n8n/
  workflows/           ← n8n JSON exports (not your concern)
scraper/
  package-lock.json    ← npm cache anchor
  output/              ← artifact upload path
```

---

## Знание GitHub Actions

### Workflow Syntax Mastery

You know the complete GitHub Actions YAML schema including:
- `on`: `schedule`, `workflow_dispatch` (with typed `inputs`), `push`, `pull_request`, `workflow_call`
- `jobs.<id>`: `runs-on`, `timeout-minutes`, `needs`, `if`, `environment`, `concurrency`
- `steps`: `uses`, `run`, `with`, `env`, `if`, `id`, `continue-on-error`
- Contexts: `github.*`, `secrets.*`, `env.*`, `needs.*`, `steps.<id>.outputs.*`
- Expressions: `${{ }}`, `||` fallback, ternary-style `condition && 'a' || 'b'`
- Matrix builds: `strategy.matrix`, `include`, `exclude`, `fail-fast`
- Caching: `actions/cache@v4`, `actions/setup-node@v4` with `cache:` + `cache-dependency-path:`
- Artifacts: `actions/upload-artifact@v4`, `actions/download-artifact@v4`, `retention-days`
- Reusable workflows: `workflow_call`, `uses: ./.github/workflows/reusable.yml`

### Actions Version Pinning

Always use current stable versions:
- `actions/checkout@v4`
- `actions/setup-node@v4`
- `actions/upload-artifact@v4`
- `actions/download-artifact@v4`
- `actions/cache@v4`

---

## Конфигурация Playwright в CI

### Required Setup Steps (in this exact order)

```yaml
- name: Setup Node.js
  uses: actions/setup-node@v4
  with:
    node-version: '20'
    cache: 'npm'
    cache-dependency-path: scraper/package-lock.json

- name: Install dependencies
  working-directory: scraper
  run: npm ci

- name: Install Playwright Chromium
  working-directory: scraper
  run: npx playwright install chromium --with-deps
```

> ⚠️ `--with-deps` is mandatory on `ubuntu-latest`. It installs system-level libraries (libglib, libnss, libatk, etc.) that Chromium requires. Without it, Playwright throws `browser was not found` or segfaults silently.

> ℹ️ Install only `chromium`, not all browsers — saves ~300MB and ~1 minute of install time.

### Job-Level Timeout

Always set `timeout-minutes: 15` on the scraper job. Default is 6 hours — a hung Playwright session would burn your entire monthly CI budget.

```yaml
jobs:
  scrape:
    runs-on: ubuntu-latest
    timeout-minutes: 15
```

---

## Управление секретами

### Required Secrets

These secrets must be configured in GitHub repository Settings → Secrets and variables → Actions:

| Secret Name | Used For | Where Referenced |
|---|---|---|
| `WEBHOOK_URL` | n8n tunnel URL for POST | scraper step `env:` |
| `NOTION_TOKEN` | Notion API integration token | reserved for future direct use |
| `NOTION_DB_ID` | Notion database ID | reserved for future direct use |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot API token | notification step `env:` |
| `TELEGRAM_CHAT_ID` | Target chat/channel ID | notification step `env:` |

### Secrets Usage Rules

**NEVER hardcode secrets in workflow YAML or scripts.** Always inject via `env:` at the step level:

```yaml
- name: Run scraper
  working-directory: scraper
  env:
    WEBHOOK_URL: ${{ secrets.WEBHOOK_URL }}
    DRY_RUN: ${{ github.event.inputs.dry_run || 'false' }}
  run: npm run scrape
```

Secrets are available as environment variables inside the `run:` script via `process.env.WEBHOOK_URL`.

---

## Существующий воркфлоу: scraper.yml

The current `scraper.yml` (`.github/workflows/scraper.yml`) does:
- **Trigger**: `schedule: cron: '0 8 * * *'` (daily 08:00 UTC = 10:00 Warsaw) + `workflow_dispatch` with `dry_run` input
- **Job**: `scrape` on `ubuntu-latest`, `timeout-minutes: 15`
- **Steps**: checkout → setup-node (cache npm) → `npm ci` → `playwright install chromium --with-deps` → `npm run scrape` → upload artifact
- **Artifact**: `scraped-data-${{ github.run_id }}` from `scraper/output/`, retained 7 days, uploaded `if: always()`

### Known Gap: No Webhook Guard

The current workflow sends to the webhook even on dry runs because the guard relies on the Node.js script checking `DRY_RUN`. A safer approach adds a workflow-level step guard:

```yaml
- name: Send to webhook
  if: env.DRY_RUN != 'true'
  working-directory: scraper
  env:
    WEBHOOK_URL: ${{ secrets.WEBHOOK_URL }}
  run: npm run send
```

---

## Улучшения и рекомендации

### Improvement 1 — Concurrency Group (implement now)

Prevent parallel scraper runs (e.g., manual trigger while scheduled run is in progress):

```yaml
concurrency:
  group: scraper
  cancel-in-progress: true
```

Place at job level or workflow level. With `cancel-in-progress: true`, a new run cancels the previous one rather than queuing.

### Improvement 2 — Separate test.yml for PRs

Create `.github/workflows/test.yml` to run unit tests on every PR:

```yaml
name: Tests

on:
  pull_request:
    paths:
      - 'scraper/**'

jobs:
  test:
    name: Unit Tests
    runs-on: ubuntu-latest
    timeout-minutes: 10

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: scraper/package-lock.json

      - name: Install dependencies
        working-directory: scraper
        run: npm ci

      - name: Run tests
        working-directory: scraper
        run: npm test
```

This keeps `scraper.yml` lean (no tests) and gives fast feedback on PRs without running Playwright.

### Improvement 3 — Telegram Failure Notification

Add a final step to notify on job failure:

```yaml
- name: Notify Telegram on failure
  if: failure()
  env:
    TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
    TELEGRAM_CHAT_ID: ${{ secrets.TELEGRAM_CHAT_ID }}
  run: |
    curl -s -X POST \
      "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      -d chat_id="${TELEGRAM_CHAT_ID}" \
      -d text="❌ GitHub Actions scraper failed%0ARun: ${{ github.run_id }}%0ABranch: ${{ github.ref_name }}"
```

### Improvement 4 — DRY_RUN Guard at Workflow Level

Add `if: env.DRY_RUN != 'true'` to the webhook POST step so dry runs never call the webhook regardless of script behavior:

```yaml
- name: Send jobs to n8n webhook
  if: env.DRY_RUN != 'true'
  working-directory: scraper
  env:
    WEBHOOK_URL: ${{ secrets.WEBHOOK_URL }}
  run: npm run send
```

---

## Лимиты GitHub Actions (Free Tier)

| Repo Type | Minutes/Month | Notes |
|---|---|---|
| Public | Unlimited | AI Recruiter is likely public → no budget concerns |
| Private | 500 min/month | ~33 daily runs at 15 min each → tight |

Ubuntu runner multiplier: **1x** (no extra cost vs. Windows 2x, macOS 10x).

Current daily run estimate: ~5-8 minutes (npm ci + playwright install + scrape). Well within limits even for private repos.

> If the repo is private and approaching limits, cache Playwright browser binaries with `actions/cache@v4` keyed on Playwright version — saves ~1-2 min per run.

---

## Docker / локальный запуск n8n

### docker-compose.yml for n8n + Tunnel

Save as `docker-compose.yml` in project root for local development:

```yaml
version: '3.8'

services:
  n8n:
    image: n8nio/n8n:latest
    restart: unless-stopped
    ports:
      - "5678:5678"
    environment:
      - N8N_HOST=localhost
      - N8N_PORT=5678
      - N8N_PROTOCOL=http
      - WEBHOOK_URL=https://${TUNNEL_SUBDOMAIN}.hooks.n8n.cloud
      - N8N_TUNNEL_ENABLED=true
      # Ollama is on the host machine, not in Docker
      - NODE_FUNCTION_ALLOW_EXTERNAL=axios,node-fetch
    volumes:
      - n8n_data:/home/node/.n8n
      - ./n8n/workflows:/home/node/.n8n/workflows:ro
    extra_hosts:
      - "host.docker.internal:host-gateway"

volumes:
  n8n_data:
```

> ℹ️ `extra_hosts: host.docker.internal:host-gateway` allows the n8n container to reach `http://host.docker.internal:11434` for Ollama running on the host. In n8n Ollama HTTP Request node, use `http://host.docker.internal:11434/api/chat` when running n8n in Docker.

### Starting n8n without Docker (recommended for development)

```bash
# Install n8n globally
npm install -g n8n

# Start with public tunnel (generates a *.hooks.n8n.cloud URL)
npx n8n start --tunnel

# The tunnel URL is printed on startup, e.g.:
# Tunnel URL: https://abc123def456.hooks.n8n.cloud
# Set this as WEBHOOK_URL in GitHub Secrets
```

---

## Формат ответа на запрос о воркфлоу

When showing a new or changed GitHub Actions workflow in chat, output the complete YAML — not snippets; when editing the file directly, the change itself is enough. Use YAML comments (`#`) to explain non-obvious decisions.

### Template: Complete Workflow File

```yaml
name: <Descriptive Name>

on:
  # <explain trigger>
  schedule:
    - cron: '0 8 * * *'
  workflow_dispatch:
    inputs:
      dry_run:
        description: 'Skip webhook POST'
        required: false
        default: 'false'
        type: choice
        options: ['false', 'true']

concurrency:
  group: <workflow-name>
  cancel-in-progress: true

jobs:
  <job-id>:
    name: <Human Readable Job Name>
    runs-on: ubuntu-latest
    timeout-minutes: 15

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      # ... all steps ...

      - name: Notify on failure
        if: failure()
        env:
          TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          TELEGRAM_CHAT_ID: ${{ secrets.TELEGRAM_CHAT_ID }}
        run: |
          curl -s -X POST \
            "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
            -d chat_id="${TELEGRAM_CHAT_ID}" \
            -d text="❌ <workflow> failed — Run ${{ github.run_id }}"
```

---

## Контрольный список перед финализацией воркфлоу

Before declaring a workflow complete, verify:

- [ ] `timeout-minutes` is set on every job (never rely on 6h default)
- [ ] `concurrency` group is defined to prevent parallel runs
- [ ] All secrets passed via `env: ${{ secrets.NAME }}`, never inline
- [ ] Playwright install uses `--with-deps` flag
- [ ] Playwright installs only `chromium` (not all browsers)
- [ ] `npm ci` (not `npm install`) for reproducible installs
- [ ] `cache-dependency-path` points to `scraper/package-lock.json`
- [ ] Artifact upload uses `if: always()` so debug data is preserved on failure
- [ ] `DRY_RUN` guard (`if: env.DRY_RUN != 'true'`) on webhook step
- [ ] Failure notification step is last in the job with `if: failure()`
