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


def build_parse_ollama_code():
    dist_scoring = Path(__file__).resolve().parent.parent / "n8n" / "dist" / "evaluator" / "scoring.js"
    if not dist_scoring.exists():
        sys.exit(f"Compiled scoring.js not found at {dist_scoring}. Run 'cd n8n && npm run build' first.")
    scoring_code = dist_scoring.read_text(encoding="utf-8")

    header = """const ollamaResp = $input.first().json;
const job = $('Code: Build Ollama Payload').first().json;

const fallback = (reason) => ({
  json: {
    id: job.id, title: job.title, company: job.company,
    url: job.url, source: job.source, location: job.location,
    salary: job.salary, tags: job.tags, scrapedAt: job.scrapedAt,
    fingerprint: job.fingerprint || '',
    overall_score: 0, tech_stack_match: 0, seniority_match: 0,
    red_flags: [reason.toLowerCase().includes('ollama') ? 'Pipeline: LLM Error' : 'Pipeline: Parse Error'],
    reason: `Error: ${reason}`,
    match: false
  }
});

if (ollamaResp?.error) {
  if (job.profileError) {
    const failClosed = fallback('Notion profile unavailable');
    failClosed.json.red_flags = ['Pipeline: Notion Error'];
    failClosed.json.model = 'notion-profile';
    return [failClosed];
  }
  return [fallback(`LLM Router error: ${JSON.stringify(ollamaResp.error).slice(0, 180)}`)];
}

const raw = ollamaResp?.message?.content || '';
if (!raw) return [fallback('Empty LLM response')];

var exports = typeof exports !== 'undefined' ? exports : {};
"""

    footer = """
const evaluation = exports.evaluateJob(raw, {
  id: job.id || '', title: job.title, company: job.company, url: job.url || '',
  source: job.source, location: job.location, salary: job.salary,
  body: job.body, scrapedAt: job.scrapedAt, fingerprint: job.fingerprint || '',
  companyMeta: job.companyMeta
}, job.scoringConfig);

return [{
  json: {
    ...evaluation,
    tags: job.tags,
    model: ollamaResp?.provider || 'gemini:gemini-2.5-flash-lite'
  }
}];
"""
    return header + scoring_code + footer


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

    # Ensure Code: Parse Ollama Response has full compiled scoring logic
    for node in nodes:
        name = node.get("name", "")
        if name == "Code: Parse Ollama Response":
            params = node.setdefault("parameters", {})
            params["jsCode"] = build_parse_ollama_code()
            patched_count += 1
            print("✅ Embedded latest compiled scoring logic into Code: Parse Ollama Response")

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
    const dossier = (item.company_dossier && item.company_dossier.trim() && !item.company_dossier.toLowerCase().includes('уточняется')) ? item.company_dossier.trim() : 'Не знаю';
    const cUrl = (item.companyMeta && item.companyMeta.companyUrl) || item.companyUrl;
    const compLink = cUrl ? `[🌐 Сайт компании](${cUrl})` : `[🔍 Найти в Google](https://www.google.com/search?q=${encodeURIComponent(comp + ' software')})`;

    const text = [
      `🔥 *[Горячий мэтч] ${item.title || ''}* @ *${comp}*`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `💵 *${item.salary || 'Зарплата не указана'}*`,
      `📍 *${item.location || 'Локация не указана'}* | 🌐 ${item.source || ''}`,
      ``,
      `📦 *Проект и домен:*`,
      `• ${dossier}`,
      compLink,
      ``,
      `🎯 *Мэтч:* ${item.overall_score || 0}/100 (Стек: ${item.tech_stack_match ?? '-'}, Сеньорность: ${item.seniority_match ?? '-'})`,
      `💡 _${item.reason || ''}_`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
    ].join('\\n');

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
            print("✅ Configured Telegram: Send Alert with compact mobile card and Hot Match keyboard")

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
    const dossier = (item.company_dossier && item.company_dossier.trim() && !item.company_dossier.toLowerCase().includes('уточняется')) ? item.company_dossier.trim() : 'Не знаю';
    const cUrl = (item.companyMeta && item.companyMeta.companyUrl) || item.companyUrl;
    const compLink = cUrl ? `[🌐 Сайт компании](${cUrl})` : `[🔍 Найти в Google](https://www.google.com/search?q=${encodeURIComponent(comp + ' software')})`;
    const flags = (item.red_flags || []).join(', ') || 'нет';

    const text = [
      `👀 *[На ревью] ${item.title || ''}* @ *${comp}*`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `💵 *${item.salary || 'Зарплата не указана'}*`,
      `📍 *${item.location || 'Локация не указана'}* | 🌐 ${item.source || ''}`,
      ``,
      `📦 *Проект и домен:*`,
      `• ${dossier}`,
      compLink,
      ``,
      `🎯 *Мэтч:* ${item.overall_score || 0}/100 (Стек: ${item.tech_stack_match ?? '-'}, Сеньорность: ${item.seniority_match ?? '-'})`,
      `💡 _${item.reason || ''}_`,
      flags !== 'нет' ? `⚠️ *Red Flags:* ${flags}` : '',
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
    ].filter(Boolean).join('\\n');

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
            print("✅ Configured Telegram: Send Review Alert with compact mobile card and Review keyboard")

        elif name == "Code: Prepare Digest":
            params = node.setdefault("parameters", {})
            params["jsCode"] = """let totalReceived = 0;
try {
  totalReceived = $('Code: Normalize Jobs').all().length;
} catch (e) {}

let uniqueAfterBatchDedup = 0;
try {
  uniqueAfterBatchDedup = $('Code: Dedup Batch').all().length;
} catch (e) {}
const batchDuplicates = Math.max(0, totalReceived - uniqueAfterBatchDedup);

let duplicatesCount = 0;
let dupRun = 0;
while (true) {
  try {
    const items = $('Code: Check Duplicate').all(0, dupRun);
    if (!items || items.length === 0) break;
    for (const item of items) {
      if (item && item.json && item.json.isDuplicate === true) duplicatesCount++;
    }
    dupRun++;
  } catch (e) {
    break;
  }
}

let evaluatedJobs = [];
let evalRun = 0;
while (true) {
  try {
    const items = $('Code: Parse Ollama Response').all(0, evalRun);
    if (!items || items.length === 0) break;
    for (const item of items) {
      if (item && item.json) evaluatedJobs.push(item.json);
    }
    evalRun++;
  } catch (e) {
    break;
  }
}

const hotMatches = evaluatedJobs.filter(j => (j.overall_score || 0) >= 80);
const reviews = evaluatedJobs.filter(j => (j.overall_score || 0) >= 50 && (j.overall_score || 0) < 80);
const rejected = evaluatedJobs.filter(j => (j.overall_score || 0) < 50);

const dateStr = new Date().toLocaleDateString('ru-RU', { timeZone: 'Europe/Warsaw' });
const timeStr = new Date().toLocaleTimeString('ru-RU', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit' });

const text = `🏁 *AI Recruiter — Дайджест прогона*
📅 _${dateStr} ${timeStr}_
───────────────────────────
📥 *Получено от скрейпера:* ${totalReceived}
👥 *Дубликаты в прогоне (кросс-постинг):* ${batchDuplicates}
♻️ *Дубликаты в базе Notion:* ${duplicatesCount}
🤖 *Оценено нейросетью:* ${evaluatedJobs.length}
───────────────────────────
🔥 *Горячие (Score >= 80):* ${hotMatches.length}
👉 _отправлены в тему «Горячий мэтч»_

📋 *На ревью (Score 50–79):* ${reviews.length}
👉 _отправлены в тему «На ревью»_

❌ *Отклонено (Score < 50):* ${rejected.length}
───────────────────────────
${reviews.length > 0 ? `💡 *Внимание:* в теме «На ревью» вас ждут ${reviews.length} вакансий для проверки!` : `✨ Все подходящие вакансии разобраны!`}`;

return [{
  json: {
    totalReceived,
    batchDuplicates,
    duplicatesCount,
    evaluatedCount: evaluatedJobs.length,
    hotCount: hotMatches.length,
    reviewCount: reviews.length,
    rejectedCount: rejected.length,
    digestText: text
  }
}];"""
            patched_count += 1
            print("✅ Configured Code: Prepare Digest with batchDuplicates / cross-posting breakdown")

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
