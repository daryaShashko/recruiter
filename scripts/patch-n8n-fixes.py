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
        
        # A. Remove Stack: Legacy/Non-JS from CRITICAL_FLAGS
        js = js.replace(
            '"Stack: Legacy/Non-JS",\n];',
            '];'
        )
        js = js.replace(
            '"Stack: Legacy/Non-JS",\n];',
            '];'
        )
        
        # B. Ensure helper matchesKeywordWordBoundary ignores cryptography
        helper_fn = """function matchesKeywordWordBoundary(text, keyword) {
    if (keyword === "crypto" && /\\bcryptograph(?:y|ic|ical)?\\b/i.test(text)) {
        const stripped = text.replace(/\\bcryptograph(?:y|ic|ical)?\\b/gi, "");
        return /\\bcrypto(?:currency|currencies)?\\b/i.test(stripped);
    }
    const escaped = keyword.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&");
    const pattern = new RegExp(`\\\\b${escaped}(?:s|es)?\\\\b`, "i");
    return pattern.test(text);
}
"""
        if "function matchesKeywordWordBoundary" in js:
            idx1 = js.find("function matchesKeywordWordBoundary")
            idx2 = js.find("function mentionsNonJsLanguage")
            if idx1 != -1 and idx2 != -1:
                js = js[:idx1] + helper_fn.strip() + "\n\n" + js[idx2:]
        else:
            js = js.replace(
                "function mentionsNonJsLanguage(text) {",
                helper_fn + "\nfunction mentionsNonJsLanguage(text) {"
            )

        # C. Replace isAgency check
        old_agency = 'jobBodyLower.includes("for our client")'
        new_agency = 'jobBodyLower.includes("working for our client") || jobBodyLower.includes("on behalf of our client")'
        if old_agency in js:
            js = js.replace(old_agency, new_agency)

        # D. Add cap at 75 for Stack: Legacy/Non-JS if overallScore >= 80
        cap_code = """  const uniqueRedFlags = Array.from(new Set(redFlags));
  if (uniqueRedFlags.includes("Stack: Legacy/Non-JS") && overallScore >= 80) {
    overallScore = 75;
  }
  if (uniqueRedFlags.some((f) => CRITICAL_FLAGS.includes(f))) {"""
        if 'if (uniqueRedFlags.includes("Stack: Legacy/Non-JS") && overallScore >= 80)' not in js:
            js = js.replace(
                'const uniqueRedFlags = Array.from(new Set(redFlags));\n    if (uniqueRedFlags.some((f) => CRITICAL_FLAGS.includes(f))) {',
                cap_code
            )

        node["parameters"]["jsCode"] = js
        print("Patched Code: Parse Ollama Response with non-JS review policy & crypto refinement")

# 3. Patch Code: Check Duplicate
check_dup_code = """const resp = $input.first().json;
const job = $('Split In Batches: 1').item.json;

const results = Array.isArray(resp.results) ? resp.results : [];
let isDuplicate = false;

for (const match of results) {
  const score = match?.properties?.Score?.number;
  // If previously scored 0 or null from an error or failed batch, allow clean re-evaluation
  if (score === 0 || score === null || score === undefined) {
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

for node in nodes:
    if node.get("name") == "Code: Check Duplicate":
        node["parameters"]["jsCode"] = check_dup_code
        print("Patched Code: Check Duplicate successfully")

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
