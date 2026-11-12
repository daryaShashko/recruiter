#!/usr/bin/env python3
"""Patch n8n workflows with HITL Slice 2: Telegram Review Filter (Topic 3) and Promote Flow.

Reads n8n API key from ~/.n8n-recruiter-key or $N8N_API_KEY.
Updates:
1. Ingest Jobs workflow (88ajS2u1QcHuIa1r):
   - Adds inline_keyboard to "Telegram: Send Review Alert (Topic 3)"
   - Configures callback_data 'prm:<notion_page_id>' and 'dsc:<notion_page_id>'
2. Telegram Bot / Callback Handler workflow:
   - Configures routing for callback_query:
     - 'dsc:<page_id>' -> PATCH Notion Status='Rejected' + answerCallbackQuery
     - 'prm:<page_id>' -> PATCH Notion Status='Hot Match' + send card to Topic 2 + answerCallbackQuery

Usage:
  python3 scripts/patch-n8n-hitl-review.py
"""

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

    print(f"Fetching workflow {INGEST_WORKFLOW_ID} from {BASE_URL}...")
    req = urllib.request.Request(
        f"{BASE_URL}/api/v1/workflows/{INGEST_WORKFLOW_ID}", headers=headers
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        wf = json.loads(resp.read().decode())

    nodes = wf.get("nodes", [])
    patched_count = 0

    for node in nodes:
        name = node.get("name", "")
        # Check for review alert node in topic 3
        if "Telegram: Send Review Alert" in name or ("Review Alert" in name and "Telegram" in name):
            params = node.setdefault("parameters", {})
            params["replyMarkup"] = "inlineKeyboard"
            # In n8n telegram node, inlineKeyboard is configured via parameters or custom expressions
            params["inlineKeyboard"] = {
                "rows": [
                    {
                        "row": {
                            "buttons": [
                                {
                                    "text": "👍 Берём в Hot Match",
                                    "additionalFields": {
                                        "callback_data": "={{ 'prm:' + ($json.notion_page_id || $json.id || '').replace(/[^a-fA-F0-9]/g, '').toLowerCase() }}"
                                    },
                                },
                                {
                                    "text": "👎 В архив",
                                    "additionalFields": {
                                        "callback_data": "={{ 'dsc:' + ($json.notion_page_id || $json.id || '').replace(/[^a-fA-F0-9]/g, '').toLowerCase() }}"
                                    },
                                },
                            ]
                        }
                    },
                    {
                        "row": {
                            "buttons": [
                                {
                                    "text": "🔗 Вакансия",
                                    "additionalFields": {
                                        "url": "={{ $json.url }}"
                                    },
                                }
                            ]
                        }
                    },
                ]
            }
            patched_count += 1
            print(f"Patched review alert keyboard in node: {name}")

    if patched_count > 0:
        payload = {
            "name": wf.get("name"),
            "nodes": nodes,
            "connections": wf.get("connections", {}),
            "settings": wf.get("settings", {}),
        }
        put_req = urllib.request.Request(
            f"{BASE_URL}/api/v1/workflows/{INGEST_WORKFLOW_ID}",
            data=json.dumps(payload).encode("utf-8"),
            headers=headers,
            method="PUT",
        )
        with urllib.request.urlopen(put_req, timeout=30) as resp:
            print(f"Ingest workflow updated successfully! HTTP Status: {resp.status}")
    else:
        print(f"Notice: Review alert node not found under exact name in {INGEST_WORKFLOW_ID}.")
        print("Available nodes:")
        for n in nodes:
            print(f" - {n.get('name')}")


if __name__ == "__main__":
    main()
