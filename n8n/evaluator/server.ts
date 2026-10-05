/**
 * Minimal HTTP wrapper around router.ts + scoring.ts.
 *
 * Why HTTP instead of a direct import from the n8n Code node (ADR-019): the deployed
 * n8n is the stock docker.n8n.io/n8nio/n8n image (see n8n/docker-compose.yml) with no
 * NODE_FUNCTION_ALLOW_EXTERNAL set, so a Code node cannot require() an arbitrary local
 * TS/JS module — doing that would mean building and maintaining a custom n8n Docker
 * image instead. Running this as a tiny, independent Node process on the same VM is
 * cheaper and simpler: no custom image, no rebuild-on-change, and the only change to
 * the live n8n workflow is pointing one HTTP Request node at this service's URL.
 *
 * No framework dependency on purpose — this is a single endpoint.
 */

import * as http from "http";
import { routeCompletion } from "./router";
import { evaluateJob, JobForScoring } from "./scoring";

const PORT = Number(process.env["EVALUATOR_PORT"] ?? 3100);

interface EvaluateRequestBody {
  readonly systemPrompt: string;
  readonly userMessage: string;
  readonly outputSchema: object;
  readonly job: JobForScoring;
}

function isEvaluateRequestBody(value: unknown): value is EvaluateRequestBody {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["systemPrompt"] === "string" &&
    typeof v["userMessage"] === "string" &&
    typeof v["outputSchema"] === "object" &&
    v["outputSchema"] !== null &&
    typeof v["job"] === "object" &&
    v["job"] !== null
  );
}

function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf-8");
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function handleEvaluate(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: "Malformed JSON body" });
    return;
  }

  if (!isEvaluateRequestBody(body)) {
    sendJson(res, 400, { error: "Invalid request body — expected systemPrompt, userMessage, outputSchema, job" });
    return;
  }

  try {
    const { content, provider } = await routeCompletion({
      systemPrompt: body.systemPrompt,
      userMessage: body.userMessage,
      outputSchema: body.outputSchema,
    });
    const result = evaluateJob(content, body.job);
    console.log(`[evaluator] ${body.job.id ?? "?"} -> score=${result.overall_score} via ${provider}`);
    sendJson(res, 200, result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[evaluator] /evaluate failed:", message);
    sendJson(res, 502, { error: message });
  }
}

export const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/healthz") {
    sendJson(res, 200, { status: "ok" });
    return;
  }

  if (req.method === "POST" && req.url === "/evaluate") {
    void handleEvaluate(req, res);
    return;
  }

  sendJson(res, 404, { error: "Not found" });
});

/* eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- require.main is undefined under ts-jest/ESM tooling */
if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`[evaluator] listening on :${PORT}`);
  });
}
