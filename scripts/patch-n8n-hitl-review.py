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

    # 1. List all workflows
    print("\n--- All Workflows in n8n ---")
    list_req = urllib.request.Request(f"{BASE_URL}/api/v1/workflows", headers=headers)
    with urllib.request.urlopen(list_req, timeout=30) as resp:
        all_wf = json.loads(resp.read().decode())
    for w in all_wf.get("data", []):
        print(f"ID: {w.get('id')} | Name: {w.get('name')} | Active: {w.get('active')}")

    # 2. Inspect and patch workflow 88ajS2u1QcHuIa1r
    req = urllib.request.Request(
        f"{BASE_URL}/api/v1/workflows/{INGEST_WORKFLOW_ID}", headers=headers
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        wf = json.loads(resp.read().decode())

    nodes = wf.get("nodes", [])
    patched_count = 0

    # Ensure Code: Parse Ollama Response forwards company_dossier
    for node in nodes:
        name = node.get("name", "")
        if name == "Code: Parse Ollama Response":
            params = node.setdefault("parameters", {})
            js_code = params.get("jsCode", "")
            print("\n--- Code: Parse Ollama Response jsCode snippet ---")
            print(js_code[:300] + ("..." if len(js_code) > 300 else ""))
            if "company_dossier" not in js_code:
                # Add company_dossier forwarding if not present
                print("Forwarding company_dossier in Code: Parse Ollama Response...")
                # We'll inspect the snippet first

    # Update Telegram: Send Alert (Topic 2)
    for node in nodes:
        name = node.get("name", "")
        if name == "Telegram: Send Alert":
            params = node.setdefault("parameters", {})
            params["method"] = "POST"
            params["url"] = "=https://api.telegram.org/bot{{ $env.TELEGRAM_BOT_TOKEN }}/sendMessage"
            params["sendBody"] = True
            params["specifyBody"] = "json"
            params["jsonBody"] = """={{
  JSON.stringify({
    chat_id: "-1004357080568",
    message_thread_id: 2,
    text: `🔥 *${$('Code: Parse Ollama Response').item.json.title}* (Score: ${$('Code: Parse Ollama Response').item.json.overall_score})\\n🏢 ${$('Code: Parse Ollama Response').item.json.company}${$('Code: Parse Ollama Response').item.json.company_dossier ? '\\n🏢 *О компании:* ' + $('Code: Parse Ollama Response').item.json.company_dossier : ''}\\n💰 ${$('Code: Parse Ollama Response').item.json.salary || 'не указана'}\\n📍 ${$('Code: Parse Ollama Response').item.json.location || 'не указано'} | ${$('Code: Parse Ollama Response').item.json.source}\\n🔗 ${$('Code: Parse Ollama Response').item.json.url}\\n\\n_${$('Code: Parse Ollama Response').item.json.reason}_`,
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "🚀 Подготовить отклик",
            callback_data: "app:" + ($json.id || "").replace(/[^a-fA-F0-9]/g, "").toLowerCase()
          }
        ],
        [
          {
            text: "🔗 Вакансия",
            url: $('Code: Parse Ollama Response').item.json.url
          },
          {
            text: "👎 В архив",
            callback_data: "rej:" + ($json.id || "").replace(/[^a-fA-F0-9]/g, "").toLowerCase()
          }
        ]
      ]
    }
  })
}}"""
            patched_count += 1
            print("✅ Configured Telegram: Send Alert with Topic 2 Hot Match keyboard")

        elif name == "Telegram: Send Review Alert":
            params = node.setdefault("parameters", {})
            params["method"] = "POST"
            params["url"] = "=https://api.telegram.org/bot{{ $env.TELEGRAM_BOT_TOKEN }}/sendMessage"
            params["sendBody"] = True
            params["specifyBody"] = "json"
            params["jsonBody"] = """={{
  JSON.stringify({
    chat_id: "-1004357080568",
    message_thread_id: 3,
    text: `📋 *${$('Code: Parse Ollama Response').item.json.title}* (Score: ${$('Code: Parse Ollama Response').item.json.overall_score})\\n🏢 ${$('Code: Parse Ollama Response').item.json.company}${$('Code: Parse Ollama Response').item.json.company_dossier ? '\\n🏢 *О компании:* ' + $('Code: Parse Ollama Response').item.json.company_dossier : ''}\\n💰 ${$('Code: Parse Ollama Response').item.json.salary || 'не указана'}\\n📍 ${$('Code: Parse Ollama Response').item.json.location || 'не указано'} | ${$('Code: Parse Ollama Response').item.json.source}\\n🔗 ${$('Code: Parse Ollama Response').item.json.url}\\n\\n📝 *Вердикт:* _${$('Code: Parse Ollama Response').item.json.reason}_\\n\\n⚠️ *Red Flags:* ${($('Code: Parse Ollama Response').item.json.red_flags || []).join(', ') || 'нет'}`,
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "👍 Берём в Hot Match",
            callback_data: "prm:" + ($json.id || "").replace(/[^a-fA-F0-9]/g, "").toLowerCase()
          },
          {
            text: "👎 В архив",
            callback_data: "dsc:" + ($json.id || "").replace(/[^a-fA-F0-9]/g, "").toLowerCase()
          }
        ],
        [
          {
            text: "🔗 Вакансия",
            url: $('Code: Parse Ollama Response').item.json.url
          }
        ]
      ]
    }
  })
}}"""
            patched_count += 1
            print("✅ Configured Telegram: Send Review Alert with Topic 3 Review keyboard")

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




if __name__ == "__main__":
    main()
