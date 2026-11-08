import os
import json
import urllib.request

KEY_PATH = os.path.expanduser("~/.n8n-recruiter-key")
WORKFLOW_ID = "88ajS2u1QcHuIa1r"
BASE_URL = "https://n8n-recruiter.duckdns.org"

with open(KEY_PATH) as f:
    api_key = f.read().strip()

headers = {
    "X-N8N-API-KEY": api_key,
    "Content-Type": "application/json"
}

# 1. Fetch current workflow
req = urllib.request.Request(f"{BASE_URL}/api/v1/workflows/{WORKFLOW_ID}", headers=headers)
with urllib.request.urlopen(req) as resp:
    wf = json.loads(resp.read().decode())

nodes = wf.get("nodes", [])

# 2. Patch Code: Parse Ollama Response
for node in nodes:
    if node.get("name") == "Code: Parse Ollama Response":
        js = node["parameters"]["jsCode"]
        
        # Add helper function if not present
        helper_fn = """function matchesKeywordWordBoundary(text, keyword) {
    const escaped = keyword.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&");
    const pattern = new RegExp(`\\\\b${escaped}(?:s|es)?\\\\b`, "i");
    return pattern.test(text);
}
"""
        if "matchesKeywordWordBoundary" not in js:
            # Place after mentionsNonJsLanguage or at top of evaluateJob
            js = js.replace(
                "function mentionsNonJsLanguage(text) {",
                helper_fn + "\nfunction mentionsNonJsLanguage(text) {"
            )
            
            # Replace isCrypto check
            js = js.replace(
                "const isCrypto = cryptoKeywords.some((k) => jobTitleLower.includes(k) || jobBodyLower.includes(k));",
                "const isCrypto = cryptoKeywords.some((k) => matchesKeywordWordBoundary(jobTitleLower, k) || matchesKeywordWordBoundary(jobBodyLower, k));"
            )
            
            # Replace isGambling check
            js = js.replace(
                "const isGambling = gamblingKeywords.some((k) => jobTitleLower.includes(k) || jobBodyLower.includes(k));",
                "const isGambling = gamblingKeywords.some((k) => matchesKeywordWordBoundary(jobTitleLower, k) || matchesKeywordWordBoundary(jobBodyLower, k));"
            )
            node["parameters"]["jsCode"] = js
            print("Patched Code: Parse Ollama Response successfully")
        else:
            print("Code: Parse Ollama Response already has matchesKeywordWordBoundary")

# 3. Patch Code: Prepare Digest
new_digest_code = """let totalReceived = 0;
try {
  totalReceived = $('Code: Normalize Jobs').all().length;
} catch (e) {}

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
    duplicatesCount,
    evaluatedCount: evaluatedJobs.length,
    hotCount: hotMatches.length,
    reviewCount: reviews.length,
    rejectedCount: rejected.length,
    digestText: text
  }
}];
"""

for node in nodes:
    if node.get("name") == "Code: Prepare Digest":
        node["parameters"]["jsCode"] = new_digest_code
        print("Patched Code: Prepare Digest successfully")

# 4. Upload updated workflow
payload = {
    "name": wf.get("name"),
    "nodes": nodes,
    "connections": wf.get("connections", {}),
    "settings": wf.get("settings", {})
}

put_req = urllib.request.Request(
    f"{BASE_URL}/api/v1/workflows/{WORKFLOW_ID}",
    data=json.dumps(payload).encode("utf-8"),
    headers=headers,
    method="PUT"
)

with urllib.request.urlopen(put_req) as resp:
    print(f"Workflow updated successfully! HTTP Status: {resp.status}")
