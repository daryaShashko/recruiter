import { routeCompletion, DEFAULT_PROVIDER_ORDER } from "./router";
import { getProvider } from "../providers";

jest.mock("../providers", () => ({
  getProvider: jest.fn(),
}));

const mockedGetProvider = getProvider as jest.Mock;

const BASE_REQUEST = {
  systemPrompt: "You are a recruiter assistant.",
  userMessage: "Evaluate this job.",
  outputSchema: { type: "object", properties: {} },
};

describe("DEFAULT_PROVIDER_ORDER", () => {
  it("matches the live node's order as of 2026-10-05: openrouter primary, gemini fallback", () => {
    expect(DEFAULT_PROVIDER_ORDER).toEqual(["openrouter", "gemini"]);
  });
});

describe("routeCompletion", () => {
  beforeEach(() => {
    mockedGetProvider.mockReset();
  });

  it("returns the first provider's result on success", async () => {
    mockedGetProvider.mockReturnValue({
      complete: jest.fn().mockResolvedValue({ content: '{"overall_score":80}', provider: "openrouter", model: "x" }),
    });

    const result = await routeCompletion(BASE_REQUEST);

    expect(result).toEqual({ content: '{"overall_score":80}', provider: "openrouter" });
    expect(mockedGetProvider).toHaveBeenCalledTimes(1);
    expect(mockedGetProvider).toHaveBeenCalledWith("openrouter");
  });

  it("falls back to the next provider when the first fails", async () => {
    const failing = { complete: jest.fn().mockRejectedValue(new Error("rate limited")) };
    const succeeding = { complete: jest.fn().mockResolvedValue({ content: "{}", provider: "gemini", model: "x" }) };
    mockedGetProvider.mockImplementation((name: string) => (name === "openrouter" ? failing : succeeding));

    const result = await routeCompletion(BASE_REQUEST);

    expect(result).toEqual({ content: "{}", provider: "gemini" });
    expect(mockedGetProvider).toHaveBeenCalledTimes(2);
  });

  it("throws an aggregated error when every provider fails", async () => {
    mockedGetProvider.mockImplementation((name: string) => ({
      complete: jest.fn().mockRejectedValue(new Error(`${name} down`)),
    }));

    await expect(routeCompletion(BASE_REQUEST)).rejects.toThrow(
      /All providers failed:\nopenrouter: openrouter down\ngemini: gemini down/,
    );
  });

  it("respects a custom provider order", async () => {
    mockedGetProvider.mockReturnValue({
      complete: jest.fn().mockResolvedValue({ content: "{}", provider: "ollama", model: "x" }),
    });

    await routeCompletion(BASE_REQUEST, ["ollama"]);

    expect(mockedGetProvider).toHaveBeenCalledWith("ollama");
  });

  it("strips a ```json fenced code block from the response content", async () => {
    mockedGetProvider.mockReturnValue({
      complete: jest.fn().mockResolvedValue({ content: '```json\n{"overall_score":90}\n```', provider: "gemini", model: "x" }),
    });

    const result = await routeCompletion(BASE_REQUEST, ["gemini"]);

    expect(result.content).toBe('{"overall_score":90}');
  });

  it("strips a plain ``` fenced code block (no json tag) from the response content", async () => {
    mockedGetProvider.mockReturnValue({
      complete: jest.fn().mockResolvedValue({ content: '```\n{"a":1}\n```', provider: "gemini", model: "x" }),
    });

    const result = await routeCompletion(BASE_REQUEST, ["gemini"]);

    expect(result.content).toBe('{"a":1}');
  });
});
