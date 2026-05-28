#!/usr/bin/env python3
"""
P12-6: Replace HTTP Request: Ask Ollama with Code: LLM Router
Run from project root: python3 scripts/p12_6_llm_router.py
"""
import json
import sys

WORKFLOW_PATH = 'n8n/workflows/ingest.json'

LLM_ROUTER_CODE = r"""// LLM Router — provider-agnostic LLM call
// Configure env vars via n8n Settings → Variables (NOT host .env):
//   LLM_PROVIDER : "ollama" | "gemini" | "anthropic"  (default: "ollama")
//   LLM_API_KEY  : API key for Gemini / Anthropic     (default: "")
//   LLM_MODEL    : model name                         (default: provider-specific)
//   LLM_BASE_URL : Ollama base URL                    (default: "http://localhost:11434")

const provider  = ($env.LLM_PROVIDER  || 'ollama').toLowerCase();
const apiKey    = $env.LLM_API_KEY    || '';
const baseUrl   = $env.LLM_BASE_URL   || 'http://localhost:11434';

const systemPrompt = $json.systemPrompt || '';
const userMessage  = $json.userMessage  || '';

// JSON Schema for structured output
const outputSchema = {
  type: 'object',
  properties: {
    overall_score:    { type: 'integer' },
    tech_stack_match: { type: 'integer' },
    seniority_match:  { type: 'integer' },
    red_flags:        { type: 'array', items: { type: 'string' } },
    reason:           { type: 'string' },
    url:              { type: 'string' }
  },
  required: ['overall_score', 'tech_stack_match', 'seniority_match', 'red_flags', 'reason', 'url']
};

// Timeout: 300 s for Ollama (local model), 60 s for cloud providers
const timeoutMs = provider === 'ollama' ? 300000 : 60000;
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

let response;
try {
  if (provider === 'ollama') {
    const model = $env.LLM_MODEL || 'llama3.1:latest';
    response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        stream: false,
        keep_alive: 0,
        format: outputSchema,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userMessage  }
        ]
      })
    });
  } else if (provider === 'gemini') {
    const model = $env.LLM_MODEL || 'gemini-2.0-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userMessage }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: outputSchema
        }
      })
    });
  } else if (provider === 'anthropic') {
    const model = $env.LLM_MODEL || 'claude-haiku-4-5';
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
        tools: [{
          name: 'structured_output',
          description: 'Return evaluation result',
          input_schema: outputSchema
        }],
        tool_choice: { type: 'tool', name: 'structured_output' }
      })
    });
  } else {
    throw new Error(`Unknown LLM_PROVIDER: "${provider}". Supported: "ollama", "gemini", "anthropic".`);
  }
} finally {
  clearTimeout(timeoutId);
}

if (!response.ok) {
  const errText = await response.text().catch(() => '');
  throw new Error(`LLM request failed (${provider}): ${response.status} ${response.statusText} — ${errText}`);
}

const data = await response.json();
let content;

if (provider === 'ollama') {
  content = data?.message?.content;
  if (typeof content !== 'string') {
    throw new Error(`Unexpected Ollama response shape: ${JSON.stringify(data)}`);
  }
} else if (provider === 'gemini') {
  content = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof content !== 'string') {
    throw new Error(`Unexpected Gemini response shape: ${JSON.stringify(data)}`);
  }
} else if (provider === 'anthropic') {
  const block = data?.content?.[0];
  if (!block || block.type !== 'tool_use') {
    throw new Error(`Expected tool_use block, got: ${JSON.stringify(data?.content?.[0])}`);
  }
  content = JSON.stringify(block.input);
}

// Return in Ollama-compatible shape — downstream "Code: Parse Ollama Response" reads message.content
return [{ json: { message: { content } } }];"""

NEW_BUILD_PAYLOAD_RETURN = """return [{
  json: {
    ...job,
    systemPrompt,
    userMessage: userContent
  }
}];"""


def main():
    with open(WORKFLOW_PATH, 'r', encoding='utf-8') as f:
        workflow = json.load(f)

    build_payload_updated = False
    ask_ollama_replaced = False

    for i, node in enumerate(workflow['nodes']):
        # ── 1. Update Code: Build Ollama Payload ───────────────────────────
        if node['name'] == 'Code: Build Ollama Payload':
            old_code = node['parameters']['jsCode']
            return_idx = old_code.rfind('return [{')
            if return_idx < 0:
                print('ERROR: Could not find return statement in Build Ollama Payload', file=sys.stderr)
                sys.exit(1)
            new_code = old_code[:return_idx] + NEW_BUILD_PAYLOAD_RETURN
            workflow['nodes'][i]['parameters']['jsCode'] = new_code
            build_payload_updated = True
            print('✓ Updated Code: Build Ollama Payload (removed ollamaBody + assistant prefill)')

        # ── 2. Replace HTTP Request: Ask Ollama with Code: LLM Router ──────
        elif node['name'] == 'HTTP Request: Ask Ollama':
            original_position = node['position']
            workflow['nodes'][i] = {
                "parameters": {
                    "jsCode": LLM_ROUTER_CODE
                },
                "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
                "name": "Code: LLM Router",
                "type": "n8n-nodes-base.code",
                "typeVersion": 2,
                "position": original_position,
                "onError": "continueRegularOutput"
            }
            ask_ollama_replaced = True
            print('✓ Replaced HTTP Request: Ask Ollama with Code: LLM Router')

    if not build_payload_updated:
        print('ERROR: Node "Code: Build Ollama Payload" not found', file=sys.stderr)
        sys.exit(1)
    if not ask_ollama_replaced:
        print('ERROR: Node "HTTP Request: Ask Ollama" not found', file=sys.stderr)
        sys.exit(1)

    # ── 3. Update connections ───────────────────────────────────────────────
    connections = workflow['connections']

    # Build Ollama Payload → LLM Router (was → Ask Ollama)
    if 'Code: Build Ollama Payload' in connections:
        for conn_list in connections['Code: Build Ollama Payload']['main']:
            for conn in conn_list:
                if conn['node'] == 'HTTP Request: Ask Ollama':
                    conn['node'] = 'Code: LLM Router'
                    print('✓ Updated connection: Build Ollama Payload → Code: LLM Router')

    # Rename connection key HTTP Request: Ask Ollama → Code: LLM Router
    if 'HTTP Request: Ask Ollama' in connections:
        connections['Code: LLM Router'] = connections.pop('HTTP Request: Ask Ollama')
        print('✓ Renamed connection key: HTTP Request: Ask Ollama → Code: LLM Router')

    with open(WORKFLOW_PATH, 'w', encoding='utf-8') as f:
        json.dump(workflow, f, indent=2, ensure_ascii=False)

    print(f'\nDone — {WORKFLOW_PATH} updated.')


if __name__ == '__main__':
    main()
