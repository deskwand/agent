import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeepSeekWebSearchAuth } from "../src/main/agent/tools/web-access/config-adapter";
import {
  deepseekMessagesUrl,
  searchWithDeepSeek,
} from "../src/main/agent/tools/web-access/deepseek-search";

const SAMPLE_RESPONSE = {
  id: "msg_1",
  type: "message",
  role: "assistant",
  content: [
    { type: "thinking", thinking: "..." },
    {
      type: "web_search_tool_result",
      tool_use_id: "call_0",
      content: [
        { type: "web_search_result", title: "A", url: "https://a.com" },
        { type: "web_search_result", title: "B", url: "https://b.com" },
      ],
    },
    {
      type: "web_search_tool_result",
      tool_use_id: "call_1",
      content: [
        { type: "web_search_result", title: "B dup", url: "https://b.com" },
        { type: "web_search_result", title: "C", url: "https://c.com" },
      ],
    },
    { type: "text", text: "Answer one.\nAnswer two." },
  ],
};

function okResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("deepseekMessagesUrl", () => {
  it("official base with /v1 suffix", () => {
    expect(deepseekMessagesUrl("https://api.deepseek.com/v1")).toBe(
      "https://api.deepseek.com/anthropic/v1/messages",
    );
  });
  it("official base without /v1", () => {
    expect(deepseekMessagesUrl("https://api.deepseek.com")).toBe(
      "https://api.deepseek.com/anthropic/v1/messages",
    );
  });
  it("local proxy keeps /v1/messages without /anthropic", () => {
    expect(deepseekMessagesUrl("http://127.0.0.1:11234")).toBe(
      "http://127.0.0.1:11234/v1/messages",
    );
    expect(deepseekMessagesUrl("http://127.0.0.1:11234/v1")).toBe(
      "http://127.0.0.1:11234/v1/messages",
    );
  });
  it("custom domain never gets /anthropic prefix", () => {
    expect(deepseekMessagesUrl("https://proxy.example.com/v1/")).toBe(
      "https://proxy.example.com/v1/messages",
    );
  });
  it("strips /anthropic suffix to avoid double prefix", () => {
    expect(deepseekMessagesUrl("https://api.deepseek.com/anthropic")).toBe(
      "https://api.deepseek.com/anthropic/v1/messages",
    );
  });
  it("throws readable error for invalid baseUrl", () => {
    expect(() => deepseekMessagesUrl("not a url")).toThrow(
      'Invalid DeepSeek baseUrl "not a url"',
    );
  });
  it("empty base falls back to official", () => {
    expect(deepseekMessagesUrl("")).toBe(
      "https://api.deepseek.com/anthropic/v1/messages",
    );
  });
});

describe("searchWithDeepSeek", () => {
  const auth: DeepSeekWebSearchAuth = {
    apiKey: "sk-test",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
  };

  it("posts to messages endpoint with expected body and headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(SAMPLE_RESPONSE));
    vi.stubGlobal("fetch", fetchMock);

    await searchWithDeepSeek("what is the weather?", {}, auth);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.deepseek.com/anthropic/v1/messages");
    expect(init.headers).toMatchObject({ "x-api-key": "sk-test" });
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.model).toBe("deepseek-v4-flash");
    expect(body.max_tokens).toBe(8192);
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.tools).toEqual([
      { type: "web_search_20250305", name: "web_search", max_uses: 3 },
    ]);
    expect(body.messages).toEqual([
      { role: "user", content: "what is the weather?" },
    ]);
  });

  it("omits auth header when apiKey is empty", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(SAMPLE_RESPONSE));
    vi.stubGlobal("fetch", fetchMock);

    await searchWithDeepSeek("q", {}, { ...auth, apiKey: "" });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.stringify(init.headers)).not.toContain("x-api-key");
  });

  it("parses results across multiple tool_result blocks with dedup and limit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(okResponse(SAMPLE_RESPONSE)),
    );
    const result = await searchWithDeepSeek("q", { numResults: 2 }, auth);
    expect(result.results).toEqual([
      { title: "A", url: "https://a.com", snippet: "" },
      { title: "B", url: "https://b.com", snippet: "" },
    ]);
    expect(result.answer).toBe("Answer one.\nAnswer two.");
  });

  it("limits to 20 results at most", async () => {
    const many = {
      ...SAMPLE_RESPONSE,
      content: [
        {
          type: "web_search_tool_result",
          content: Array.from({ length: 30 }, (_, i) => ({
            type: "web_search_result",
            title: `R${i}`,
            url: `https://r${i}.com`,
          })),
        },
        { type: "text", text: "answer" },
      ],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse(many)));
    const result = await searchWithDeepSeek("q", { numResults: 20 }, auth);
    expect(result.results).toHaveLength(20);
  });

  it("throws when no answer and no results", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          okResponse({ content: [{ type: "thinking", thinking: "x" }] }),
        ),
    );
    await expect(searchWithDeepSeek("q", {}, auth)).rejects.toThrow(
      "DeepSeek web search returned no answer or sources",
    );
  });

  it("throws provider http error on non-ok status", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("nope", { status: 401, statusText: "Unauthorized" }),
        ),
    );
    await expect(searchWithDeepSeek("q", {}, auth)).rejects.toThrow(
      "DeepSeek API error 401",
    );
  });

  it("propagates abort errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new DOMException("Aborted", "AbortError")),
    );
    const error = await searchWithDeepSeek("q", {}, auth).catch((e) => e);
    expect((error as Error).name).toBe("AbortError");
  });
});
