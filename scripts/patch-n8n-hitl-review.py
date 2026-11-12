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

    # Ensure Code: Parse Ollama Response forwards company_dossier & companyMeta
    for node in nodes:
        name = node.get("name", "")
        if name == "Code: Parse Ollama Response":
            params = node.setdefault("parameters", {})
            js_code = params.get("jsCode", "")
            # Ensure company_dossier and companyMeta are returned
            if "company_dossier" not in js_code or "companyMeta" not in js_code:
                print("Updating Code: Parse Ollama Response to forward company_dossier and companyMeta...")
                # Insert company_dossier and companyMeta into return object if needed
                js_code = js_code.replace(
                    "reason: parsed.reason",
                    "reason: parsed.reason,\n      company_dossier: parsed.company_dossier || undefined,\n      companyMeta: job.companyMeta || undefined,\n      companyUrl: (job.companyMeta && job.companyMeta.companyUrl) || job.companyUrl || undefined"
                )
                js_code = js_code.replace(
                    "reason: reason",
                    "reason: reason,\n      company_dossier: undefined,\n      companyMeta: job.companyMeta || undefined,\n      companyUrl: (job.companyMeta && job.companyMeta.companyUrl) || job.companyUrl || undefined"
                )
                params["jsCode"] = js_code
                patched_count += 1
                print("✅ Patched Code: Parse Ollama Response")

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
  (() => {
    const item = $('Code: Parse Ollama Response').item.json;
    const comp = item.company || '';
    const dossier = (item.company_dossier && item.company_dossier.trim()) ? item.company_dossier.trim() : 'Информация о компании уточняется.';
    const cUrl = (item.companyMeta && item.companyMeta.companyUrl) || item.companyUrl;
    const compLink = cUrl ? `[🌐 Сайт компании](${cUrl})` : `[🔍 Найти в Google](https://www.google.com/search?q=${encodeURIComponent(comp + ' software')})`;

    const text = `🔥 *${item.title || ''}* (Score: ${item.overall_score || 0})\\n🏢 ${comp}\\n💰 ${item.salary || 'не указана'}\\n📍 ${item.location || 'не указано'} | ${item.source || ''}\\n🔗 ${item.url || ''}\\n\\n🏢 *О компании:*\\n${dossier}\\n${compLink}\\n\\n_${item.reason || ''}_`;

    return JSON.stringify({
      chat_id: "-1004357080568",
      message_thread_id: 2,
      text: text,
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
              url: item.url
            },
            {
              text: "👎 В архив",
              callback_data: "rej:" + ($json.id || "").replace(/[^a-fA-F0-9]/g, "").toLowerCase()
            }
          ]
        ]
      }
    });
  })()
}}"""
            patched_count += 1
            print("✅ Configured Telegram: Send Alert with Topic 2 Hot Match keyboard and company dossier block")

        elif name == "Telegram: Send Review Alert":
            params = node.setdefault("parameters", {})
            params["method"] = "POST"
            params["url"] = "=https://api.telegram.org/bot{{ $env.TELEGRAM_BOT_TOKEN }}/sendMessage"
            params["sendBody"] = True
            params["specifyBody"] = "json"
            params["jsonBody"] = """={{
  (() => {
    const item = $('Code: Parse Ollama Response').item.json;
    const comp = item.company || '';
    const dossier = (item.company_dossier && item.company_dossier.trim()) ? item.company_dossier.trim() : 'Информация о компании уточняется.';
    const cUrl = (item.companyMeta && item.companyMeta.companyUrl) || item.companyUrl;
    const compLink = cUrl ? `[🌐 Сайт компании](${cUrl})` : `[🔍 Найти в Google](https://www.google.com/search?q=${encodeURIComponent(comp + ' software')})`;
    const flags = (item.red_flags || []).join(', ') || 'нет';

    const text = `📋 *${item.title || ''}* (Score: ${item.overall_score || 0})\\n🏢 ${comp}\\n💰 ${item.salary || 'не указана'}\\n📍 ${item.location || 'не указано'} | ${item.source || ''}\\n🔗 ${item.url || ''}\\n\\n🏢 *О компании:*\\n${dossier}\\n${compLink}\\n\\n📝 *Вердикт:* _${item.reason || ''}_\\n\\n⚠️ *Red Flags:* ${flags}`;

    return JSON.stringify({
      chat_id: "-1004357080568",
      message_thread_id: 3,
      text: text,
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
              url: item.url
            }
          ]
        ]
      }
    });
  })()
}}"""
            patched_count += 1
            print("✅ Configured Telegram: Send Review Alert with Topic 3 Review keyboard and company dossier block")

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
