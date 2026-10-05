# Deploy plan: wire the evaluator service into the live n8n workflow

**Audience:** this is a runbook for whichever agent/session executes the deploy. It is
self-contained — you should not need the conversation that produced it. Read this whole
file before touching anything.

**Status when this was written:** code is built, unit-tested, and smoke-tested locally.
Nothing is deployed to the VM. The live n8n workflow is untouched and still calling
Gemini/OpenRouter directly from its own Code node. **This plan's job is to change that,
carefully, with a rollback path, without breaking the daily production pipeline.**

Repo: `/Users/Darya_Shashko/Projects/recruiter` (or wherever it's checked out), branch
`main`, commit `d581115` or later. Pushed to `origin/main` already — `git pull` first to
make sure.

## 1. Why this exists (minimum context, see ADR-019 in `context/decisions.yaml` for the full story)

- The n8n "Code: LLM Router" node's logic lived only inline in n8n's UI and had already
  drifted from its own historical patch scripts (`scripts/p12_6_llm_router.py`,
  `scripts/patch_llm_router.py`) — neither matched what was actually deployed.
- That logic (LLM fallback-chain call + hard-reject scoring, read directly from the live
  node via the n8n API) has been ported verbatim into `n8n/evaluator/router.ts` and
  `scoring.ts`, with 20 Jest tests, reusing the already-existing `n8n/providers/*.ts`
  adapters (ADR-016).
- `n8n/evaluator/server.ts` wraps both in a tiny dependency-free HTTP server
  (`POST /evaluate`, `GET /healthz`).
- **Decision already made:** call this over HTTP from one n8n node, not a direct
  Code-node import. Reason: the deployed n8n is the stock `docker.n8n.io/n8nio/n8n`
  image (`n8n/docker-compose.yml`) with no `NODE_FUNCTION_ALLOW_EXTERNAL` — a direct
  import would need a custom Docker image rebuilt on every change. One more small
  process on the same VM is cheaper and simpler. **Do not revisit this decision** unless
  you discover it's actually impossible for a reason this plan didn't anticipate — if
  so, stop and surface that instead of improvising a third approach.

## 2. What you need before starting

- SSH access to the VM: `ssh -i <path-to-key> ubuntu@92.5.81.123` (host also resolves as
  `n8n-recruiter.duckdns.org`). The key path is whatever the user saved when the VM was
  created (see `docs/cloud-migration-guide.md` section 2.4 if you need to ask them) —
  check `~/.ssh/` and `~/Downloads/` for an `id_ed25519`-style or `ssh-key-*.key` file
  first. **If SSH is blocked or the key isn't findable, stop and ask the user — don't
  guess at paths or weaken host-key checking to force a connection.**
- `~/.n8n-recruiter-key` on the local machine (chmod 600) — a read-only-scope n8n API
  key used by `scripts/inspect-n8n.py` / `scripts/check-n8n-drift.py`. If it's not there,
  ask the user; don't try to mint a new one yourself without asking, since that's a
  credential change on their n8n instance.
- Network note from a prior session: on at least one network (an EPAM corporate
  network), plain `curl` to `https://n8n-recruiter.duckdns.org` over HTTPS gets blocked
  by a URL-category filter (SNI-based, blocks the `dynamic-dns` category), but Python's
  `urllib` (used by `scripts/inspect-n8n.py`) got through fine, and SSH (port 22, not a
  web-category protocol) should too. If HTTPS API calls hang or reset, this is probably
  why — try the Python script, and SSH, before assuming the VM is down.

## 3. Step-by-step

### 3.1 — Capture a rollback copy of the live nodes (do this FIRST, before any change)

Fetch the full live "Ingest Jobs" workflow and save the current `Code: LLM Router` and
`Code: Parse Ollama Response` nodes' full JSON to a **local, non-repo** scratch file (these
nodes contain live plaintext API keys — never write this to a file under the repo, never
commit it, never paste it into a PR or issue):

```bash
cd /Users/Darya_Shashko/Projects/recruiter
python3 -c "
import json, importlib.util
from pathlib import Path
spec = importlib.util.spec_from_file_location('inspect_n8n', 'scripts/inspect-n8n.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
ingest = next(w for w in m.fetch_workflows() if w.get('name') == 'Ingest Jobs')
out = Path.home() / '.n8n-rollback-backup.json'
out.write_text(json.dumps(ingest, indent=2))
print('workflow id:', ingest.get('id'))
print('saved to', out, '(chmod 600 it, keep it OFF the repo and off any paste tool)')
"
chmod 600 ~/.n8n-rollback-backup.json
```

Keep that file until you've confirmed the new setup works correctly in production for at
least one full real daily run (see 3.6). If anything goes wrong before then, you can
manually recreate the two nodes from this file via the n8n UI, or `PUT` the whole
workflow back via the API using the backed-up JSON.

### 3.2 — Extract the two provider API keys from the live node (needed for the new service's env)

From the same backup file (or a fresh fetch), pull the `GEMINI_API_KEY` and
`OPENROUTER_API_KEY` string literals out of the `Code: LLM Router` node's `jsCode`. Print
them straight into a file with restricted permissions — **do not print them to your own
terminal output/transcript, do not put them in any file under the repo**:

```bash
python3 -c "
import json, re
from pathlib import Path
data = json.loads(Path.home().joinpath('.n8n-rollback-backup.json').read_text())
code = next(n for n in data['nodes'] if n['name'] == 'Code: LLM Router')['parameters']['jsCode']
gemini = re.search(r\"GEMINI_API_KEY\s*=\s*'([^']+)'\", code).group(1)
openrouter = re.search(r\"OPENROUTER_API_KEY\s*=\s*'([^']+)'\", code).group(1)
out = Path.home() / '.evaluator.env'
out.write_text(f'''EVALUATOR_PORT=3100
OPENROUTER_API_KEY={openrouter}
OPENROUTER_MODEL=deepseek/deepseek-chat-v3-0324
LLM_API_KEY={gemini}
LLM_MODEL=gemini-2.5-flash
''')
print('wrote', out)
"
chmod 600 ~/.evaluator.env
```

(The model names/env var names above — `OPENROUTER_MODEL` without `:free`,
`LLM_MODEL=gemini-2.5-flash`, `LLM_API_KEY` not `GEMINI_API_KEY` — are deliberate, to
match the live node's actual behavior exactly. `LLM_API_KEY` is `GeminiAdapter`'s env var
name per ADR-16, not a typo.)

You'll copy `~/.evaluator.env` to the VM in 3.4 and then delete the local copy.

### 3.3 — Get the code onto the VM

```bash
ssh -i <key> ubuntu@92.5.81.123
# on the VM:
node --version   # if missing or < 20, you have two choices: install Node, or build in
                  # Docker instead (see 3.4 Option B) — Docker is already guaranteed
                  # present since n8n itself runs via docker-compose.
git --version
```

If `git` isn't set up for pulling this (private) repo on the VM, the simplest path is
usually: build a tarball of `n8n/` locally (excluding `node_modules`, `dist`) and `scp`
it over, rather than setting up deploy keys on the VM for a one-off. Use your judgment
based on what's already configured there.

### 3.4 — Build and run the service on the VM

**Option A — plain Node process (systemd), if Node 20+ is available on the host:**

```bash
# on the VM, after getting n8n/ onto e.g. /opt/ai-recruiter/n8n
cd /opt/ai-recruiter/n8n
npm ci
npm run build
```

Copy `~/.evaluator.env` (from 3.2) to `/opt/ai-recruiter/n8n/.env.evaluator` on the VM,
`chmod 600`, then delete the local copy on your machine.

Create `/etc/systemd/system/ai-recruiter-evaluator.service`:

```ini
[Unit]
Description=AI Recruiter LLM Evaluator Service
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/ai-recruiter/n8n
EnvironmentFile=/opt/ai-recruiter/n8n/.env.evaluator
ExecStart=/usr/bin/node dist/evaluator/server.js
Restart=on-failure
RestartSec=5
User=ubuntu

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now ai-recruiter-evaluator
sudo systemctl status ai-recruiter-evaluator
curl -s http://localhost:3100/healthz   # expect {"status":"ok"}
```

**Option B — as a 4th service in the existing `n8n/docker-compose.yml` on the VM (likely
the better fit, since everything else there is already Docker-managed):**

Add a `Dockerfile` next to the checked-out `n8n/` sources on the VM:

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY evaluator ./evaluator
COPY providers ./providers
RUN npm ci && npm run build
CMD ["node", "dist/evaluator/server.js"]
```

Add a service to the VM's `docker-compose.yml` (same compose project n8n/postgres/caddy
are already in, so they share a network and n8n can reach it by service name):

```yaml
  evaluator:
    build: ./evaluator-src   # path to wherever you put the Dockerfile + n8n/ sources
    restart: unless-stopped
    env_file:
      - .env.evaluator
    expose:
      - "3100"
```

```bash
docker compose up -d --build evaluator
docker compose logs evaluator   # confirm "[evaluator] listening on :3100"
docker compose exec n8n wget -qO- http://evaluator:3100/healthz   # confirm n8n can reach it
```

Pick whichever option matches what's actually easiest given the VM's real state —
check what's there before deciding, don't assume.

### 3.5 — Test the service for real, from the VM, BEFORE touching the live workflow

Use a real system prompt / user message (you can grab one from the live
`Code: Build Ollama Payload` node's output the same way you fetched the backup in 3.1, or
just construct a short realistic one by hand) and confirm you get a real scored
response back, not just a 502:

```bash
curl -s -X POST http://localhost:3100/evaluate \
  -H "Content-Type: application/json" \
  -d '{"systemPrompt":"...","userMessage":"...","outputSchema":{"type":"object","properties":{"overall_score":{"type":"integer"},"tech_stack_match":{"type":"integer"},"seniority_match":{"type":"integer"},"red_flags":{"type":"array","items":{"type":"string"}},"reason":{"type":"string"},"url":{"type":"string"}},"required":["overall_score","tech_stack_match","seniority_match","red_flags","reason","url"]},"job":{"id":"smoke-test","url":"https://example.com/smoke-test","location":"Gdańsk"}}'
```

Expect HTTP 200 and a JSON body with `overall_score`, `match`, etc. If you get a 502,
read the aggregated error — it'll name which provider failed and why (likely a bad key
or wrong model name) before you go any further.

### 3.6 — Rewire the live n8n workflow (the actual production change)

In the n8n UI (or via the API, if you're confident doing this without the UI's visual
diff/undo):

1. Add an **HTTP Request** node where `Code: LLM Router` currently sits:
   - URL: `http://evaluator:3100/evaluate` (Docker option) or `http://localhost:3100/evaluate`
     (systemd option, if evaluator and n8n run on the same host network)
   - Method: POST
   - Body (JSON), built from the current item's fields (which already has
     `systemPrompt`, `userMessage`, and every job field spread in, per
     `Code: Build Ollama Payload`'s existing output):
     ```json
     {
       "systemPrompt": "={{ $json.systemPrompt }}",
       "userMessage": "={{ $json.userMessage }}",
       "outputSchema": { "type": "object", "properties": { "overall_score": {"type":"integer"}, "tech_stack_match": {"type":"integer"}, "seniority_match": {"type":"integer"}, "red_flags": {"type":"array","items":{"type":"string"}}, "reason": {"type":"string"}, "url": {"type":"string"} }, "required": ["overall_score","tech_stack_match","seniority_match","red_flags","reason","url"] },
       "job": {
         "id": "={{ $json.id }}", "title": "={{ $json.title }}", "company": "={{ $json.company }}",
         "url": "={{ $json.url }}", "source": "={{ $json.source }}", "location": "={{ $json.location }}",
         "salary": "={{ $json.salary }}", "body": "={{ $json.body }}", "scrapedAt": "={{ $json.scrapedAt }}",
         "fingerprint": "={{ $json.fingerprint }}"
       }
     }
     ```
2. Connect `Code: Build Ollama Payload` → this new HTTP Request node.
3. Connect the new HTTP Request node's output **directly** to `Notion: Log to Eval Log`
   (the node that `Code: Parse Ollama Response` used to feed) — the service's response
   body is already shaped exactly like `Code: Parse Ollama Response`'s old output
   (`id, title, company, url, source, location, salary, scrapedAt, fingerprint,
   overall_score, tech_stack_match, seniority_match, red_flags, reason, match`), so
   nothing downstream (`Code: Restore Job Payload`, the score IFs, Notion/Telegram
   nodes) needs to change.
4. Delete `Code: LLM Router` and `Code: Parse Ollama Response`.
5. Save, but don't consider yourself done — go to 3.7 before trusting this.

### 3.7 — Verify end-to-end with a manual test, not the next daily cron

Send one synthetic job through the real webhook (shape must match `WebhookPayload` in
`scraper/src/types.ts`: `{ jobs: [...], meta: { source, count, sentAt } }`) and watch
n8n's execution log for that run, plus check the Notion Eval Log DB and (if the score
would hit >=80) Telegram. Only once this looks right should you consider the live
pipeline safe for its next scheduled run.

### 3.8 — Required follow-up (do not skip — this prevents false alarms)

`scripts/check-n8n-drift.py` + `.github/workflows/n8n-drift-check.yml` (added earlier,
ADR-019) check for a node literally named `Code: LLM Router` with a `jsCode` parameter.
After this migration that node won't exist in that form anymore, so **the daily drift
check will start failing and spamming a Telegram alert every day** unless you update it.
Either:
- retire `n8n-drift-check.yml` and the two drift-check scripts with a note in
  `context/decisions.yaml` explaining why (the risk they guarded against moved out of
  n8n), or
- repoint them at a new, meaningful check — e.g. the evaluator service's own
  `/healthz`, or that the new HTTP Request node's URL still points at the right host.

Also update, once this is live and confirmed working:
- `context/decisions.yaml` ADR-019 — mark the HTTP wiring as actually deployed (date).
- `context/ingest-workflow.yaml` flow section — replace the `Code: LLM Router` /
  `Code: Parse Ollama Response` entries with the new HTTP Request node.
- `context/modules/n8n.yaml` `evaluator_service.status` — update from
  "built, not deployed" to deployed, with the VM path and how it's run (systemd vs
  Docker — whichever you picked).

### 3.9 — Clean up secrets you touched

Delete `~/.n8n-rollback-backup.json` and `~/.evaluator.env` from your local machine once
you've copied the latter to the VM and confirmed the deploy works (keep the VM-side copy;
delete the local one). Don't leave plaintext API keys sitting in your home directory
longer than necessary.

## 4. Hard constraints — do not violate these

- Never commit the rollback backup, the `.env.evaluator` file, or any raw API key to the
  repo, a PR description, an issue, or this plan file.
- Never print the key values into your own chat output/transcript.
- Don't delete the two old n8n Code nodes until 3.7's manual test has actually passed.
- Don't skip 3.8 — an unmonitored, now-meaningless drift check will cry wolf daily.
- If anything about the VM's actual state contradicts an assumption in this plan (no
  Docker, no git, SSH blocked, different directory layout than expected), stop and
  figure out the real state rather than forcing the plan's exact commands to work.
