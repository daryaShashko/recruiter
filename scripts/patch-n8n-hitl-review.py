#!/usr/bin/env python3
"""Patch n8n workflows with complete HITL Telegram Keyboards (Topic 2 Hot Match and Topic 3 Review).

Reads n8n API key from ~/.n8n-recruiter-key or $N8N_API_KEY.
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
    print(f"Total nodes in workflow: {len(nodes)}")
    patched_count = 0

    for node in nodes:
        name = node.get("name", "")
        ntype = node.get("type", "")

        # 1. Topic 3: Review Alert
        if "Review Alert" in name or ("Review" in name and "Telegram" in name):
            params = node.setdefault("parameters", {})
            params["replyMarkup"] = "inlineKeyboard"
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
            print(f"✅ Patched Topic 3 Review keyboard in node: {name}")

        # 2. Topic 2: Hot Match Alert
        elif "Telegram: Send Alert" in name or ("Hot Match" in name and "Telegram" in name) or (name == "Telegram: Send Alert"):
            params = node.setdefault("parameters", {})
            params["replyMarkup"] = "inlineKeyboard"
            params["inlineKeyboard"] = {
                "rows": [
                    {
                        "row": {
                            "buttons": [
                                {
                                    "text": "🚀 Подготовить отклик",
                                    "additionalFields": {
                                        "callback_data": "={{ 'app:' + ($json.notion_page_id || $json.id || '').replace(/[^a-fA-F0-9]/g, '').toLowerCase() }}"
                                    },
                                }
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
                                },
                                {
                                    "text": "👎 В архив",
                                    "additionalFields": {
                                        "callback_data": "={{ 'rej:' + ($json.notion_page_id || $json.id || '').replace(/[^a-fA-F0-9]/g, '').toLowerCase() }}"
                                    },
                                },
                            ]
                        }
                    },
                ]
            }
            patched_count += 1
            print(f"✅ Patched Topic 2 Hot Match keyboard in node: {name}")

    print("\nAll workflow nodes:")
    for n in nodes:
        print(f" - {n.get('name')} ({n.get('type')})")

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
            print(f"\n🎉 Workflow {INGEST_WORKFLOW_ID} successfully updated! HTTP Status: {resp.status}")
    else:
        print("\n⚠️ No Telegram alert nodes matched the expected patterns.")


if __name__ == "__main__":
    main()
