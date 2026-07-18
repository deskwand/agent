import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  openai: vi.fn(),
  exa: vi.fn(),
  brave: vi.fn(),
  parallel: vi.fn(),
  tavily: vi.fn(),
  perplexity: vi.fn(),
  gemini: vi.fn(),
}));

vi.mock("../../../main/agent/tools/web-access/openai-search", () => ({
  searchWithOpenAI: mocks.openai,
}));
vi.mock("../../../main/agent/tools/web-access/exa", () => ({
  searchWithExa: mocks.exa,
}));
vi.mock("../../../main/agent/tools/web-access/brave", () => ({
  searchWithBrave: mocks.brave,
}));
vi.mock("../../../main/agent/tools/web-access/parallel", () => ({
  searchWithParallel: mocks.parallel,
}));
vi.mock("../../../main/agent/tools/web-access/tavily", () => ({
  searchWithTavily: mocks.tavily,
}));
vi.mock("../../../main/agent/tools/web-access/perplexity", () => ({
  searchWithPerplexity: mocks.perplexity,
}));
vi.mock("../../../main/agent/tools/web-access/gemini-api", () => ({
  searchWithGeminiApi: mocks.gemini,
}));

import {
  search,
  type WebSearchRuntime,
} from "../../../main/agent/tools/web-access/gemini-search";

const runtime: WebSearchRuntime = {
  defaultProvider: "auto",
  exaApiKey: "exa-key",
  braveApiKey: "brave-key",
  parallelApiKey: "parallel-key",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("web search orchestration", () => {
  it("does not fall back when an explicit provider fails", async () => {
    mocks.brave.mockRejectedValueOnce(new Error("Brave failed"));
    await expect(
      search("query", { provider: "brave" }, runtime),
    ).rejects.toThrow("Brave failed");
    expect(mocks.exa).not.toHaveBeenCalled();
  });

  it("falls through recoverable auto failures in fixed order", async () => {
    const callOrder: string[] = [];
    mocks.exa.mockImplementationOnce(async () => {
      callOrder.push("exa");
      throw new Error("Exa failed");
    });
    mocks.brave.mockImplementationOnce(async () => {
      callOrder.push("brave");
      throw new Error("Brave failed");
    });
    mocks.parallel.mockImplementationOnce(async () => {
      callOrder.push("parallel");
      return { answer: "ok", results: [] };
    });

    const result = await search("query", { provider: "auto" }, runtime);
    expect(result.provider).toBe("parallel");
    expect(callOrder).toEqual(["exa", "brave", "parallel"]);
  });

  it("reports optional auth resolution failures when all fallbacks fail", async () => {
    mocks.exa.mockRejectedValueOnce(new Error("Exa failed"));

    await expect(
      search(
        "query",
        { provider: "auto" },
        {
          defaultProvider: "auto",
          authErrors: { openai: "Authentication failed for openai" },
        },
      ),
    ).rejects.toThrow(
      /openai: Authentication failed for openai.*exa: Exa failed/,
    );
  });

  it("stops immediately when aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      search("query", { signal: controller.signal }, runtime),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.exa).not.toHaveBeenCalled();
  });

  it("falls back through the chain and eventually reaches openai", async () => {
    const withOpenAI: WebSearchRuntime = {
      ...runtime,
      openai: {
        provider: "openai",
        apiKey: "key",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-5.4",
        headers: {},
      },
    };
    // Make all providers before openai fail
    mocks.exa.mockRejectedValueOnce(new Error("Exa failed"));
    mocks.brave.mockRejectedValueOnce(new Error("Brave failed"));
    mocks.parallel.mockRejectedValueOnce(new Error("Parallel failed"));
    mocks.tavily.mockRejectedValueOnce(new Error("Tavily failed"));
    mocks.perplexity.mockRejectedValueOnce(new Error("Perplexity failed"));
    mocks.openai.mockResolvedValueOnce({ answer: "openai", results: [] });

    const result = await search("query", {}, withOpenAI);
    expect(result.provider).toBe("openai");
  });

  it("keeps zero-key Exa MCP available in auto mode", async () => {
    mocks.exa.mockResolvedValueOnce({ answer: "exa", results: [] });
    const result = await search("query", {}, { defaultProvider: "auto" });
    expect(result.provider).toBe("exa");
    expect(mocks.exa).toHaveBeenCalledWith(
      "query",
      expect.any(Object),
      undefined,
    );
  });

  it.each([{ recencyFilter: "week" as const }, { numResults: 10 }])(
    "skips OpenAI in auto mode when options are unsuitable: %o",
    async (options) => {
      const withOpenAI: WebSearchRuntime = {
        ...runtime,
        openai: {
          provider: "openai",
          apiKey: "key",
          baseUrl: "https://api.openai.com/v1",
          model: "gpt-5.4",
          headers: {},
        },
      };
      mocks.exa.mockResolvedValueOnce({ answer: "exa", results: [] });
      const result = await search("recent", options, withOpenAI);
      expect(result.provider).toBe("exa");
      expect(mocks.openai).not.toHaveBeenCalled();
    },
  );
});
