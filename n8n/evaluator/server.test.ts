import { EventEmitter } from "events";
import * as http from "http";
import type { AddressInfo } from "net";
import { server } from "./server";
import { routeCompletion } from "./router";
import { evaluateJob } from "./scoring";
import {
  getActiveControlPlaneConfig,
  invalidateControlPlaneCache,
  type DynamicScoringConfig,
} from "./notion-profile";

jest.mock("./router", () => ({ routeCompletion: jest.fn() }));
jest.mock("./scoring", () => ({ evaluateJob: jest.fn() }));
jest.mock("./notion-profile", () => ({
  getActiveControlPlaneConfig: jest.fn(),
  invalidateControlPlaneCache: jest.fn(),
}));

const mockedRouteCompletion = routeCompletion as jest.Mock;
const mockedEvaluateJob = evaluateJob as jest.Mock;
const mockedGetActiveControlPlaneConfig = getActiveControlPlaneConfig as jest.Mock;
const mockedInvalidateControlPlaneCache = invalidateControlPlaneCache as jest.Mock;

const mockScoringConfig: DynamicScoringConfig = {
  cryptoKeywords: ["crypto"],
  gamblingKeywords: ["gambling"],
  outsourcingKeywords: ["epam"],
  tricityKeywords: ["gdansk"],
  minB2bPlnFloor: 22000,
};

let baseUrl: string | null = null;

beforeAll((done) => {
  const onError = (err: NodeJS.ErrnoException) => {
    if (err.code === "EPERM" || err.code === "EACCES") {
      // Sandbox environments without loopback bind permission fall back to in-memory dispatch
      baseUrl = null;
      done();
      return;
    }
    done(err);
  };
  server.once("error", onError);
  server.listen(0, "127.0.0.1", () => {
    server.removeListener("error", onError);
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
    done();
  });
});

afterAll((done) => {
  if (server.listening) {
    server.close(done);
  } else {
    done();
  }
});

beforeEach(() => {
  mockedRouteCompletion.mockReset();
  mockedEvaluateJob.mockReset();
  mockedGetActiveControlPlaneConfig.mockReset();
  mockedInvalidateControlPlaneCache.mockReset();

  mockedGetActiveControlPlaneConfig.mockResolvedValue({
    profileMarkdown: "# Dynamic Notion Profile",
    scoringConfig: mockScoringConfig,
    source: "default",
    loadedAt: 1700000000000,
  });
});

function dispatchInMemory(
  method: string,
  urlPath: string,
  rawPayload?: string,
): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    const reqEmitter = new EventEmitter() as http.IncomingMessage;
    reqEmitter.method = method;
    reqEmitter.url = urlPath;
    reqEmitter.headers = rawPayload
      ? { "content-type": "application/json", "content-length": String(Buffer.byteLength(rawPayload)) }
      : {};

    let statusCode = 200;
    const resChunks: Buffer[] = [];
    const resMock = {
      writeHead(code: number) {
        statusCode = code;
        return this;
      },
      end(chunk?: string | Buffer) {
        if (chunk !== undefined) {
          resChunks.push(typeof chunk === "string" ? Buffer.from(chunk, "utf-8") : chunk);
        }
        const raw = Buffer.concat(resChunks).toString("utf-8");
        try {
          resolve({ status: statusCode, json: raw ? JSON.parse(raw) : null });
        } catch (err) {
          reject(err);
        }
      },
    } as unknown as http.ServerResponse;

    server.emit("request", reqEmitter, resMock);

    process.nextTick(() => {
      if (rawPayload !== undefined) {
        reqEmitter.emit("data", Buffer.from(rawPayload, "utf-8"));
      }
      reqEmitter.emit("end");
    });
  });
}

function requestRaw(
  method: string,
  path: string,
  payload?: string,
): Promise<{ status: number; json: unknown }> {
  if (baseUrl === null) {
    return dispatchInMemory(method, path, payload);
  }
  return new Promise((resolve, reject) => {
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
    req.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EPERM" || err.code === "EACCES") {
        baseUrl = null;
        dispatchInMemory(method, path, payload).then(resolve, reject);
        return;
      }
      reject(err);
    });
    if (payload) req.write(payload);
    req.end();
  });
}

function request(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: unknown }> {
  const payload = body !== undefined ? JSON.stringify(body) : undefined;
  return requestRaw(method, path, payload);
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
    const { status, json } = await requestRaw("POST", "/evaluate", "{not valid json");
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

  it("calls routeCompletion then evaluateJob with dynamic scoringConfig and returns the evaluation result on success", async () => {
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
    expect(mockedEvaluateJob).toHaveBeenCalledWith('{"overall_score":80}', validBody.job, mockScoringConfig);
  });

  it("replaces {{profile}} placeholder in systemPrompt with controlPlane.profileMarkdown", async () => {
    mockedRouteCompletion.mockResolvedValue({ content: '{"overall_score":85}', provider: "openrouter" });
    mockedEvaluateJob.mockReturnValue({ id: "j1", overall_score: 85, match: true });

    const { status } = await request("POST", "/evaluate", {
      ...validBody,
      systemPrompt: "Evaluate against:\n{{profile}}\nEnd of profile.",
    });

    expect(status).toBe(200);
    expect(mockedRouteCompletion).toHaveBeenCalledWith({
      systemPrompt: "Evaluate against:\n# Dynamic Notion Profile\nEnd of profile.",
      userMessage: "user",
      outputSchema: { type: "object" },
    });
  });

  it("returns 502 with the error message when every provider fails", async () => {
    mockedRouteCompletion.mockRejectedValue(new Error("All providers failed:\nopenrouter: down\ngemini: down"));

    const { status, json } = await request("POST", "/evaluate", validBody);

    expect(status).toBe(502);
    expect(json).toEqual({ error: "All providers failed:\nopenrouter: down\ngemini: down" });
    expect(mockedEvaluateJob).not.toHaveBeenCalled();
  });
});

describe("POST /reload-profile", () => {
  it("invalidates cache, forces control plane refresh, and returns 200 with source", async () => {
    mockedGetActiveControlPlaneConfig.mockResolvedValueOnce({
      profileMarkdown: "# Reloaded from Notion",
      scoringConfig: mockScoringConfig,
      source: "notion",
      loadedAt: 1700000005000,
    });

    const { status, json } = await request("POST", "/reload-profile");

    expect(status).toBe(200);
    expect(json).toEqual({ status: "reloaded", source: "notion" });
    expect(mockedInvalidateControlPlaneCache).toHaveBeenCalledTimes(1);
    expect(mockedGetActiveControlPlaneConfig).toHaveBeenCalledWith({ forceRefresh: true });
  });
});

