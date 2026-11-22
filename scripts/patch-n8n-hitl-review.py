#!/usr/bin/env python3
"""Inspect, patch, and drift-check live n8n workflows (Ingest Jobs & Telegram Bot).

Usage:
  python3 scripts/patch-n8n-hitl-review.py           # Patch live n8n workflows and activate Telegram Bot
  python3 scripts/patch-n8n-hitl-review.py --check   # Verify scoring.js freshness and 100% node parity with live n8n
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

BASE_URL = os.environ.get("N8N_BASE_URL", "https://n8n-recruiter.duckdns.org").rstrip("/")
KEY_FILE = Path.home() / ".n8n-recruiter-key"
INGEST_WORKFLOW_ID = os.environ.get("INGEST_WORKFLOW_ID", "88ajS2u1QcHuIa1r")
CALLBACK_WORKFLOW_NAMES = ("Telegram Bot", "Telegram Callback Router")


def get_api_key():
    key = os.environ.get("N8N_API_KEY", "").strip()
    if not key and KEY_FILE.exists():
        key = KEY_FILE.read_text().strip()
    if not key:
        sys.exit(f"No API key: set N8N_API_KEY or create {KEY_FILE}")
    return key


def verify_scoring_dist_freshness() -> Path:
    repo_root = Path(__file__).resolve().parent.parent
    src_scoring = repo_root / "n8n" / "evaluator" / "scoring.ts"
    dist_scoring = repo_root / "n8n" / "dist" / "evaluator" / "scoring.js"
    if not dist_scoring.exists():
        sys.exit(
            f"FAIL: Compiled scoring.js not found at {dist_scoring}. Run 'cd n8n && npm run build' first."
        )
    if src_scoring.exists():
        src_mtime = src_scoring.stat().st_mtime
        dist_mtime = dist_scoring.stat().st_mtime
        if dist_mtime < src_mtime:
            sys.exit(
                f"FAIL: {dist_scoring} is older than {src_scoring} "
                f"(dist={dist_mtime:.1f} < src={src_mtime:.1f}). Run 'cd n8n && npm run build' first."
            )
    return dist_scoring


def build_normalize_jobs_code() -> str:
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

    const orFilters = [{ property: 'Fingerprint', rich_text: { equals: fingerprint } }];
    if (urlNorm) orFilters.push({ property: 'URL', url: { equals: urlNorm } });
    if (url && url !== urlNorm) orFilters.push({ property: 'URL', url: { equals: url } });
    const dedupFilter = { filter: { or: orFilters }, page_size: 1 };

    return {
      json: {
        ...o,
        id: o.id || fingerprint,
        title,
        company,
        url,
        urlNorm,
        fingerprint,
        dedupFilter,
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


def build_dedup_batch_code() -> str:
    return r"""// Node: Code: Dedup Batch
// In-memory within-batch deduplication by fingerprint, urlNorm, and raw url.

const items = $input.all();
const seenFingerprints = new Set();
const seenUrls = new Set();
const unique = [];

for (const item of items) {
  const j = item.json || {};
  const fp = String(j.fingerprint || '').trim();
  const urlNorm = String(j.urlNorm || '').trim();
  const url = String(j.url || '').trim();

  if ((fp && seenFingerprints.has(fp)) || (urlNorm && seenUrls.has(urlNorm)) || (url && seenUrls.has(url))) {
    console.log(`[BatchDedup] DROP "${j.title}" @ ${j.company} (fp=${fp})`);
    continue;
  }

  if (fp) seenFingerprints.add(fp);
  if (urlNorm) seenUrls.add(urlNorm);
  if (url) seenUrls.add(url);
  unique.push(item);
}

console.log(`[BatchDedup] Kept ${unique.length} / ${items.length} unique offers in batch`);
return unique;
"""


def build_check_duplicate_code() -> str:
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


def build_llm_router_code() -> str:
    dist_scoring = verify_scoring_dist_freshness()
    scoring_code = dist_scoring.read_text(encoding="utf-8")

    header = r"""// Node: Code: LLM Router
// Pre-LLM Hard Reject Gate (WP-6.1) + Batch Notion Profile Cache (WP-6.3) + Gemini JSON Mode & stripCodeFence (WP-6.2)

const PROVIDER_ORDER = [
  'gemini:gemini-2.5-flash-lite',
  'gemini:gemini-2.5-flash',
  'openrouter:openrouter/free'
];

const maxRetries = 2;
const maxAttempts = 3;
const timeoutMs = 30000;

const geminiApiKey = $env.GEMINI_API_KEY;
const openrouterApiKey = $env.OPENROUTER_API_KEY;

function stripCodeFence(content) {
  const trimmed = String(content || '').trim();
  if (!trimmed.startsWith('```')) return trimmed;
  return trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
}

const item = $input.first().json;
let job = item;
try {
  job = $('Code: Build Ollama Payload').first().json || item;
} catch (e) {}

// Batch-level Notion profile & scoringConfig cache in workflow static data (10-min TTL)
const staticData = $getWorkflowStaticData('global');
const nowMs = Date.now();
const CACHE_TTL_MS = 10 * 60 * 1000;

if (!job.profileError && (item.prompt || item.systemPrompt || job.scoringConfig)) {
  staticData.cachedProfile = {
    prompt: item.prompt || item.systemPrompt || '',
    scoringConfig: job.scoringConfig || item.scoringConfig || null,
    cachedAt: nowMs
  };
} else if (
  staticData.cachedProfile &&
  nowMs - (staticData.cachedProfile.cachedAt || 0) < CACHE_TTL_MS
) {
  if (!item.prompt && !item.systemPrompt) {
    item.prompt = staticData.cachedProfile.prompt;
  }
  if (!job.scoringConfig && staticData.cachedProfile.scoringConfig) {
    job.scoringConfig = staticData.cachedProfile.scoringConfig;
  }
}

var exports = typeof exports !== 'undefined' ? exports : {};
"""

    footer = r"""
// Pre-LLM Hard Reject Gate: short-circuit deterministic rejects BEFORE spending LLM tokens
const jobForGate = {
  id: job.id || item.id || '',
  title: job.title || item.title || '',
  company: job.company || item.company || '',
  url: job.url || item.url || '',
  source: job.source || item.source || '',
  location: job.location || item.location || '',
  salary: job.salary || item.salary || '',
  body: job.body ?? item.body ?? item.description ?? '',
  scrapedAt: job.scrapedAt || item.scrapedAt || '',
  fingerprint: job.fingerprint || item.fingerprint || '',
  companyMeta: job.companyMeta || item.companyMeta
};
const activeScoringConfig = job.scoringConfig || item.scoringConfig;

if (typeof exports.preFilterJob === 'function') {
  const gateResult = exports.preFilterJob(jobForGate, activeScoringConfig);
  if (gateResult && gateResult.rejected) {
    const preEval = gateResult.evaluation || {
      overall_score: 0,
      tech_stack_match: 0,
      seniority_match: 0,
      red_flags: Array.isArray(gateResult.red_flags) && gateResult.red_flags.length > 0
        ? gateResult.red_flags
        : ['Pre-Filter: Hard Reject'],
      reason: gateResult.reason || 'Rejected by Pre-LLM deterministic gate.',
      company_dossier: 'Отклонено детерминированным пре-фильтром до вызова LLM.',
      project_summary: 'Отклонено детерминированным пре-фильтром до вызова LLM.',
      tasks_summary: [],
      match_pros: [],
      match_cons: [gateResult.reason || 'Hard reject criterion triggered'],
      pitch_hook: '',
      url: jobForGate.url
    };
    return [{
      json: {
        provider: 'pre-filter:hard-gate',
        preFiltered: true,
        message: { content: JSON.stringify(preEval) }
      }
    }];
  }
}

const prompt = item.prompt || item.systemPrompt || '';
const userMessage = item.userMessage || '';
const fullPrompt = userMessage ? `${prompt}\n\n${userMessage}` : prompt;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isRetryableStatus(err) {
  const status = err?.statusCode || err?.status || err?.httpCode || 0;
  const msg = String(err?.message || err || '').toLowerCase();
  return (
    status === 429 ||
    status >= 500 ||
    /\b(?:429|500|502|503|504)\b/.test(msg) ||
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
      body: {
        contents: [{ parts: [{ text: fullPrompt }] }],
        generationConfig: { responseMimeType: 'application/json' }
      },
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
      const rawText = res?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return [{ json: { provider: target, message: { content: stripCodeFence(rawText) } } }];
    } else if (provider === 'openrouter') {
      const res = await callOpenRouter.call(this, model);
      const rawText = res?.choices?.[0]?.message?.content || '';
      return [{ json: { provider: target, message: { content: stripCodeFence(rawText) } } }];
    }
  } catch (e) {
    const status = e?.statusCode || e?.status || '';
    const msg = e?.message || String(e);
    providerErrors.push(`${target}${status ? ' (' + status + ')' : ''}: ${msg}`);
  }
}

return [{ json: { error: `All providers failed in PROVIDER_ORDER fallback chain: ${providerErrors.join(' | ')}` } }];
"""
    return header + scoring_code + footer


def build_parse_ollama_code() -> str:
    dist_scoring = verify_scoring_dist_freshness()
    scoring_code = dist_scoring.read_text(encoding="utf-8")

    header = r"""const ollamaResp = $input.first().json;
const job = $('Code: Build Ollama Payload').first().json;

function stripCodeFence(content) {
  const trimmed = String(content || '').trim();
  if (!trimmed.startsWith('```')) return trimmed;
  return trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
}

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

const raw = stripCodeFence(ollamaResp?.message?.content || '');
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


def build_telegram_send_alert_json_body() -> str:
    return r"""={{
  (() => {
    const item = $('Code: Parse Ollama Response').item.json;
    const escapeHtml = (s) => String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

    const divider = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
    const comp = item.company || '';
    const cUrl = (item.companyMeta && item.companyMeta.companyUrl) || item.companyUrl;
    const compLink = cUrl
      ? `<a href="${escapeHtml(cUrl)}">🌐 Сайт компании</a>`
      : `<a href="https://www.google.com/search?q=${encodeURIComponent(comp + ' software')}">🔍 Найти в Google</a>`;

    const lines = [
      `🔥 <b>[Горячий мэтч] ${escapeHtml(item.title || '')}</b> @ <b>${escapeHtml(comp)}</b>`,
      divider
    ];

    const baseSalary = item.salary ? escapeHtml(item.salary) : 'Зарплата не указана';
    let salaryLine = `💵 ${baseSalary}`;
    if (item.net_salary) {
      const trimmedNet = String(item.net_salary).trim();
      if (trimmedNet.startsWith('(') && trimmedNet.endsWith(')')) {
        salaryLine += `  ${escapeHtml(trimmedNet)}`;
      } else if (trimmedNet.toLowerCase().includes('на руки')) {
        salaryLine += `  (${escapeHtml(trimmedNet)})`;
      } else {
        const tilde = trimmedNet.startsWith('~') ? '' : '~';
        salaryLine += `  (на руки ${tilde}${escapeHtml(trimmedNet)})`;
      }
    }
    lines.push(salaryLine);

    const locText = item.location ? escapeHtml(item.location) : 'Локация не указана';
    const srcText = item.source ? ` | 🌐 ${escapeHtml(item.source)}` : '';
    lines.push(`📍 ${locText}${srcText}`);

    const summary = (item.project_summary || item.company_dossier || '').trim();
    const cleanSummary = summary && !summary.toLowerCase().includes('уточняется') ? summary : 'Не знаю';
    lines.push('');
    lines.push('📦 <b>Проект и домен:</b>');
    if (item.project_domain) {
      lines.push(`• Домен: ${escapeHtml(item.project_domain)}`);
    }
    lines.push(`• Что делает: ${escapeHtml(cleanSummary)}`);
    if (item.project_scale) {
      lines.push(`• Масштаб/Клиенты: ${escapeHtml(item.project_scale)}`);
    }
    lines.push(compLink);

    const coreStack = Array.isArray(item.stack_core)
      ? item.stack_core.join(', ')
      : (item.stack_core || (Array.isArray(item.tags) && item.tags.length > 0 ? item.tags.join(', ') : ''));
    const infraStack = Array.isArray(item.stack_infra)
      ? item.stack_infra.join(', ')
      : (item.stack_infra || '');

    if (coreStack || infraStack) {
      lines.push('');
      lines.push('⚙️ <b>Стек:</b>');
      if (coreStack) lines.push(`• Core: ${escapeHtml(coreStack)}`);
      if (infraStack) lines.push(`• Infra: ${escapeHtml(infraStack)}`);
    }

    if (Array.isArray(item.tasks_summary) && item.tasks_summary.length > 0) {
      lines.push('');
      lines.push('🎯 <b>Задачи:</b>');
      for (const task of item.tasks_summary) {
        if (task) lines.push(`• ${escapeHtml(task)}`);
      }
    }

    const matchLines = [];
    if (Array.isArray(item.match_pros)) {
      for (const pro of item.match_pros) {
        const t = String(pro || '').trim();
        if (!t) continue;
        if (t.startsWith('[+]')) matchLines.push(`• ${escapeHtml(t)}`);
        else if (t.startsWith('+ ')) matchLines.push(`• [+] ${escapeHtml(t.slice(2).trim())}`);
        else matchLines.push(`• [+] ${escapeHtml(t)}`);
      }
    }
    if (Array.isArray(item.match_cons)) {
      for (const con of item.match_cons) {
        const t = String(con || '').trim();
        if (!t) continue;
        if (t.startsWith('[−]') || t.startsWith('[-]')) matchLines.push(`• [−] ${escapeHtml(t.slice(3).trim())}`);
        else if (t.startsWith('− ') || t.startsWith('- ')) matchLines.push(`• [−] ${escapeHtml(t.slice(2).trim())}`);
        else matchLines.push(`• [−] ${escapeHtml(t)}`);
      }
    }
    if (matchLines.length === 0 && item.reason) {
      matchLines.push(`• ${escapeHtml(item.reason)}`);
    }

    lines.push('');
    lines.push(`⚖️ <b>Мэтч с твоим профилем (${item.overall_score ?? 0}%):</b>`);
    lines.push(...matchLines);

    if (item.pitch_hook) {
      lines.push('');
      lines.push(`🪝 <b>Хук для отклика:</b> ${escapeHtml(item.pitch_hook)}`);
    }

    lines.push('');
    lines.push(divider);

    const pageId = ($json.id || '').replace(/[^a-fA-F0-9]/g, '').toLowerCase();

    return JSON.stringify({
      chat_id: "-1004357080568",
      message_thread_id: 2,
      text: lines.join('\n'),
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "🚀 Подготовить отклик",
              callback_data: "app:" + pageId
            }
          ],
          [
            {
              text: "🔗 Вакансия",
              url: item.url
            },
            {
              text: "👎 В архив",
              callback_data: "rej:" + pageId
            }
          ]
        ]
      }
    });
  })()
}}"""


def build_telegram_send_review_alert_json_body() -> str:
    return r"""={{
  (() => {
    const item = $('Code: Parse Ollama Response').item.json;
    const escapeHtml = (s) => String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

    const divider = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
    const comp = item.company || '';
    const cUrl = (item.companyMeta && item.companyMeta.companyUrl) || item.companyUrl;
    const compLink = cUrl
      ? `<a href="${escapeHtml(cUrl)}">🌐 Сайт компании</a>`
      : `<a href="https://www.google.com/search?q=${encodeURIComponent(comp + ' software')}">🔍 Найти в Google</a>`;

    const lines = [
      `👀 <b>[На ревью] ${escapeHtml(item.title || '')}</b> @ <b>${escapeHtml(comp)}</b>`,
      divider
    ];

    const baseSalary = item.salary ? escapeHtml(item.salary) : 'Зарплата не указана';
    let salaryLine = `💵 ${baseSalary}`;
    if (item.net_salary) {
      const trimmedNet = String(item.net_salary).trim();
      if (trimmedNet.startsWith('(') && trimmedNet.endsWith(')')) {
        salaryLine += `  ${escapeHtml(trimmedNet)}`;
      } else if (trimmedNet.toLowerCase().includes('на руки')) {
        salaryLine += `  (${escapeHtml(trimmedNet)})`;
      } else {
        const tilde = trimmedNet.startsWith('~') ? '' : '~';
        salaryLine += `  (на руки ${tilde}${escapeHtml(trimmedNet)})`;
      }
    }
    lines.push(salaryLine);

    const locText = item.location ? escapeHtml(item.location) : 'Локация не указана';
    const srcText = item.source ? ` | 🌐 ${escapeHtml(item.source)}` : '';
    lines.push(`📍 ${locText}${srcText}`);

    const summary = (item.project_summary || item.company_dossier || '').trim();
    const cleanSummary = summary && !summary.toLowerCase().includes('уточняется') ? summary : 'Не знаю';
    lines.push('');
    lines.push('📦 <b>Проект и домен:</b>');
    if (item.project_domain) {
      lines.push(`• Домен: ${escapeHtml(item.project_domain)}`);
    }
    lines.push(`• Что делает: ${escapeHtml(cleanSummary)}`);
    if (item.project_scale) {
      lines.push(`• Масштаб/Клиенты: ${escapeHtml(item.project_scale)}`);
    }
    lines.push(compLink);

    const coreStack = Array.isArray(item.stack_core)
      ? item.stack_core.join(', ')
      : (item.stack_core || (Array.isArray(item.tags) && item.tags.length > 0 ? item.tags.join(', ') : ''));
    const infraStack = Array.isArray(item.stack_infra)
      ? item.stack_infra.join(', ')
      : (item.stack_infra || '');

    if (coreStack || infraStack) {
      lines.push('');
      lines.push('⚙️ <b>Стек:</b>');
      if (coreStack) lines.push(`• Core: ${escapeHtml(coreStack)}`);
      if (infraStack) lines.push(`• Infra: ${escapeHtml(infraStack)}`);
    }

    if (Array.isArray(item.tasks_summary) && item.tasks_summary.length > 0) {
      lines.push('');
      lines.push('🎯 <b>Задачи:</b>');
      for (const task of item.tasks_summary) {
        if (task) lines.push(`• ${escapeHtml(task)}`);
      }
    }

    const matchLines = [];
    if (Array.isArray(item.match_pros)) {
      for (const pro of item.match_pros) {
        const t = String(pro || '').trim();
        if (!t) continue;
        if (t.startsWith('[+]')) matchLines.push(`• ${escapeHtml(t)}`);
        else if (t.startsWith('+ ')) matchLines.push(`• [+] ${escapeHtml(t.slice(2).trim())}`);
        else matchLines.push(`• [+] ${escapeHtml(t)}`);
      }
    }
    if (Array.isArray(item.match_cons)) {
      for (const con of item.match_cons) {
        const t = String(con || '').trim();
        if (!t) continue;
        if (t.startsWith('[−]') || t.startsWith('[-]')) matchLines.push(`• [−] ${escapeHtml(t.slice(3).trim())}`);
        else if (t.startsWith('− ') || t.startsWith('- ')) matchLines.push(`• [−] ${escapeHtml(t.slice(2).trim())}`);
        else matchLines.push(`• [−] ${escapeHtml(t)}`);
      }
    }
    if (matchLines.length === 0 && item.reason) {
      matchLines.push(`• ${escapeHtml(item.reason)}`);
    }

    lines.push('');
    lines.push(`⚖️ <b>Мэтч с твоим профилем (${item.overall_score ?? 0}%):</b>`);
    lines.push(...matchLines);

    if (item.pitch_hook) {
      lines.push('');
      lines.push(`🪝 <b>Хук для отклика:</b> ${escapeHtml(item.pitch_hook)}`);
    }

    const flags = Array.isArray(item.red_flags) && item.red_flags.length > 0
      ? item.red_flags.join(', ')
      : '';
    if (flags) {
      lines.push(`⚠️ <b>Флаги:</b> ${escapeHtml(flags)}`);
    }

    lines.push('');
    lines.push(divider);

    const pageId = ($json.id || '').replace(/[^a-fA-F0-9]/g, '').toLowerCase();

    return JSON.stringify({
      chat_id: "-1004357080568",
      message_thread_id: 3,
      text: lines.join('\n'),
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "🚀 Подготовить отклик",
              callback_data: "app:" + pageId
            }
          ],
          [
            {
              text: "👍 Берём в Hot Match",
              callback_data: "prm:" + pageId
            },
            {
              text: "👎 В архив",
              callback_data: "dsc:" + pageId
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


def build_prepare_digest_code() -> str:
    return r"""let normalizedItems = [];
try {
  normalizedItems = $('Code: Normalize Jobs').all();
} catch (e) {}
const totalReceived = normalizedItems.length;
const batchStats = (normalizedItems[0] && normalizedItems[0].json && normalizedItems[0].json.batchStats) || null;
const scrapedTotal = (batchStats && batchStats.total && batchStats.total.collected) || totalReceived;

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

const sanitizeMd = (s) => String(s || '').replace(/[*_`\[\]]/g, '').trim();

const topMatches = [...validEvaluated]
  .filter(j => (j.overall_score || 0) >= 50)
  .sort((a, b) => (b.overall_score || 0) - (a.overall_score || 0))
  .slice(0, 3);

const dateStr = new Date().toLocaleDateString('ru-RU', { timeZone: 'Europe/Warsaw' });
const timeStr = new Date().toLocaleTimeString('ru-RU', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit' });

let showcaseBlock = '';
if (topMatches.length > 0) {
  const cards = topMatches.map((j, idx) => {
    const badge = (j.overall_score || 0) >= 80 ? '🔥' : '👀';
    const title = sanitizeMd(j.title || 'Вакансия');
    const comp = sanitizeMd(j.company || 'Компания');
    const sal = sanitizeMd(j.net_salary ? `${j.salary || ''} (~${j.net_salary})` : (j.salary || 'ЗП не указана'));
    const hookRaw = j.pitch_hook || j.project_summary || j.company_dossier || j.reason || '';
    const hook = sanitizeMd(hookRaw).slice(0, 140);
    const linkPart = j.url ? `[${title}](${j.url})` : `*${title}*`;
    return `${idx + 1}. ${badge} ${linkPart} @ *${comp}* (${j.overall_score}/100)\n   💵 ${sal}\n   💡 ${hook}`;
  });
  showcaseBlock = `🏆 *Топ-${topMatches.length} находки прогона:*\n\n${cards.join('\n\n')}`;
} else {
  showcaseBlock = `✨ В этом прогоне новых подходящих вакансий (50+ баллов) не найдено.`;
}

const funnelLine = `📊 _Воронка: собрано ${scrapedTotal} → в n8n ${totalReceived} (дубли: ${batchDuplicates} батч / ${duplicatesCount} Notion) → оценено ${validEvaluated.length}${llmErrors.length > 0 ? ` (ошибок: ${llmErrors.length})` : ''} → 🔥 ${hotMatches.length} | 👀 ${reviews.length} | ❌ ${rejected.length}_`;

const text = `🏁 *AI Recruiter — Витрина прогона* (${dateStr} ${timeStr})
───────────────────────────
${showcaseBlock}
───────────────────────────
${funnelLine}`;

return [{
  json: {
    totalReceived,
    scrapedTotal,
    batchDuplicates,
    duplicatesCount,
    evaluatedCount: validEvaluated.length,
    llmErrorsCount: llmErrors.length,
    hotCount: hotMatches.length,
    reviewCount: reviews.length,
    rejectedCount: rejected.length,
    topMatchesCount: topMatches.length,
    digestText: text
  }
}];"""


def build_callback_router_code() -> str:
    return r"""// Node: Code: Route Telegram Callback
// Handles HITL inline callbacks: app:, applied:, prm:, dsc:, rej:, rfb: (WP-3.1, WP-3.2, WP-3.3)

const rawInput = $input.first().json;
const body = rawInput.body || rawInput;
const botToken = $env.TELEGRAM_BOT_TOKEN;
const geminiApiKey = $env.GEMINI_API_KEY;
const openrouterApiKey = $env.OPENROUTER_API_KEY;
const tgUrl = (method) => `https://api.telegram.org/bot${botToken}/${method}`;

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatNotionUuid(rawId) {
  const clean = String(rawId || '').replace(/[^a-fA-F0-9]/g, '').toLowerCase();
  if (clean.length !== 32) return clean;
  return `${clean.slice(0, 8)}-${clean.slice(8, 12)}-${clean.slice(12, 16)}-${clean.slice(16, 20)}-${clean.slice(20)}`;
}

// Self-setup: register webhook with Telegram Bot API
if (body.setup === true) {
  const target = 'https://n8n-recruiter.duckdns.org/webhook/telegram-callback';
  const res = await this.helpers.httpRequest({
    method: 'POST',
    url: tgUrl('setWebhook'),
    body: { url: target, allowed_updates: ['callback_query', 'message'] },
    json: true
  });
  return [{ json: { setWebhookResult: res } }];
}

const cq = body.callback_query || rawInput.callback_query;
if (!cq || !cq.data) {
  return [{ json: { status: 'ignored_not_callback_query' } }];
}

const chatId = cq.message?.chat?.id || '-1004357080568';
const messageId = cq.message?.message_id;
const threadId = cq.message?.message_thread_id || 2;
const rawText = cq.message?.text || '';
const cqId = cq.id;
const data = String(cq.data || '').trim();

const REASONS = {
  sal: '💸 Зарплата',
  out: '🏢 Аутсорс',
  leg: '💀 Легаси',
  loc: '📍 Локация',
  jun: '📉 Грейд'
};

const answer = async (text, showAlert = false) => {
  try {
    await this.helpers.httpRequest({
      method: 'POST',
      url: tgUrl('answerCallbackQuery'),
      body: { callback_query_id: cqId, text, show_alert: showAlert },
      json: true
    });
  } catch (e) {}
};

const editMarkup = async (keyboard) => {
  try {
    await this.helpers.httpRequest({
      method: 'POST',
      url: tgUrl('editMessageReplyMarkup'),
      body: {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: keyboard }
      },
      json: true
    });
  } catch (e) {}
};

const fetchNotionPage = async (pageId) => {
  const formattedId = formatNotionUuid(pageId);
  const headers = { 'Notion-Version': '2022-06-28' };
  if ($env.NOTION_TOKEN) {
    headers['Authorization'] = `Bearer ${$env.NOTION_TOKEN}`;
  }
  try {
    return await this.helpers.httpRequest({
      method: 'GET',
      url: `https://api.notion.com/v1/pages/${formattedId}`,
      headers,
      json: true
    });
  } catch (e) {
    return null;
  }
};

const updateNotionProperties = async (pageId, properties) => {
  const formattedId = formatNotionUuid(pageId);
  const headers = {
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json'
  };
  if ($env.NOTION_TOKEN) {
    headers['Authorization'] = `Bearer ${$env.NOTION_TOKEN}`;
  }
  try {
    await this.helpers.httpRequest({
      method: 'PATCH',
      url: `https://api.notion.com/v1/pages/${formattedId}`,
      headers,
      body: { properties },
      json: true
    });
  } catch (e) {
    // Fallback if Status property uses Notion 'status' type instead of 'select'
    if (properties.Status && properties.Status.select) {
      try {
        await this.helpers.httpRequest({
          method: 'PATCH',
          url: `https://api.notion.com/v1/pages/${formattedId}`,
          headers,
          body: {
            properties: {
              ...properties,
              Status: { status: { name: properties.Status.select.name } }
            }
          },
          json: true
        });
      } catch (e2) {}
    }
  }
};

const updateNotionStatus = async (pageId, statusName) => {
  await updateNotionProperties(pageId, {
    Status: { select: { name: statusName } }
  });
};

// 1. Promote to Hot Match: prm:<pageId>
if (data.startsWith('prm:')) {
  const pageId = data.slice(4).replace(/[^a-fA-F0-9]/g, '').toLowerCase();
  await answer('✅ Вакансия перенесена в Горячий мэтч');
  await updateNotionStatus(pageId, 'Hot Match');
  await editMarkup([[{ text: '✅ Перенесено в Горячий мэтч', callback_data: 'noop:promoted' }]]);

  const page = await fetchNotionPage(pageId);
  const props = page?.properties || {};
  const jobUrl = props?.URL?.url || (rawText.match(/https?:\/\/[^\s\n]+/) || ['https://justjoin.it'])[0];

  await this.helpers.httpRequest({
    method: 'POST',
    url: tgUrl('sendMessage'),
    body: {
      chat_id: chatId,
      message_thread_id: 2,
      text: escapeHtml(rawText.replace(/👀\s*\[На ревью\]/, '🔥 [Горячий мэтч]')),
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: [
          [{ text: '🚀 Подготовить отклик', callback_data: `app:${pageId}` }],
          [
            { text: '🔗 Вакансия', url: jobUrl },
            { text: '👎 В архив', callback_data: `rej:${pageId}` }
          ]
        ]
      }
    },
    json: true
  });

  return [{ json: { action: 'promoted', pageId } }];
}

// 2. Discard to Archive (1-tap): dsc:<pageId>
if (data.startsWith('dsc:')) {
  const pageId = data.slice(4).replace(/[^a-fA-F0-9]/g, '').toLowerCase();
  await answer('❌ Вакансия отправлена в архив');
  await updateNotionStatus(pageId, 'Rejected');
  await editMarkup([[{ text: '❌ Отклонено пользователем', callback_data: 'noop:dismissed' }]]);
  return [{ json: { action: 'discarded', pageId } }];
}

// 3. Open Reject Reasons Menu: rej:<pageId>
if (data.startsWith('rej:')) {
  const pageId = data.slice(4).replace(/[^a-fA-F0-9]/g, '').toLowerCase();
  await answer('Выберите причину отклонения:');
  await editMarkup([
    [
      { text: '💸 Зарплата', callback_data: `rfb:sal:${pageId}` },
      { text: '🏢 Аутсорс', callback_data: `rfb:out:${pageId}` }
    ],
    [
      { text: '💀 Легаси', callback_data: `rfb:leg:${pageId}` },
      { text: '📍 Локация', callback_data: `rfb:loc:${pageId}` }
    ],
    [
      { text: '📉 Грейд', callback_data: `rfb:jun:${pageId}` },
      { text: '❌ Без причины', callback_data: `dsc:${pageId}` }
    ]
  ]);
  return [{ json: { action: 'reject_menu_opened', pageId } }];
}

// 4. Record Rejection Feedback: rfb:<code>:<pageId>
if (data.startsWith('rfb:')) {
  const parts = data.split(':');
  const code = parts[1] || 'gen';
  const pageId = (parts[2] || '').replace(/[^a-fA-F0-9]/g, '').toLowerCase();
  const label = REASONS[code] || 'В архив';

  await answer(`❌ Отклонено: ${label}`);
  await updateNotionStatus(pageId, 'Rejected');
  await updateNotionProperties(pageId, {
    'Human Verdict': { select: { name: 'Wrong – Should Reject' } },
    Reason: { rich_text: [{ text: { content: label } }] }
  });
  await editMarkup([[{ text: `❌ Отклонено: ${label}`, callback_data: 'noop:rejected' }]]);

  return [{ json: { action: 'feedback_saved', code, pageId } }];
}

// 5. Confirm Application Submitted: applied:<pageId>
if (data.startsWith('applied:')) {
  const pageId = data.slice(8).replace(/[^a-fA-F0-9]/g, '').toLowerCase();
  await answer('✅ Статус в Notion обновлён на Applied!');
  await updateNotionStatus(pageId, 'Applied');
  await editMarkup([[{ text: '✅ Отклик отправлен (Applied)', callback_data: 'noop:applied' }]]);
  return [{ json: { action: 'marked_applied', pageId } }];
}

// 6. Prepare Application Pitch & CV: app:<pageId> (WP-3.2)
if (data.startsWith('app:')) {
  const pageId = data.slice(4).replace(/[^a-fA-F0-9]/g, '').toLowerCase();
  await answer('🚀 Готовлю персонализированный питч и резюме...');

  const page = await fetchNotionPage(pageId);
  const props = page?.properties || {};
  const readRich = (p) => Array.isArray(p?.rich_text) ? p.rich_text.map(t => t.plain_text || '').join('') : '';
  const readTitle = (p) => Array.isArray(p?.title) ? p.title.map(t => t.plain_text || '').join('') : '';

  const firstLine = (rawText.split('\n')[0] || '').replace(/^(?:🔥|👀)\s*(?:\[[^\]]+\])?\s*/, '');
  const [fallbackTitle, fallbackCompany] = firstLine.split('@').map(s => (s || '').trim());

  const jobTitle = readTitle(props.Title || props.Name) || fallbackTitle || 'Senior Full-Stack Engineer';
  const company = readRich(props.Company) || fallbackCompany || 'Product Team';
  const jobUrl = props?.URL?.url || (rawText.match(/https?:\/\/[^\s\n]+/) || ['https://justjoin.it'])[0];
  const matchReason = readRich(props['Match Reason'] || props.Reason) || rawText;

  const isPolish = /\b(?:sp\.\s*z\s*o\.o|programista|projekt|zespół|doświadczenie)\b/i.test(rawText);
  const langInstruction = isPolish ? 'Polish (or English if international tech role)' : 'English';

  const pitchPrompt = [
    `Write a concise, high-impact, personalized outreach pitch / cover note (3-5 sentences, in ${langInstruction}) for Darya Shashko applying for "${jobTitle}" at "${company}".`,
    `Candidate background: Senior Forward Deployed & Full-Stack Engineer / Team Lead with 10 years of commercial JS/TS experience (TypeScript, React, Next.js, Node.js, NestJS, PostgreSQL, AI-assisted delivery, led a 6-engineer UI platform stream in FinTech and migrated core enterprise services from Java/MySQL to Node.js/PostgreSQL).`,
    `Job context & tasks from card:\n${rawText}\n${matchReason}`,
    `Rules: No clichés ("I am writing to express", "passionate"). Reference specific engineering tasks/stack of "${company}" and connect them to Darya's concrete production achievements. Output ONLY the ready-to-send pitch text without markdown fences.`
  ].join('\n\n');

  let generatedPitch = '';
  if (geminiApiKey) {
    try {
      const gemRes = await this.helpers.httpRequest({
        method: 'POST',
        url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${geminiApiKey}`,
        timeout: 20000,
        headers: { 'Content-Type': 'application/json' },
        body: { contents: [{ parts: [{ text: pitchPrompt }] }] },
        json: true
      });
      generatedPitch = (gemRes?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
    } catch (e) {}
  }
  if (!generatedPitch && openrouterApiKey) {
    try {
      const orRes = await this.helpers.httpRequest({
        method: 'POST',
        url: 'https://openrouter.ai/api/v1/chat/completions',
        timeout: 20000,
        headers: {
          'Authorization': `Bearer ${openrouterApiKey}`,
          'Content-Type': 'application/json'
        },
        body: {
          model: 'openrouter/free',
          messages: [{ role: 'user', content: pitchPrompt }]
        },
        json: true
      });
      generatedPitch = (orRes?.choices?.[0]?.message?.content || '').trim();
    } catch (e) {}
  }
  if (!generatedPitch) {
    generatedPitch = `Hi ${company} team! I'm reaching out regarding the ${jobTitle} role. Over the past 10 years in the TypeScript/React/Node.js ecosystem, I've led a 6-engineer UI & Full-Stack stream on an AI-integrated FinTech platform and drove a core backend migration from Java/MySQL to Node.js/PostgreSQL. I'm based in Gdańsk (EU/Poland B2B ready) and would love to discuss how my product engineering and architecture experience can help ${company} ship faster. Best regards, Darya Shashko`;
  }

  // Send CV document URL if configured, plus formatted HTML message with <pre><code> copyable pitch
  if ($env.CV_PDF_URL) {
    try {
      await this.helpers.httpRequest({
        method: 'POST',
        url: tgUrl('sendDocument'),
        body: {
          chat_id: chatId,
          message_thread_id: threadId,
          reply_to_message_id: messageId,
          document: $env.CV_PDF_URL,
          caption: `📄 Darya_Shashko_CV.pdf — ${company} (${jobTitle})`
        },
        json: true
      });
    } catch (e) {}
  }

  const replyHtml = [
    `🚀 <b>Пакет отклика готов:</b> <b>${escapeHtml(jobTitle)}</b> @ <b>${escapeHtml(company)}</b>`,
    `📄 <b>Резюме:</b> <code>Darya_Shashko_CV.pdf</code> (ATS Single-Column)`,
    '',
    '💬 <b>Персонализированный питч (тапните на блок для копирования):</b>',
    `<pre><code>${escapeHtml(generatedPitch)}</code></pre>`,
    '',
    '<i>Откройте форму вакансии, вставьте питч и прикрепите CV, затем нажмите «✅ Я отправила отклик», чтобы перевести статус в Notion в Applied.</i>'
  ].join('\n');

  const keyboard = [];
  if (jobUrl && /^https?:\/\//i.test(jobUrl)) {
    keyboard.push([{ text: '🔗 Открыть форму вакансии', url: jobUrl }]);
  }
  keyboard.push([{ text: '✅ Я отправила отклик', callback_data: `applied:${pageId}` }]);

  await this.helpers.httpRequest({
    method: 'POST',
    url: tgUrl('sendMessage'),
    body: {
      chat_id: chatId,
      message_thread_id: threadId,
      reply_to_message_id: messageId,
      text: replyHtml,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: keyboard }
    },
    json: true
  });

  return [{ json: { action: 'application_prepared', pageId, company, jobTitle } }];
}

return [{ json: { status: 'noop', data } }];
"""


def build_callback_workflow_payload(name: str = "Telegram Bot") -> dict:
    router_code = build_callback_router_code()
    return {
        "name": name,
        "nodes": [
            {
                "parameters": {
                    "httpMethod": "POST",
                    "path": "telegram-callback",
                    "responseMode": "responseNode",
                    "options": {},
                },
                "id": "cb-node-1-webhook",
                "name": "Webhook: Telegram Callback",
                "type": "n8n-nodes-base.webhook",
                "typeVersion": 2,
                "position": [250, 300],
                "webhookId": "telegram-callback-webhook",
            },
            {
                "parameters": {
                    "respondWith": "json",
                    "responseBody": '{"ok": true}',
                    "options": {},
                },
                "id": "cb-node-2-respond",
                "name": "Respond to Telegram: 200",
                "type": "n8n-nodes-base.respondToWebhook",
                "typeVersion": 1.1,
                "position": [480, 200],
            },
            {
                "parameters": {
                    "jsCode": router_code,
                },
                "id": "cb-node-3-router",
                "name": "Code: Route Telegram Callback",
                "type": "n8n-nodes-base.code",
                "typeVersion": 2,
                "position": [480, 400],
            },
        ],
        "connections": {
            "Webhook: Telegram Callback": {
                "main": [
                    [
                        {
                            "node": "Respond to Telegram: 200",
                            "type": "main",
                            "index": 0,
                        },
                        {
                            "node": "Code: Route Telegram Callback",
                            "type": "main",
                            "index": 0,
                        },
                    ]
                ]
            }
        },
        "settings": {
            "executionOrder": "v1",
        },
    }


def get_expected_ingest_nodes() -> dict:
    """Return expected code / jsonBody for all managed nodes in Ingest Jobs workflow."""
    return {
        "Code: Normalize Jobs": ("jsCode", build_normalize_jobs_code()),
        "Code: Dedup Batch": ("jsCode", build_dedup_batch_code()),
        "Code: Check Duplicate": ("jsCode", build_check_duplicate_code()),
        "Code: LLM Router": ("jsCode", build_llm_router_code()),
        "Code: Parse Ollama Response": ("jsCode", build_parse_ollama_code()),
        "Telegram: Send Alert": ("jsonBody", build_telegram_send_alert_json_body()),
        "Telegram: Send Review Alert": ("jsonBody", build_telegram_send_review_alert_json_body()),
        "Code: Prepare Digest": ("jsCode", build_prepare_digest_code()),
    }


def find_callback_workflow(all_workflows: list) -> dict | None:
    for preferred_name in CALLBACK_WORKFLOW_NAMES:
        for w in all_workflows:
            if w.get("name") == preferred_name:
                return w
    return None


def rewire_notion_profile_before_loop(wf: dict) -> bool:
    """Ensure Read Candidate Profile & Notion: Read Matching Criteria are cached/hoisted once per batch.

    If in the live workflow `IF: Already in Notion?` false-branch connects directly to
    `Read Candidate Profile -> Notion: Read Matching Criteria -> Code: Build Ollama Payload`,
    rewire `Code: Dedup Batch -> Read Candidate Profile -> Notion: Read Matching Criteria -> Split In Batches: 1`
    and `IF: Already in Notion?` (false) -> `Code: Build Ollama Payload` so Notion is queried once per batch.
    """
    connections = wf.get("connections", {})
    nodes_by_name = {n.get("name"): n for n in wf.get("nodes", [])}
    required = {
        "Code: Dedup Batch",
        "Split In Batches: 1",
        "IF: Already in Notion?",
        "Read Candidate Profile",
        "Notion: Read Matching Criteria",
        "Code: Build Ollama Payload",
    }
    if not required.issubset(nodes_by_name.keys()):
        return False

    if_already = connections.get("IF: Already in Notion?", {}).get("main", [])
    if len(if_already) < 2:
        return False

    false_branch = if_already[1]
    if not any(edge.get("node") == "Read Candidate Profile" for edge in false_branch):
        return False

    # Rewire:
    # 1. Code: Dedup Batch -> Read Candidate Profile
    connections["Code: Dedup Batch"] = {
        "main": [[{"node": "Read Candidate Profile", "type": "main", "index": 0}]]
    }
    # 2. Read Candidate Profile -> Notion: Read Matching Criteria
    connections["Read Candidate Profile"] = {
        "main": [[{"node": "Notion: Read Matching Criteria", "type": "main", "index": 0}]]
    }
    # 3. Notion: Read Matching Criteria -> Split In Batches: 1
    connections["Notion: Read Matching Criteria"] = {
        "main": [[{"node": "Split In Batches: 1", "type": "main", "index": 0}]]
    }
    # 4. IF: Already in Notion? (false branch) -> Code: Build Ollama Payload
    if_already[1] = [{"node": "Code: Build Ollama Payload", "type": "main", "index": 0}]

    # Ensure Read Candidate Profile and Notion: Read Matching Criteria have executeOnce=True
    for node_name in ("Read Candidate Profile", "Notion: Read Matching Criteria"):
        nodes_by_name[node_name]["executeOnce"] = True

    return True


def run_check_mode(headers: dict) -> None:
    verify_scoring_dist_freshness()
    expected_nodes = get_expected_ingest_nodes()

    # 1. Fetch all workflows
    list_req = urllib.request.Request(f"{BASE_URL}/api/v1/workflows?limit=100", headers=headers)
    with urllib.request.urlopen(list_req, timeout=30) as resp:
        all_wf = json.loads(resp.read().decode()).get("data", [])

    # 2. Fetch Ingest Jobs workflow
    req = urllib.request.Request(
        f"{BASE_URL}/api/v1/workflows/{INGEST_WORKFLOW_ID}", headers=headers
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        wf = json.loads(resp.read().decode())

    nodes_by_name = {n.get("name", ""): n for n in wf.get("nodes", [])}
    drifts = []

    for node_name, (param_key, expected_val) in expected_nodes.items():
        node = nodes_by_name.get(node_name)
        if node is None:
            drifts.append(f"Ingest Jobs: missing managed node '{node_name}'")
            continue
        actual_val = node.get("parameters", {}).get(param_key, "")
        if actual_val != expected_val:
            drifts.append(
                f"Ingest Jobs: node '{node_name}' ({param_key}) drifted from git "
                f"(expected {len(expected_val)} chars, live has {len(actual_val)} chars)"
            )

    # 3. Check callback workflow
    cb_summary = find_callback_workflow(all_wf)
    if cb_summary is None:
        drifts.append(
            f"Callback workflow not found in n8n (expected one of {CALLBACK_WORKFLOW_NAMES})"
        )
    else:
        cb_id = cb_summary.get("id")
        cb_req = urllib.request.Request(f"{BASE_URL}/api/v1/workflows/{cb_id}", headers=headers)
        with urllib.request.urlopen(cb_req, timeout=30) as resp:
            cb_wf = json.loads(resp.read().decode())

        if not cb_wf.get("active"):
            drifts.append(f"Callback workflow '{cb_wf.get('name')}' ({cb_id}) is inactive (active=false)")

        cb_nodes = {n.get("name", ""): n for n in cb_wf.get("nodes", [])}
        cb_router = cb_nodes.get("Code: Route Telegram Callback")
        expected_cb_code = build_callback_router_code()
        if cb_router is None:
            drifts.append(
                f"Callback workflow '{cb_wf.get('name')}': missing node 'Code: Route Telegram Callback'"
            )
        else:
            actual_cb_code = cb_router.get("parameters", {}).get("jsCode", "")
            if actual_cb_code != expected_cb_code:
                drifts.append(
                    f"Callback workflow '{cb_wf.get('name')}': 'Code: Route Telegram Callback' drifted from git "
                    f"(expected {len(expected_cb_code)} chars, live has {len(actual_cb_code)} chars)"
                )

    if drifts:
        print("FAIL: Live n8n workflow drift detected:")
        for d in drifts:
            print(f"  - {d}")
        print("\nRun 'cd n8n && npm run build && python3 scripts/patch-n8n-hitl-review.py' to sync.")
        sys.exit(1)

    print(
        f"OK: scoring.js is fresh and all {len(expected_nodes)} managed Ingest nodes + active Telegram callback workflow match git 100%."
    )


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        description="Patch or check live n8n Ingest Jobs and Telegram Bot callback workflows."
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Check scoring.js freshness and character-by-character parity with live n8n without mutating.",
    )
    args = parser.parse_args(argv)

    verify_scoring_dist_freshness()
    api_key = get_api_key()
    headers = {
        "X-N8N-API-KEY": api_key,
        "Content-Type": "application/json",
        "Accept": "application/json",
    }

    if args.check:
        run_check_mode(headers)
        return

    # 1. List all workflows
    print("\n--- All Workflows in n8n ---")
    list_req = urllib.request.Request(f"{BASE_URL}/api/v1/workflows?limit=100", headers=headers)
    with urllib.request.urlopen(list_req, timeout=30) as resp:
        all_wf = json.loads(resp.read().decode()).get("data", [])
    for w in all_wf:
        print(f"ID: {w.get('id')} | Name: {w.get('name')} | Active: {w.get('active')}")

    # 2. Inspect and patch Ingest Jobs workflow (88ajS2u1QcHuIa1r)
    req = urllib.request.Request(
        f"{BASE_URL}/api/v1/workflows/{INGEST_WORKFLOW_ID}", headers=headers
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        wf = json.loads(resp.read().decode())

    nodes = wf.get("nodes", [])
    patched_count = 0
    expected_nodes = get_expected_ingest_nodes()

    for node in nodes:
        name = node.get("name", "")
        if name in expected_nodes:
            param_key, expected_val = expected_nodes[name]
            params = node.setdefault("parameters", {})
            if name in ("Telegram: Send Alert", "Telegram: Send Review Alert"):
                params["method"] = "POST"
                params["url"] = "=https://api.telegram.org/bot{{ $env.TELEGRAM_BOT_TOKEN }}/sendMessage"
                params["sendBody"] = True
                params["specifyBody"] = "json"
            params[param_key] = expected_val
            patched_count += 1
            print(f"✅ Patched {name} ({param_key})")
        elif name in ("Read Candidate Profile", "Notion: Read Matching Criteria"):
            node["executeOnce"] = True

    if rewire_notion_profile_before_loop(wf):
        patched_count += 1
        print("✅ Hoisted Read Candidate Profile & Notion: Read Matching Criteria before Split In Batches: 1")

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

    # 3. Patch and activate Telegram Bot callback workflow (WP-3.1, WP-3.2, WP-3.3)
    cb_existing = find_callback_workflow(all_wf)
    if cb_existing:
        cb_id = cb_existing.get("id")
        cb_name = cb_existing.get("name") or "Telegram Bot"
        cb_payload = build_callback_workflow_payload(name=cb_name)
        put_cb = urllib.request.Request(
            f"{BASE_URL}/api/v1/workflows/{cb_id}",
            data=json.dumps(cb_payload).encode("utf-8"),
            headers=headers,
            method="PUT",
        )
        with urllib.request.urlopen(put_cb, timeout=30) as resp:
            print(f"✅ Patched callback workflow '{cb_name}' ({cb_id})! HTTP Status: {resp.status}")
    else:
        cb_name = "Telegram Bot"
        cb_payload = build_callback_workflow_payload(name=cb_name)
        post_cb = urllib.request.Request(
            f"{BASE_URL}/api/v1/workflows",
            data=json.dumps(cb_payload).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        with urllib.request.urlopen(post_cb, timeout=30) as resp:
            created_cb = json.loads(resp.read().decode())
            cb_id = created_cb.get("id")
            print(f"✅ Created callback workflow '{cb_name}' ({cb_id})! HTTP Status: {resp.status}")

    if cb_id:
        act_req = urllib.request.Request(
            f"{BASE_URL}/api/v1/workflows/{cb_id}/activate",
            data=b"{}",
            headers=headers,
            method="POST",
        )
        try:
            with urllib.request.urlopen(act_req, timeout=30) as resp:
                print(f"🎉 Callback workflow '{cb_name}' ({cb_id}) activated (active=true)! HTTP {resp.status}")
        except urllib.error.HTTPError as e:
            print(f"Notice activating '{cb_name}' ({cb_id}): HTTP {e.code}")

        # Trigger webhook registration with Telegram Bot API
        webhook_target = f"{BASE_URL}/webhook/telegram-callback"
        try:
            setup_req = urllib.request.Request(
                webhook_target,
                data=b'{"setup": true}',
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(setup_req, timeout=20) as resp:
                print(f"🎉 Registered Telegram callback webhook at {webhook_target} (HTTP {resp.status})")
        except Exception as e:
            print(f"Notice calling setup webhook {webhook_target}: {e}")


if __name__ == "__main__":
    main()
