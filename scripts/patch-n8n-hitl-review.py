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


def build_normalize_jobs_code():
    return r"""// Node: Code: Normalize Jobs
// Preserves scraper fingerprint, publishedAt, tags, and companyMeta; applies unified normalization rules.

const LEGAL_FORMS =
  /\b(?:sp\.?\s*z\s*o\.?\s*o\.?|sp\.?\s*k\.?|s\.?\s*a\.?|inc\.?|ltd\.?|llc|gmbh|ag|corp\.?|corporation|plc|bv|oy|ab|as|aps)(?=\s|$|[^a-z0-9])/gi;

const SENIORITY =
  /\b(?:senior|sr|junior|jr|lead|principal|staff|mid|regular|intern|trainee)\b/gi;

const GENDER_NOISE = /\((?:m\/f\/d|m\/w\/d|f\/m\/d|m\/f|k\/m|all genders)\)/gi;

function normCompany(company) {
  return String(company || '')
    .toLowerCase()
    .replace(LEGAL_FORMS, ' ')
    .replace(/[^a-z0-9ąćęłńóśźż]+/gi, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function normTitle(title) {
  return String(title || '')
    .toLowerCase()
    .replace(GENDER_NOISE, ' ')
    .replace(/\bfull[\s-]*stack\b/g, 'fullstack')
    .replace(/\bfront[\s-]*end\b/g, 'frontend')
    .replace(/\bback[\s-]*end\b/g, 'backend')
    .replace(/\bnode[\s.]*js\b/g, 'nodejs')
    .replace(/\breact[\s.]*js\b/g, 'react')
    .replace(SENIORITY, ' ')
    .replace(/[^a-z0-9ąćęłńóśźż#+]+/gi, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function fnv1a64(input) {
  const fnvOffset = BigInt('0xcbf29ce484222325');
  const fnvPrime = BigInt('0x100000001b3');
  let hash = fnvOffset;
  const str = String(input || '');
  for (let i = 0; i < str.length; i++) {
    hash ^= BigInt(str.charCodeAt(i));
    hash = (hash * fnvPrime) & BigInt('0xFFFFFFFFFFFFFFFF');
  }
  return hash.toString(16).padStart(16, '0');
}

function normUrl(u) {
  if (!u || typeof u !== 'string') return '';
  const trimmed = u.trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    return (parsed.origin + parsed.pathname).toLowerCase().replace(/\/+$/, '');
  } catch (e) {
    return trimmed.split(/[?#]/)[0].toLowerCase().replace(/\/+$/, '');
  }
}

const payload = $input.first().json;
const raw = payload.body || payload;
const offers = Array.isArray(raw.offers)
  ? raw.offers
  : Array.isArray(raw.jobs)
    ? raw.jobs
    : Array.isArray(raw)
      ? raw
      : [raw];
const batchStats = raw.meta?.stats || null;

return offers
  .filter((o) => o && typeof o === 'object' && (o.title || o.url))
  .map((o) => {
    const title = String(o.title || '').trim();
    const company = String(o.company || '').trim();
    const url = String(o.url || '').trim();
    const urlNorm = normUrl(url);
    const fingerprint =
      typeof o.fingerprint === 'string' && /^[0-9a-f]{16}$/i.test(o.fingerprint)
        ? o.fingerprint.toLowerCase()
        : fnv1a64(normCompany(company) + '::' + normTitle(title));
    const body = String(o.body ?? o.description ?? '').trim();

    return {
      json: {
        ...o,
        id: o.id || fingerprint,
        title,
        company,
        url,
        urlNorm,
        fingerprint,
        body,
        description: o.description ?? body,
        salary: o.salary || '',
        location: o.location || '',
        source: String(o.source || 'unknown').toLowerCase(),
        tags: Array.isArray(o.tags) ? o.tags : [],
        companyMeta: o.companyMeta && typeof o.companyMeta === 'object' ? o.companyMeta : null,
        publishedAt: o.publishedAt || null,
        scrapedAt: o.scrapedAt || new Date().toISOString(),
        ...(batchStats ? { batchStats } : {}),
      },
    };
  });
"""


def build_check_duplicate_code():
    return """const resp = $input.first().json;
const job = $('Split In Batches: 1').item.json;

const results = Array.isArray(resp.results) ? resp.results : [];
let isDuplicate = false;

for (const match of results) {
  const props = match?.properties || {};
  const score = props?.Score?.number;
  const statusName = props?.Status?.select?.name || props?.Status?.status?.name || '';
  const redFlags = (props?.['Red Flags']?.multi_select || []).map(x => x.name || '');
  const reasonText = (props?.Reason?.rich_text || []).map(t => t.plain_text || '').join('');

  const isErrorEntry =
    statusName.toLowerCase().includes('error') ||
    redFlags.some(f => f.startsWith('Pipeline:')) ||
    reasonText.startsWith('Error:');

  // Re-evaluation is allowed ONLY when the Eval Log entry is an execution/pipeline error
  // or when Score is missing/null without a completed evaluation.
  // Completed rejections (overall_score === 0, match === false) MUST be treated as duplicates!
  if (isErrorEntry || score === null || score === undefined) {
    continue;
  }
  isDuplicate = true;
  break;
}

if (isDuplicate) {
  console.log(`[Dedup] SKIP "${job.title}" @ ${job.company}`);
} else {
  console.log(`[Dedup] NEW "${job.title}" @ ${job.company} — fp: ${job.fingerprint}`);
}

return [{ json: { ...job, isDuplicate } }];
"""


def build_llm_router_code():
    return """// Node: Code: LLM Router
// Fallback order: Gemini models primary with exponential backoff retries (1s -> 2s -> 4s), OpenRouter fallback.

const PROVIDER_ORDER = [
  'gemini:gemini-2.5-flash-lite',
  'gemini:gemini-3.1-flash-lite',
  'gemini:gemini-2.5-flash',
  'gemini:gemini-3.5-flash',
  'openrouter:openrouter/free'
];

const maxRetries = 2;
const maxAttempts = 3;
const timeoutMs = 30000;

const geminiApiKey = $env.GEMINI_API_KEY;
const openrouterApiKey = $env.OPENROUTER_API_KEY;

const item = $input.first().json;
const prompt = item.prompt || item.systemPrompt || '';
const userMessage = item.userMessage || '';
const fullPrompt = userMessage ? `${prompt}\\n\\n${userMessage}` : prompt;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isRetryableStatus(err) {
  const status = err?.statusCode || err?.status || err?.httpCode || 0;
  const msg = String(err?.message || err || '').toLowerCase();
  return (
    status === 429 ||
    status >= 500 ||
    /\\b(?:429|500|502|503|504)\\b/.test(msg) ||
    msg.includes('rate limit') ||
    msg.includes('too many requests') ||
    msg.includes('quota')
  );
}

async function callGemini(model, attempt = 1) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`;
  try {
    return await this.helpers.httpRequest({
      method: 'POST',
      url,
      timeout: timeoutMs,
      headers: { 'Content-Type': 'application/json' },
      body: { contents: [{ parts: [{ text: fullPrompt }] }] },
      json: true
    });
  } catch (err) {
    if (attempt <= maxRetries && isRetryableStatus(err)) {
      const delayMs = 1000 * Math.pow(2, attempt - 1);
      await sleep(delayMs);
      return await callGemini.call(this, model, attempt + 1);
    }
    throw err;
  }
}

async function callOpenRouter(model, attempt = 1) {
  const url = 'https://openrouter.ai/api/v1/chat/completions';
  try {
    return await this.helpers.httpRequest({
      method: 'POST',
      url,
      timeout: timeoutMs,
      headers: {
        'Authorization': `Bearer ${openrouterApiKey}`,
        'Content-Type': 'application/json'
      },
      body: {
        model,
        messages: [{ role: 'user', content: fullPrompt }]
      },
      json: true
    });
  } catch (err) {
    if (attempt <= maxRetries && isRetryableStatus(err)) {
      const delayMs = 1000 * Math.pow(2, attempt - 1);
      await sleep(delayMs);
      return await callOpenRouter.call(this, model, attempt + 1);
    }
    throw err;
  }
}

const providerErrors = [];

for (const target of PROVIDER_ORDER) {
  const [provider, model] = target.split(':');
  try {
    if (provider === 'gemini') {
      const res = await callGemini.call(this, model);
      return [{ json: { provider: target, message: { content: res.candidates[0].content.parts[0].text } } }];
    } else if (provider === 'openrouter') {
      const res = await callOpenRouter.call(this, model);
      return [{ json: { provider: target, message: { content: res.choices[0].message.content } } }];
    }
  } catch (e) {
    const status = e?.statusCode || e?.status || '';
    const msg = e?.message || String(e);
    providerErrors.push(`${target}${status ? ' (' + status + ')' : ''}: ${msg}`);
  }
}

return [{ json: { error: `All providers failed in PROVIDER_ORDER fallback chain: ${providerErrors.join(' | ')}` } }];
"""


def build_parse_ollama_code():
    dist_scoring = Path(__file__).resolve().parent.parent / "n8n" / "dist" / "evaluator" / "scoring.js"
    if not dist_scoring.exists():
        sys.exit(f"Compiled scoring.js not found at {dist_scoring}. Run 'cd n8n && npm run build' first.")
    scoring_code = dist_scoring.read_text(encoding="utf-8")

    header = """const ollamaResp = $input.first().json;
const job = $('Code: Build Ollama Payload').first().json;

const classifyErrorFlag = (reason) => {
  const lower = String(reason || '').toLowerCase();
  if (
    lower.includes('429') ||
    lower.includes('quota') ||
    lower.includes('rate limit') ||
    lower.includes('too many requests') ||
    lower.includes('resource_exhausted')
  ) {
    return 'Pipeline: Quota Error';
  }
  if (
    lower.includes('500') ||
    lower.includes('502') ||
    lower.includes('503') ||
    lower.includes('504') ||
    lower.includes('llm router') ||
    lower.includes('all providers failed') ||
    lower.includes('timeout') ||
    lower.includes('network') ||
    lower.includes('request failed') ||
    lower.includes('ollama')
  ) {
    return 'Pipeline: LLM Error';
  }
  return 'Pipeline: Parse Error';
};

const fallback = (reason, overrideFlag) => ({
  json: {
    id: job.id, title: job.title, company: job.company,
    url: job.url, source: job.source, location: job.location,
    salary: job.salary, tags: job.tags, scrapedAt: job.scrapedAt,
    fingerprint: job.fingerprint || '',
    overall_score: null, tech_stack_match: null, seniority_match: null,
    status: 'Status: Error',
    pipelineError: true,
    red_flags: [overrideFlag || classifyErrorFlag(reason)],
    reason: `Error: ${reason}`,
    match: false
  }
});

if (ollamaResp?.error) {
  if (job.profileError) {
    const failClosed = fallback('Notion profile unavailable', 'Pipeline: Notion Error');
    failClosed.json.model = 'notion-profile';
    return [failClosed];
  }
  return [fallback(`LLM Router error: ${JSON.stringify(ollamaResp.error).slice(0, 220)}`)];
}

const raw = ollamaResp?.message?.content || '';
if (!raw) return [fallback('Empty LLM response', 'Pipeline: Parse Error')];

var exports = typeof exports !== 'undefined' ? exports : {};
"""

    footer = """
const evaluation = exports.evaluateJob(raw, {
  id: job.id || '', title: job.title, company: job.company, url: job.url || '',
  source: job.source, location: job.location, salary: job.salary,
  body: job.body, scrapedAt: job.scrapedAt, fingerprint: job.fingerprint || '',
  companyMeta: job.companyMeta
}, job.scoringConfig);

const isParseFallback = Array.isArray(evaluation.red_flags) && evaluation.red_flags.some(f => f.startsWith('Pipeline:'));

return [{
  json: {
    ...evaluation,
    overall_score: isParseFallback ? null : evaluation.overall_score,
    tech_stack_match: isParseFallback ? null : evaluation.tech_stack_match,
    seniority_match: isParseFallback ? null : evaluation.seniority_match,
    status: isParseFallback ? 'Status: Error' : 'Evaluated',
    pipelineError: isParseFallback,
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

    # Ensure Code: Normalize Jobs, Code: Check Duplicate, Code: LLM Router, and Code: Parse Ollama Response are up-to-date
    for node in nodes:
        name = node.get("name", "")
        if name == "Code: Normalize Jobs":
            params = node.setdefault("parameters", {})
            params["jsCode"] = build_normalize_jobs_code()
            patched_count += 1
            print("✅ Patched Code: Normalize Jobs to preserve scraper fingerprint, publishedAt, tags, and companyMeta")
        elif name == "Code: Check Duplicate":
            params = node.setdefault("parameters", {})
            params["jsCode"] = build_check_duplicate_code()
            patched_count += 1
            print("✅ Patched Code: Check Duplicate to deduplicate completed rejections (score 0) and only re-evaluate errors")
        elif name == "Code: LLM Router":
            params = node.setdefault("parameters", {})
            params["jsCode"] = build_llm_router_code()
            patched_count += 1
            print("✅ Patched Code: LLM Router with exponential backoff retries (1s -> 2s -> 4s)")
        elif name == "Code: Parse Ollama Response":
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

const isErrorJob = (j) =>
  j.pipelineError === true ||
  j.status === 'Status: Error' ||
  j.overall_score === null ||
  j.overall_score === undefined ||
  (Array.isArray(j.red_flags) && j.red_flags.some(f => String(f).startsWith('Pipeline:')));

const llmErrors = evaluatedJobs.filter(isErrorJob);
const validEvaluated = evaluatedJobs.filter(j => !isErrorJob(j));

const hotMatches = validEvaluated.filter(j => (j.overall_score || 0) >= 80);
const reviews = validEvaluated.filter(j => (j.overall_score || 0) >= 50 && (j.overall_score || 0) < 80);
const rejected = validEvaluated.filter(j => (j.overall_score || 0) < 50);

const dateStr = new Date().toLocaleDateString('ru-RU', { timeZone: 'Europe/Warsaw' });
const timeStr = new Date().toLocaleTimeString('ru-RU', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit' });

const text = `🏁 *AI Recruiter — Дайджест прогона*
📅 _${dateStr} ${timeStr}_
───────────────────────────
📥 *Получено от скрейпера:* ${totalReceived}
👥 *Дубликаты в прогоне (кросс-постинг):* ${batchDuplicates}
♻️ *Дубликаты в базе Notion:* ${duplicatesCount}
🤖 *Оценено нейросетью:* ${validEvaluated.length}
⚠️ *Ошибки LLM / парсинга:* ${llmErrors.length}
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
    evaluatedCount: validEvaluated.length,
    llmErrorsCount: llmErrors.length,
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
