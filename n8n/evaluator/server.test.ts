import * as http from "http";
import type { AddressInfo } from "net";
import { server } from "./server";
import { routeCompletion } from "./router";
import { evaluateJob } from "./scoring";

jest.mock("./router", () => ({ routeCompletion: jest.fn() }));
jest.mock("./scoring", () => ({ evaluateJob: jest.fn() }));

const mockedRouteCompletion = routeCompletion as jest.Mock;
const mockedEvaluateJob = evaluateJob as jest.Mock;

let baseUrl: string;

beforeAll((done) => {
  server.listen(0, () => {
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
    done();
  });
});

afterAll((done) => {
  server.close(done);
});

beforeEach(() => {
  mockedRouteCompletion.mockReset();
  mockedEvaluateJob.mockReset();
});

function request(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const req = http.request(
      `${baseUrl}${path}`,
      {
        method,
        headers: payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {},
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf-8");
          resolve({ status: res.statusCode ?? 0, json: raw ? JSON.parse(raw) : null });
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe("GET /healthz", () => {
  it("returns 200 ok without touching router/scoring", async () => {
    const { status, json } = await request("GET", "/healthz");
    expect(status).toBe(200);
    expect(json).toEqual({ status: "ok" });
    expect(mockedRouteCompletion).not.toHaveBeenCalled();
  });
});

describe("unknown routes", () => {
  it("returns 404 for an unmatched path", async () => {
    const { status, json } = await request("GET", "/nope");
    expect(status).toBe(404);
    expect(json).toEqual({ error: "Not found" });
  });
});

describe("POST /evaluate", () => {
  const validBody = {
    systemPrompt: "sys",
    userMessage: "user",
    outputSchema: { type: "object" },
    job: { id: "j1", url: "https://example.com/j1" },
  };

  it("returns 400 for malformed JSON", async () => {
    const { status, json } = await new Promise<{ status: number; json: unknown }>((resolve, reject) => {
      const req = http.request(`${baseUrl}/evaluate`, { method: "POST", headers: { "Content-Type": "application/json" } }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, json: JSON.parse(Buffer.concat(chunks).toString()) }));
      });
      req.on("error", reject);
      req.write("{not valid json");
      req.end();
    });
    expect(status).toBe(400);
    expect(json).toEqual({ error: "Malformed JSON body" });
  });

  it("returns 400 when a required field is missing", async () => {
    const { status, json } = await request("POST", "/evaluate", { systemPrompt: "sys" });
    expect(status).toBe(400);
    expect(json).toEqual({
      error: "Invalid request body — expected systemPrompt, userMessage, outputSchema, job",
    });
  });

  it("calls routeCompletion then evaluateJob and returns the evaluation result on success", async () => {
    mockedRouteCompletion.mockResolvedValue({ content: '{"overall_score":80}', provider: "openrouter" });
    mockedEvaluateJob.mockReturnValue({ id: "j1", overall_score: 80, match: true });

    const { status, json } = await request("POST", "/evaluate", validBody);

    expect(status).toBe(200);
    expect(json).toEqual({ id: "j1", overall_score: 80, match: true });
    expect(mockedRouteCompletion).toHaveBeenCalledWith({
      systemPrompt: "sys",
      userMessage: "user",
      outputSchema: { type: "object" },
    });
    expect(mockedEvaluateJob).toHaveBeenCalledWith('{"overall_score":80}', validBody.job);
  });

  it("returns 502 with the error message when every provider fails", async () => {
    mockedRouteCompletion.mockRejectedValue(new Error("All providers failed:\nopenrouter: down\ngemini: down"));

    const { status, json } = await request("POST", "/evaluate", validBody);

    expect(status).toBe(502);
    expect(json).toEqual({ error: "All providers failed:\nopenrouter: down\ngemini: down" });
    expect(mockedEvaluateJob).not.toHaveBeenCalled();
  });
});
