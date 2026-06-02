#!/usr/bin/env python3
"""Replaces fetch() with this.helpers.httpRequest() in Code: LLM Router node."""

import json
import sys

WORKFLOW = "n8n/workflows/ingest.json"

NEW_CODE = """\
// LLM Router — uses this.helpers.httpRequest (fetch not available in n8n sandbox)
// To switch provider: edit const provider / apiKey / model directly.

const provider  = 'gemini';
const apiKey    = 'PASTE_YOUR_GEMINI_API_KEY_HERE';
const baseUrl   = 'http://localhost:11434'; // unused for gemini

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

let content;

try {
  if (provider === 'ollama') {
    const model = 'llama3.1:latest';
    const data = await this.helpers.httpRequest({
      method: 'POST',
      url: `${baseUrl}/api/chat`,
      headers: { 'Content-Type': 'application/json' },
      body: {
        model,
        stream: false,
        keep_alive: 0,
        format: outputSchema,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userMessage  }
        ]
      },
      json: true
    });
    content = data?.message?.content;
    if (typeof content !== 'string') {
      throw new Error(`Unexpected Ollama response shape: ${JSON.stringify(data)}`);
    }

  } else if (provider === 'gemini') {
    const model = 'gemini-2.0-flash';
    const data = await this.helpers.httpRequest({
      method: 'POST',
      url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      headers: { 'Content-Type': 'application/json' },
      body: {
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userMessage }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: outputSchema
        }
      },
      json: true
    });
    content = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof content !== 'string') {
      throw new Error(`Unexpected Gemini response shape: ${JSON.stringify(data)}`);
    }

  } else if (provider === 'anthropic') {
    const model = 'claude-haiku-4-5';
    const data = await this.helpers.httpRequest({
      method: 'POST',
      url: 'https://api.anthropic.com/v1/messages',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: {
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
      },
      json: true
    });
    const block = data?.content?.[0];
    if (!block || block.type !== 'tool_use') {
      throw new Error(`Expected tool_use block, got: ${JSON.stringify(data?.content?.[0])}`);
    }
    content = JSON.stringify(block.input);

  } else {
    throw new Error(`Unknown provider: "${provider}". Supported: "ollama", "gemini", "anthropic".`);
  }
} catch (err) {
  throw err;
}

// Return in Ollama-compatible shape — downstream "Code: Parse Ollama Response" reads message.content
return [{ json: { message: { content } } }];\
"""

with open(WORKFLOW, "r", encoding="utf-8") as f:
    workflow = json.load(f)

patched = False
for node in workflow.get("nodes", []):
    if node.get("name") == "Code: LLM Router":
        old = node["parameters"]["jsCode"]
        if "this.helpers.httpRequest" in old:
            print("Already patched — nothing to do.")
            sys.exit(0)
        node["parameters"]["jsCode"] = NEW_CODE
        patched = True
        break

if not patched:
    print('ERROR: node "Code: LLM Router" not found', file=sys.stderr)
    sys.exit(1)

with open(WORKFLOW, "w", encoding="utf-8") as f:
    json.dump(workflow, f, ensure_ascii=False, indent=2)

print("OK: Code: LLM Router patched — fetch → this.helpers.httpRequest")
