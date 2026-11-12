#!/usr/bin/env python3
"""Inspect and configure Telegram HTTP Request nodes in n8n workflow."""

import json
import os
import sys
import urllib.request
from pathlib import Path

BASE_URL = os.environ.get("N8N_BASE_URL", "https://n8n-recruiter.duckdns.org").rstrip("/")
KEY_FILE = Path.home() / ".n8n-recruiter-key"
INGEST_WORKFLOW_ID = os.environ.get("INGEST_WORKFLOW_ID", "88ajS2u1QcHuIa1r")


def get_api_key():
    key = os.environ.get("N8N_API_KEY", "").strip()
    if not key and KEY_FILE.exists():
        key = KEY_FILE.read_text().strip()
    if not key:
        sys.exit(f"No API key: set N8N_API_KEY or create {KEY_FILE}")
    return key


def main():
    api_key = get_api_key()
    headers = {
        "X-N8N-API-KEY": api_key,
        "Content-Type": "application/json",
        "Accept": "application/json",
    }

    req = urllib.request.Request(
        f"{BASE_URL}/api/v1/workflows/{INGEST_WORKFLOW_ID}", headers=headers
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        wf = json.loads(resp.read().decode())

    nodes = wf.get("nodes", [])

    print("CONNECTIONS TO TELEGRAM NODES:")
    connections = wf.get("connections", {})
    for src, targets in connections.items():
        for target_type, target_conns in targets.items():
            for conn_group in target_conns:
                for c in conn_group:
                    node_name = c.get("node", "")
                    if "Telegram" in node_name:
                        print(f"{src} -> {node_name}")



if __name__ == "__main__":
    main()
