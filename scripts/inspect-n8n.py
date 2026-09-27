#!/usr/bin/env python3
"""Print a short, secret-free summary of the n8n workflows that actually run.

Reads workflows from the n8n public API (default) or from exported JSON files, and
prints only the facts the context notes depend on: which LLM Router version is
deployed, Gemini model names, timeouts, Telegram triggers, and active flags.
It never prints credentials, API keys, or workflow/node IDs.

Usage:
  scripts/inspect-n8n.py                  # API; key from $N8N_API_KEY or ~/.n8n-recruiter-key
  scripts/inspect-n8n.py FILE.json ...    # local exports instead of the API
Env: N8N_BASE_URL (default https://n8n-recruiter.duckdns.org)
"""

import json
import os
import re
import sys
import urllib.request
from pathlib import Path

BASE_URL = os.environ.get("N8N_BASE_URL", "https://n8n-recruiter.duckdns.org").rstrip("/")
KEY_FILE = Path.home() / ".n8n-recruiter-key"


def api_key():
    key = os.environ.get("N8N_API_KEY", "").strip()
    if not key and KEY_FILE.exists():
        key = KEY_FILE.read_text().strip()
    if not key:
        sys.exit(f"No API key: set N8N_API_KEY or create {KEY_FILE} (chmod 600).")
    return key


def fetch_workflows():
    key, cursor, out = api_key(), None, []
    while True:
        url = f"{BASE_URL}/api/v1/workflows?limit=100" + (f"&cursor={cursor}" if cursor else "")
        req = urllib.request.Request(url, headers={"X-N8N-API-KEY": key, "Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            page = json.load(resp)
        out.extend(page.get("data", []))
        cursor = page.get("nextCursor")
        if not cursor:
            return out


def load_files(paths):
    out = []
    for p in paths:
        data = json.loads(Path(p).read_text(encoding="utf-8"))
        out.extend(data if isinstance(data, list) else [data])
    return out


def router_summary(code):
    facts = []
    if "$env.LLM_PROVIDER" in code:
        facts.append("version=p12_6 ($env.LLM_PROVIDER)")
    m = re.search(r"const\s+provider\s*=\s*'([a-z]+)'", code)
    if m:
        facts.append(f"version=CLOUD-11-A (hardcoded provider={m.group(1)})")
    facts.append("http=" + ("httpRequest" if "this.helpers.httpRequest" in code else "fetch" if "fetch(" in code else "?"))
    timeouts = sorted({n for line in code.splitlines() if re.search(r"timeout", line, re.I)
                       and not line.strip().startswith("//") for n in re.findall(r"\b\d{4,6}\b", line)})
    facts.append("timeouts_ms=" + (",".join(timeouts) if timeouts else "none"))
    if "PASTE_YOUR_GEMINI_API_KEY_HERE" in code:
        facts.append("apiKey=placeholder")
    elif re.search(r"const\s+apiKey\s*=\s*'[^']+'", code):
        facts.append("apiKey=literal in code (value not shown)")
    return ", ".join(facts)


def main():
    workflows = load_files(sys.argv[1:]) if sys.argv[1:] else fetch_workflows()
    print(f"source: {'files' if sys.argv[1:] else BASE_URL}; workflows: {len(workflows)}")
    for wf in sorted(workflows, key=lambda w: w.get("name", "")):
        nodes = wf.get("nodes", [])
        types = [n.get("type", "") for n in nodes]
        text = json.dumps(nodes)
        tg = sum(t.endswith("telegramTrigger") for t in types)
        print(f"- {wf.get('name', '?')}: active={wf.get('active')}, nodes={len(nodes)}"
              + (f", telegramTrigger={tg}" if tg else "")
              + (f", wait={types.count('n8n-nodes-base.wait')}" if "n8n-nodes-base.wait" in types else ""))
        models = sorted(set(re.findall(r"gemini-[0-9][\w.-]*", text)))
        if models:
            print(f"    gemini models: {', '.join(models)}")
        for n in nodes:
            if n.get("name") == "Code: LLM Router":
                print(f"    LLM Router: {router_summary(n.get('parameters', {}).get('jsCode', ''))}")


if __name__ == "__main__":
    main()
