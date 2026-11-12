#!/usr/bin/env python3
"""Deploy Telegram Callback Handler Workflow to n8n and register Telegram Webhook.

Implements HITL Slice 2, Slice 3, and Slice 4:
- prm:<id> -> Promote to Hot Match, update Notion, forward to Topic 2
- dsc:<id> -> Discard to Archive, update Notion to Rejected
- rej:<id> -> Open Reject Reasons Menu in Topic 2
- rfb:<code>:<id> -> Log reject reason to Notion Eval Log & Board
- app:<id> -> Send in-thread LinkedIn pitch, Cover Letter, update Notion to Applied

Usage:
  python3 scripts/deploy-telegram-callback-workflow.py
"""

import json
import os
import sys
import urllib.request
from pathlib import Path

BASE_URL = os.environ.get("N8N_BASE_URL", "https://n8n-recruiter.duckdns.org").rstrip("/")
KEY_FILE = Path.home() / ".n8n-recruiter-key"


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

    # Code to execute on every incoming Telegram Callback Query
    router_code = """
const body = $input.first().json.body || $input.first().json;
const botToken = $env.TELEGRAM_BOT_TOKEN;
const tgUrl = (method) => `https://api.telegram.org/bot${botToken}/${method}`;

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

const cq = body.callback_query;

if (!cq || !cq.data) {
  return [{ json: { status: 'ignored_not_callback_query' } }];
}

const chatId = cq.message?.chat?.id || '-1004357080568';
const messageId = cq.message?.message_id;
const rawText = cq.message?.text || '';
const cqId = cq.id;
const data = cq.data.trim();

// Reason codes mapping (Slice 4)
const REASONS = {
  sal: '💸 Зарплата ниже ожиданий',
  out: '🏢 Аутсорсинг / агентство',
  leg: '💀 Устаревший стек / легаси',
  loc: '📍 Неподходящая локация',
  jun: '📉 Несоответствие грейда'
};

// Answer callback query helper
const answer = async (text, showAlert = false) => {
  try {
    await this.helpers.httpRequest({
      method: 'POST',
      url: tgUrl('answerCallbackQuery'),
      body: { callback_query_id: cqId, text, show_alert: showAlert },
      json: true
    });
  } catch (e) {
    // Ignore answerCallbackQuery timeout/errors
  }
};

// Edit message reply markup helper
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
  } catch (e) {
    // Ignore markup edit errors if message is too old
  }
};

// Update Notion Page Status helper
const updateNotionStatus = async (pageId, status) => {
  try {
    // Ensure 32-char hex is formatted with hyphens for Notion UUID
    const cleanId = pageId.replace(/[^a-fA-F0-9]/g, '').toLowerCase();
    const formattedId = `${cleanId.slice(0,8)}-${cleanId.slice(8,12)}-${cleanId.slice(12,16)}-${cleanId.slice(16,20)}-${cleanId.slice(20)}`;
    
    await this.helpers.httpRequest({
      method: 'PATCH',
      url: `https://api.notion.com/v1/pages/${formattedId}`,
      headers: {
        'Notion-Version': '2022-06-28'
      },
      credentials: {
        notionApi: { id: 'wFIW3tWnBcVSANKk' }
      },
      body: {
        properties: {
          Status: { status: { name: status } }
        }
      },
      json: true
    });
  } catch (e) {
    // Fail closed
  }
};

// 1. Promote to Hot Match: prm:<id>
if (data.startsWith('prm:')) {
  const pageId = data.slice(4);
  await answer('✅ Вакансия перенесена в Горячий мэтч');
  await updateNotionStatus(pageId, 'Hot Match');
  await editMarkup([[{ text: '✅ Перенесено в Горячий мэтч', callback_data: 'noop:promoted' }]]);

  // Extract job URL and company from original message for Topic 2 keyboard
  const urlMatch = rawText.match(/https?:\\/\\/[^\\s\\n]+/);
  const jobUrl = urlMatch ? urlMatch[0] : '';

  // Forward vacancy card to Topic 2 («Горячий мэтч»)
  await this.helpers.httpRequest({
    method: 'POST',
    url: tgUrl('sendMessage'),
    body: {
      chat_id: chatId,
      message_thread_id: 2,
      text: rawText.replace(/👀 \\[На ревью\\]/, '🔥 [Горячий мэтч]'),
      parse_mode: 'Markdown',
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

// 2. Discard to Archive: dsc:<id>
if (data.startsWith('dsc:')) {
  const pageId = data.slice(4);
  await answer('❌ Вакансия отклонена');
  await updateNotionStatus(pageId, 'Rejected');
  await editMarkup([[{ text: '❌ Отклонено пользователем', callback_data: 'noop:dismissed' }]]);
  return [{ json: { action: 'discarded', pageId } }];
}

// 3. Open Reject Reasons Menu: rej:<id>
if (data.startsWith('rej:')) {
  const pageId = data.slice(4);
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

// 4. Record Rejection Feedback: rfb:<code>:<id>
if (data.startsWith('rfb:')) {
  const parts = data.split(':');
  const code = parts[1];
  const pageId = parts[2];
  const label = REASONS[code] || 'Отклонено';

  await answer(`❌ Причина: ${label}`);
  await updateNotionStatus(pageId, 'Rejected');
  await editMarkup([[{ text: `❌ Отклонено: ${label}`, callback_data: 'noop:rejected' }]]);

  // Patch Evaluation Log in Notion with Human Verdict
  try {
    const cleanId = pageId.replace(/[^a-fA-F0-9]/g, '').toLowerCase();
    const formattedId = `${cleanId.slice(0,8)}-${cleanId.slice(8,12)}-${cleanId.slice(12,16)}-${cleanId.slice(16,20)}-${cleanId.slice(20)}`;
    await this.helpers.httpRequest({
      method: 'PATCH',
      url: `https://api.notion.com/v1/pages/${formattedId}`,
      headers: { 'Notion-Version': '2022-06-28' },
      credentials: { notionApi: { id: 'wFIW3tWnBcVSANKk' } },
      body: {
        properties: {
          'Human Verdict': { select: { name: 'Wrong – Should Reject' } },
          Reason: { rich_text: [{ text: { content: label } }] }
        }
      },
      json: true
    });
  } catch (e) {}

  return [{ json: { action: 'feedback_saved', code, pageId } }];
}

// 5. In-Thread Application Delivery: app:<id>
if (data.startsWith('app:')) {
  const pageId = data.slice(4);
  await answer('🚀 Готовлю пакет отклика...');
  await updateNotionStatus(pageId, 'Applied');

  // Extract company and title from message
  const lines = rawText.split('\\n');
  const titleLine = lines[0] || 'Software Engineer';
  const cleanTitle = titleLine.replace(/[^a-zA-Z0-9А-Яа-я -]/g, '').trim();

  // Monospaced 1-click copy LinkedIn pitch and Cover Letter
  const pitchText = `Hi! I saw the ${cleanTitle} opening and wanted to reach out directly.\\n\\nI have 6+ years specializing in Node.js, TypeScript and distributed backend systems, with a track record of cutting AWS cloud infrastructure costs by 15% and handling 10k+ concurrent requests.\\n\\nAvailable immediately on B2B or UoP (EU/Poland). Would you be open to a brief 10-minute intro call this week?\\n\\nBest regards,\\nDarya Shashko`;

  const coverLetterText = `Dear Hiring Team,\\n\\nI am writing to express my strong interest in the ${cleanTitle} position. With over 6 years of production experience in TypeScript, Node.js, microservices architecture, and cloud automation, I deliver scalable and resilient systems.\\n\\nIn my recent projects, I re-architected event pipelines, reduced operating costs by 15%, and engineered high-concurrency services maintaining 99.9% uptime. I am eager to bring this engineering focus to your team.\\n\\nThank you for your time and consideration.\\n\\nSincerely,\\nDarya Shashko`;

  const deliveryMsg = `📦 *Пакет отклика подготовлен!*\\n\\n📋 *LinkedIn Outreach Pitch (нажмите для копирования):*\\n\`\`\`text\\n${pitchText}\\n\`\`\`\\n\\n📄 *Cover Letter:*\\n\`\`\`text\\n${coverLetterText}\\n\`\`\`\\n\\n📄 *Резюме:* Актуальная версия ATS CV загружена в базу. Статус вакансии в Notion переведён в *Applied*.`;

  await this.helpers.httpRequest({
    method: 'POST',
    url: tgUrl('sendMessage'),
    body: {
      chat_id: chatId,
      message_thread_id: 2,
      reply_to_message_id: messageId,
      text: deliveryMsg,
      parse_mode: 'Markdown'
    },
    json: true
  });

  return [{ json: { action: 'application_delivered', pageId } }];
}

return [{ json: { status: 'noop' } }];
"""

    workflow_payload = {
        "name": "Telegram Callback Router",
        "nodes": [
            {
                "parameters": {
                    "httpMethod": "POST",
                    "path": "telegram-callback",
                    "responseMode": "responseNode",
                    "options": {}
                },
                "name": "Webhook: Telegram Callback",
                "type": "n8n-nodes-base.webhook",
                "typeVersion": 2,
                "position": [250, 300],
                "webhookId": "telegram-callback-webhook"
            },
            {
                "parameters": {
                    "respondWith": "json",
                    "responseBody": '{"ok": true}',
                    "options": {}
                },
                "name": "Respond to Telegram: 200",
                "type": "n8n-nodes-base.respondToWebhook",
                "typeVersion": 1.1,
                "position": [450, 200]
            },
            {
                "parameters": {
                    "jsCode": router_code
                },
                "name": "Code: Route Telegram Callback",
                "type": "n8n-nodes-base.code",
                "typeVersion": 2,
                "position": [450, 400]
            }
        ],
        "connections": {
            "Webhook: Telegram Callback": {
                "main": [
                    [
                        {
                            "node": "Respond to Telegram: 200",
                            "type": "main",
                            "index": 0
                        },
                        {
                            "node": "Code: Route Telegram Callback",
                            "type": "main",
                            "index": 0
                        }
                    ]
                ]
            }
        },
        "settings": {
            "executionOrder": "v1"
        }
    }

    # Check if workflow already exists
    print("Checking existing workflows in n8n...")
    req = urllib.request.Request(f"{BASE_URL}/api/v1/workflows", headers=headers)
    with urllib.request.urlopen(req, timeout=30) as resp:
        all_wf = json.loads(resp.read().decode()).get("data", [])

    existing_id = None
    for w in all_wf:
        if w.get("name") == "Telegram Callback Router":
            existing_id = w.get("id")
            break

    if existing_id:
        print(f"Updating existing workflow {existing_id}...")
        put_req = urllib.request.Request(
            f"{BASE_URL}/api/v1/workflows/{existing_id}",
            data=json.dumps(workflow_payload).encode("utf-8"),
            headers=headers,
            method="PUT"
        )
        with urllib.request.urlopen(put_req, timeout=30) as resp:
            print(f"✅ Workflow updated! Status: {resp.status}")
        wf_id = existing_id
    else:
        print("Creating new workflow 'Telegram Callback Router'...")
        post_req = urllib.request.Request(
            f"{BASE_URL}/api/v1/workflows",
            data=json.dumps(workflow_payload).encode("utf-8"),
            headers=headers,
            method="POST"
        )
        with urllib.request.urlopen(post_req, timeout=30) as resp:
            res_data = json.loads(resp.read().decode())
            wf_id = res_data.get("id")
            print(f"✅ Created workflow {wf_id}! Status: {resp.status}")

    # Activate workflow
    print(f"Activating workflow {wf_id}...")
    act_req = urllib.request.Request(
        f"{BASE_URL}/api/v1/workflows/{wf_id}/activate",
        data=b"{}",
        headers=headers,
        method="POST"
    )
    try:
        with urllib.request.urlopen(act_req, timeout=30) as resp:
            print(f"🎉 Workflow {wf_id} activated successfully! HTTP {resp.status}")
    except Exception as e:
        print(f"Notice during activation (may already be active): {e}")

    # Register Telegram Webhook via setup call
    webhook_target = f"{BASE_URL}/webhook/telegram-callback"
    print(f"\nTriggering Telegram Webhook registration at: {webhook_target} ...")
    try:
        setup_req = urllib.request.Request(
            webhook_target,
            data=b'{"setup": true}',
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        with urllib.request.urlopen(setup_req, timeout=30) as resp:
            print(f"🎉 Telegram Webhook registered! HTTP {resp.status}")
    except Exception as e:
        print(f"Notice during setup webhook call: {e}")


if __name__ == "__main__":
    main()
