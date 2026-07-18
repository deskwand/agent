import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WebAccessCache } from "../../../main/agent/tools/web-access/cache";
import {
  normalizeWebAccessConfig,
  type WebAccessAuthProvider,
  type WebAccessCredential,
  type WebAccessToolDetails,
} from "../../../shared/web-access";

const mocks = vi.hoisted(() => ({
  search: vi.fn(),
  fetchAllContent: vi.fn(),
}));

vi.mock("../../../main/agent/tools/web-access/gemini-search", async () => {
  const actual = await vi.importActual<object>(
    "../../../main/agent/tools/web-access/gemini-search",
  );
  return { ...actual, search: mocks.search };
});
vi.mock("../../../main/agent/tools/web-access/extract", async () => {
  const actual = await vi.importActual<object>(
    "../../../main/agent/tools/web-access/extract",
  );
  return { ...actual, fetchAllContent: mocks.fetchAllContent };
});

import {
  createWebAccessTools,
  getWebAccessSessionTempDir,
} from "../../../main/agent/tools/web-access/web-tools";

function createTools() {
  return createWebAccessTools({
    workspaceDir: process.cwd(),
    sessionId: "session-1",
    getConfig: () => normalizeWebAccessConfig(undefined),
    resolveProviderAuth: async () => undefined,
    cache: new WebAccessCache(),
  });
}

async function executeTool(name: string, params: Record<string, unknown>) {
  const tool = createTools().find((item) => item.name === name);
  if (!tool) throw new Error(`Missing tool ${name}`);
  return tool.execute(
    "call-1",
    params,
    undefined,
    undefined,
    undefined as never,
  );
}

function details(result: { details: unknown }): WebAccessToolDetails {
  return result.details as WebAccessToolDetails;
}

function resultText(result: { content: Array<{ type: string }> }): string {
  const item = result.content.find((entry) => entry.type === "text");
  return item && "text" in item && typeof item.text === "string"
    ? item.text
    : "";
}

beforeEach(() => vi.clearAllMocks());

describe("createWebAccessTools", () => {
  it("registers exactly the three Web Access tools", () => {
    expect(createTools().map((tool) => tool.name)).toEqual([
      "web_search",
      "fetch_content",
      "get_search_content",
    ]);
  });

  it("returns a structured error when no query is supplied", async () => {
    const result = await executeTool("web_search", {});
    expect(details(result)).toMatchObject({ errorCode: "UNSUPPORTED_CONTENT" });
  });

  it("returns cited search output and a responseId", async () => {
    mocks.search.mockResolvedValueOnce({
      provider: "exa",
      answer: "Answer",
      results: [
        { title: "Source", url: "https://example.com", snippet: "Snippet" },
      ],
    });
    const result = await executeTool("web_search", { query: "question" });
    const text =
      result.content.find((item) => item.type === "text")?.text || "";
    expect(text).toContain("Answer");
    expect(text).toContain("Provider: exa");
    expect(text).toContain("https://example.com");
    expect(details(result)).toMatchObject({ provider: "exa", queryCount: 1 });
    expect(details(result).responseId).toEqual(expect.any(String));
  });

  it("runs batch queries sequentially and reuses one response cache record", async () => {
    let active = 0;
    let maxActive = 0;
    mocks.search.mockImplementation(async (query: string) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
      return { provider: "exa", answer: query, results: [] };
    });

    const result = await executeTool("web_search", {
      queries: ["first", "second"],
    });

    expect(maxActive).toBe(1);
    expect(mocks.search.mock.calls.map((call) => call[0])).toEqual([
      "first",
      "second",
    ]);
    expect(details(result)).toMatchObject({
      queryCount: 2,
      successful: 2,
      responseId: expect.any(String),
    });
  });

  it("caps query batches before provider calls", async () => {
    mocks.search.mockImplementation(async (query: string) => ({
      provider: "exa",
      answer: query,
      results: [],
    }));
    const queries = Array.from({ length: 15 }, (_, index) => `query-${index}`);

    const result = await executeTool("web_search", { queries });

    expect(mocks.search).toHaveBeenCalledTimes(10);
    expect(details(result).queryCount).toBe(10);
  });

  it("caps total source extraction across a batch search", async () => {
    mocks.search.mockImplementation(async (query: string) => ({
      provider: "exa",
      answer: query,
      results: Array.from({ length: 10 }, (_, index) => ({
        title: `${query}-${index}`,
        url: `https://example.com/${query}/${index}`,
        snippet: "",
      })),
    }));
    mocks.fetchAllContent.mockImplementation(async (urls: string[]) =>
      urls.map((url) => ({ url, title: url, content: "content", error: null })),
    );

    await executeTool("web_search", {
      queries: ["first", "second"],
      includeContent: true,
    });

    const fetchedUrls = mocks.fetchAllContent.mock.calls.flatMap(
      (call) => call[0] as string[],
    );
    expect(fetchedUrls).toHaveLength(10);
  });

  it("stores included content and retrieves it by query, URL, and URL index", async () => {
    const signal = new AbortController().signal;
    mocks.search.mockResolvedValueOnce({
      provider: "exa",
      answer: "Answer",
      results: [
        { title: "Source", url: "https://example.com", snippet: "Snippet" },
      ],
      inlineContent: [
        {
          url: "https://example.com",
          title: "Source",
          content: "Full source content",
          error: null,
        },
      ],
    });
    const cache = new WebAccessCache();
    const tools = createWebAccessTools({
      workspaceDir: process.cwd(),
      sessionId: "session-1",
      getConfig: () => normalizeWebAccessConfig(undefined),
      resolveProviderAuth: async () => undefined,
      cache,
    });
    const searchTool = tools.find((tool) => tool.name === "web_search");
    const getTool = tools.find((tool) => tool.name === "get_search_content");
    if (!searchTool || !getTool) throw new Error("Missing tools");

    const searched = await searchTool.execute(
      "search-1",
      { query: "question", includeContent: true },
      signal,
      undefined,
      undefined as never,
    );
    expect(mocks.search.mock.calls[0]?.[1]).toMatchObject({ signal });
    const responseId = details(searched).responseId;
    expect(responseId).toEqual(expect.any(String));

    const byQuery = await getTool.execute(
      "get-query",
      { responseId, query: "question" },
      undefined,
      undefined,
      undefined as never,
    );
    expect(resultText(byQuery)).toContain("Answer");

    for (const selector of [{ url: "https://example.com" }, { urlIndex: 0 }]) {
      const full = await getTool.execute(
        "get-url",
        { responseId, ...selector },
        undefined,
        undefined,
        undefined as never,
      );
      expect(resultText(full)).toBe("Full source content");
    }
  });

  it("always resolves both openai and gemini auth for web_search", async () => {
    mocks.search.mockResolvedValueOnce({
      provider: "exa",
      answer: "Answer",
      results: [],
    });
    mocks.fetchAllContent.mockResolvedValueOnce([
      { url: "https://example.com", title: "", content: "Page", error: null },
    ]);
    const resolveProviderAuth = vi.fn(
      async (
        _provider: WebAccessAuthProvider,
        _credential: WebAccessCredential,
      ) => undefined,
    );
    const tools = createWebAccessTools({
      workspaceDir: process.cwd(),
      sessionId: "session-1",
      getConfig: () => normalizeWebAccessConfig(undefined),
      resolveProviderAuth,
      cache: new WebAccessCache(),
    });
    const searchTool = tools.find((tool) => tool.name === "web_search");
    const fetchTool = tools.find((tool) => tool.name === "fetch_content");
    if (!searchTool || !fetchTool) throw new Error("Missing tools");

    await searchTool.execute(
      "search-1",
      { query: "question" },
      undefined,
      undefined,
      undefined as never,
    );
    expect(resolveProviderAuth.mock.calls.map((call) => call[0])).toEqual([
      "openai",
      "gemini",
    ]);

    await fetchTool.execute(
      "fetch-1",
      { url: "https://example.com" },
      undefined,
      undefined,
      undefined as never,
    );
    expect(resolveProviderAuth.mock.calls.map((call) => call[0])).toEqual([
      "openai",
      "gemini",
      "gemini",
    ]);
  });

  it("keeps auto search available when inherited auth resolution fails", async () => {
    mocks.search.mockResolvedValueOnce({
      provider: "exa",
      answer: "Answer",
      results: [],
    });
    const tools = createWebAccessTools({
      workspaceDir: process.cwd(),
      sessionId: "session-1",
      getConfig: () => normalizeWebAccessConfig(undefined),
      resolveProviderAuth: async (provider) => {
        if (provider === "openai") throw new Error("OAuth refresh failed");
        return undefined;
      },
      cache: new WebAccessCache(),
    });
    const searchTool = tools.find((tool) => tool.name === "web_search");
    if (!searchTool) throw new Error("Missing web_search");

    const result = await searchTool.execute(
      "auto",
      { query: "question" },
      undefined,
      undefined,
      undefined as never,
    );
    expect(details(result).provider).toBe("exa");
    expect(mocks.search.mock.calls[0]?.[2]).toMatchObject({
      openai: undefined,
    });
  });

  it("catches auth resolution failures silently and falls through to search chain", async () => {
    mocks.search.mockResolvedValueOnce({
      provider: "exa",
      answer: "fallback answer",
      results: [],
    });
    const tools = createWebAccessTools({
      workspaceDir: process.cwd(),
      sessionId: "session-1",
      getConfig: () => normalizeWebAccessConfig(undefined),
      resolveProviderAuth: async () => {
        throw new Error("OAuth refresh failed");
      },
      cache: new WebAccessCache(),
    });
    const searchTool = tools.find((tool) => tool.name === "web_search");
    if (!searchTool) throw new Error("Missing web_search");

    const result = await searchTool.execute(
      "explicit-auth",
      { query: "question" },
      undefined,
      undefined,
      undefined as never,
    );
    expect(details(result).provider).toBe("exa");
    expect(mocks.search).toHaveBeenCalledTimes(1);
  });

  it("redacts reflected credentials from auth resolution errors", async () => {
    const tools = createWebAccessTools({
      workspaceDir: process.cwd(),
      sessionId: "session-1",
      getConfig: () => normalizeWebAccessConfig(undefined),
      resolveProviderAuth: async () => {
        throw new Error("OAuth token=super-secret refresh failed");
      },
      cache: new WebAccessCache(),
    });
    const searchTool = tools.find((tool) => tool.name === "web_search");
    if (!searchTool) throw new Error("Missing web_search");

    const result = await searchTool.execute(
      "explicit-secret",
      { query: "question" },
      undefined,
      undefined,
      undefined as never,
    );

    expect(resultText(result)).not.toContain("super-secret");
  });

  it("reads updated settings on the next invocation without recreating tools", async () => {
    let config = {
      ...normalizeWebAccessConfig(undefined),
      braveApiKey: "first-key",
    };
    mocks.search.mockResolvedValue({
      provider: "brave",
      answer: "Answer",
      results: [],
    });
    const tools = createWebAccessTools({
      workspaceDir: process.cwd(),
      sessionId: "session-1",
      getConfig: () => config,
      resolveProviderAuth: async () => undefined,
      cache: new WebAccessCache(),
    });
    const searchTool = tools.find((tool) => tool.name === "web_search");
    if (!searchTool) throw new Error("Missing web_search");

    await searchTool.execute(
      "first",
      { query: "question" },
      undefined,
      undefined,
      undefined as never,
    );
    config = { ...config, braveApiKey: "second-key" };
    await searchTool.execute(
      "second",
      { query: "question" },
      undefined,
      undefined,
      undefined as never,
    );

    expect(mocks.search.mock.calls[0]?.[2]).toMatchObject({
      braveApiKey: "first-key",
    });
    expect(mocks.search.mock.calls[1]?.[2]).toMatchObject({
      braveApiKey: "second-key",
    });
  });

  it("returns structured cancellation and authentication errors", async () => {
    const controller = new AbortController();
    controller.abort();
    mocks.search
      .mockRejectedValueOnce(new DOMException("Aborted", "AbortError"))
      .mockRejectedValueOnce(new Error("OpenAI API error 401: invalid key"));
    const tools = createTools();
    const searchTool = tools.find((tool) => tool.name === "web_search");
    if (!searchTool) throw new Error("Missing web_search");

    const cancelled = await searchTool.execute(
      "cancelled",
      { query: "question" },
      controller.signal,
      undefined,
      undefined as never,
    );
    expect(details(cancelled).errorCode).toBe("CANCELLED");

    const authFailure = await searchTool.execute(
      "auth",
      { query: "question" },
      undefined,
      undefined,
      undefined as never,
    );
    expect(details(authFailure).errorCode).toBe("AUTHENTICATION_FAILED");
  });

  it("truncates long search output and retrieves the full query result", async () => {
    const answer = "search".repeat(6_000);
    mocks.search.mockResolvedValueOnce({
      provider: "exa",
      answer,
      results: [],
    });
    const cache = new WebAccessCache();
    const tools = createWebAccessTools({
      workspaceDir: process.cwd(),
      sessionId: "session-1",
      getConfig: () => normalizeWebAccessConfig(undefined),
      resolveProviderAuth: async () => undefined,
      cache,
    });
    const searchTool = tools.find((tool) => tool.name === "web_search");
    const getTool = tools.find((tool) => tool.name === "get_search_content");
    if (!searchTool || !getTool) throw new Error("Missing tools");

    const searched = await searchTool.execute(
      "search-long",
      { query: "long" },
      undefined,
      undefined,
      undefined as never,
    );
    expect(details(searched).truncated).toBe(true);
    expect(resultText(searched).length).toBeLessThan(answer.length);

    const full = await getTool.execute(
      "get-long",
      { responseId: details(searched).responseId, query: "long" },
      undefined,
      undefined,
      undefined as never,
    );
    expect(resultText(full)).toContain(answer);
  });

  it("includes the responseId in a successful inline fetch result", async () => {
    mocks.fetchAllContent.mockResolvedValueOnce([
      {
        url: "https://example.com",
        title: "Example",
        content: "Short article",
        error: null,
      },
    ]);

    const fetched = await executeTool("fetch_content", {
      url: "https://example.com",
    });

    expect(resultText(fetched)).toContain(
      `responseId: ${details(fetched).responseId}`,
    );
  });

  it("truncates long fetch output and retrieves its full cached content", async () => {
    const content = "x".repeat(31_000);
    mocks.fetchAllContent.mockResolvedValueOnce([
      { url: "https://example.com", title: "Example", content, error: null },
    ]);
    const cache = new WebAccessCache();
    const tools = createWebAccessTools({
      workspaceDir: process.cwd(),
      sessionId: "session-1",
      getConfig: () => normalizeWebAccessConfig(undefined),
      resolveProviderAuth: async () => undefined,
      cache,
    });
    const fetchTool = tools.find((tool) => tool.name === "fetch_content");
    const getTool = tools.find((tool) => tool.name === "get_search_content");
    if (!fetchTool || !getTool) throw new Error("Missing tools");

    const fetched = await fetchTool.execute(
      "fetch-1",
      { url: "https://example.com" },
      undefined,
      undefined,
      undefined as never,
    );
    expect(details(fetched).truncated).toBe(true);
    const responseId = details(fetched).responseId;
    expect(responseId).toEqual(expect.any(String));

    const full = await getTool.execute(
      "get-1",
      { responseId, urlIndex: 0 },
      undefined,
      undefined,
      undefined as never,
    );
    expect(full.content.find((item) => item.type === "text")?.text).toBe(
      content,
    );
  });

  it("preserves the structured error code for a failed fetch batch", async () => {
    mocks.fetchAllContent.mockResolvedValueOnce(
      ["one", "two"].map((name) => ({
        url: `https://example.com/${name}`,
        title: "",
        content: "",
        error: "Blocked",
        errorCode: "FETCH_BLOCKED" as const,
      })),
    );
    const result = await executeTool("fetch_content", {
      urls: ["https://example.com/one", "https://example.com/two"],
    });
    expect(details(result).errorCode).toBe("FETCH_BLOCKED");
  });

  it("returns a cached fetch error with its structured code", async () => {
    mocks.fetchAllContent.mockResolvedValueOnce([
      {
        url: "https://example.com/file.bin",
        title: "",
        content: "",
        error: "Unsupported binary content",
        errorCode: "UNSUPPORTED_CONTENT",
      },
    ]);
    const cache = new WebAccessCache();
    const tools = createWebAccessTools({
      workspaceDir: process.cwd(),
      sessionId: "session-1",
      getConfig: () => normalizeWebAccessConfig(undefined),
      resolveProviderAuth: async () => undefined,
      cache,
    });
    const fetchTool = tools.find((tool) => tool.name === "fetch_content");
    const getTool = tools.find((tool) => tool.name === "get_search_content");
    if (!fetchTool || !getTool) throw new Error("Missing tools");

    const fetched = await fetchTool.execute(
      "fetch-error",
      { url: "https://example.com/file.bin" },
      undefined,
      undefined,
      undefined as never,
    );
    const cached = await getTool.execute(
      "get-error",
      { responseId: details(fetched).responseId, urlIndex: 0 },
      undefined,
      undefined,
      undefined as never,
    );
    expect(resultText(cached)).toBe("Unsupported binary content");
    expect(details(cached).errorCode).toBe("UNSUPPORTED_CONTENT");
  });

  it("returns CACHE_EXPIRED for an expired responseId", async () => {
    let now = 1_000;
    const cache = new WebAccessCache(() => now);
    cache.set("session-1", {
      id: "expired",
      type: "fetch",
      timestamp: now,
      urls: [],
    });
    now += 60 * 60 * 1_000 + 1;
    const tools = createWebAccessTools({
      workspaceDir: process.cwd(),
      sessionId: "session-1",
      getConfig: () => normalizeWebAccessConfig(undefined),
      resolveProviderAuth: async () => undefined,
      cache,
    });
    const getTool = tools.find((tool) => tool.name === "get_search_content");
    if (!getTool) throw new Error("Missing get_search_content");

    const result = await getTool.execute(
      "get-expired",
      { responseId: "expired" },
      undefined,
      undefined,
      undefined as never,
    );
    expect(details(result).errorCode).toBe("CACHE_EXPIRED");
  });

  it("distinguishes a missing selector from a missing cache record", async () => {
    const cache = new WebAccessCache();
    cache.set("session-1", {
      id: "search-record",
      type: "search",
      timestamp: Date.now(),
      queries: [
        {
          query: "available",
          answer: "answer",
          results: [],
          error: null,
          provider: "exa",
        },
      ],
      urls: [],
    });
    const tools = createWebAccessTools({
      workspaceDir: process.cwd(),
      sessionId: "session-1",
      getConfig: () => normalizeWebAccessConfig(undefined),
      resolveProviderAuth: async () => undefined,
      cache,
    });
    const getTool = tools.find((tool) => tool.name === "get_search_content");
    if (!getTool) throw new Error("Missing get_search_content");

    const result = await getTool.execute(
      "missing-selector",
      { responseId: "search-record", query: "missing" },
      undefined,
      undefined,
      undefined as never,
    );

    expect(details(result).errorCode).toBe("SELECTOR_NOT_FOUND");
  });

  it("returns CACHE_MISS for an unknown responseId", async () => {
    const result = await executeTool("get_search_content", {
      responseId: "missing",
      urlIndex: 0,
    });
    expect(details(result)).toMatchObject({ errorCode: "CACHE_MISS" });
  });

  it("hashes session ids in temporary paths", () => {
    const path = getWebAccessSessionTempDir("private-session-id");
    expect(path).toContain(
      createHash("sha256").update("private-session-id").digest("hex"),
    );
    expect(path).not.toContain("private-session-id");
  });
});
