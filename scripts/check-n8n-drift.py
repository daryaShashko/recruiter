#!/usr/bin/env python3
"""Fail if the live n8n "Code: LLM Router" node drifts from the committed baseline.

Why this exists: the Router node's code only ever lived inline in n8n's UI, with two
separate hand-maintained patch scripts (p12_6_llm_router.py, patch_llm_router.py) that
each generated a different version of it. By 2026-09-27 the live node matched neither
script. This check closes that gap by comparing the live node's summary (via
inspect-n8n.py's own fetch/summary logic — not a second copy of it) against a committed
baseline on every run, instead of relying on someone remembering to check by hand.

Usage: scripts/check-n8n-drift.py
Env: N8N_BASE_URL, N8N_API_KEY (same as inspect-n8n.py)
"""

import importlib.util
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
BASELINE_FILE = SCRIPT_DIR / "n8n-router-baseline.txt"

spec = importlib.util.spec_from_file_location("inspect_n8n", SCRIPT_DIR / "inspect-n8n.py")
inspect_n8n = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inspect_n8n)


def main():
    workflows = inspect_n8n.fetch_workflows()
    ingest = next((w for w in workflows if w.get("name") == "Ingest Jobs"), None)
    if ingest is None:
        sys.exit("FAIL: no 'Ingest Jobs' workflow found via the n8n API.")

    router_node = next(
        (n for n in ingest.get("nodes", []) if n.get("name") == "Code: LLM Router"), None
    )
    if router_node is None:
        sys.exit("FAIL: 'Code: LLM Router' node not found in 'Ingest Jobs'.")

    current = inspect_n8n.router_summary(router_node.get("parameters", {}).get("jsCode", ""))
    baseline = BASELINE_FILE.read_text(encoding="utf-8").strip()

    if current.strip() != baseline:
        print("FAIL: live 'Code: LLM Router' no longer matches the committed baseline.")
        print(f"  baseline: {baseline}")
        print(f"  live:     {current}")
        print(
            "If this is an intentional change, update scripts/n8n-router-baseline.txt "
            "and context/decisions.yaml / context/ingest-workflow.yaml to match."
        )
        sys.exit(1)

    print(f"OK: live Router matches baseline ({current})")


if __name__ == "__main__":
    main()
