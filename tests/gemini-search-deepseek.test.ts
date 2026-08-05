import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeepSeekWebSearchAuth } from "../src/main/agent/tools/web-access/config-adapter";
import { search } from "../src/main/agent/tools/web-access/gemini-search";

const deepseekAuth: DeepSeekWebSearchAuth = {
  apiKey: "sk-test",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-v4-flash",
};

function deepseekOkResponse(): Response {
  return new Response(
    JSON.stringify({
      type: "message",
      content: [
        {
          type: "web_search_tool_result",
          content: [
            { type: "web_search_result", title: "A", url: "https://a.com" },
          ],
        },
        { type: "text", text: "answer" },
      ],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("search with deepseek provider", () => {
  it("explicit deepseek provider returns attributed result", async () => {
    const fetchMock = vi.fn().mockResolvedValue(deepseekOkResponse());
    vi.stubGlobal("fetch", fetchMock);

    const result = await search(
      "q",
      { provider: "deepseek" },
      { defaultProvider: "auto", deepseek: deepseekAuth },
    );
    expect(result.provider).toBe("deepseek");
    expect(result.answer).toBe("answer");
    expect(result.results[0]?.url).toBe("https://a.com");
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.deepseek.com/anthropic/v1/messages",
    );
  });

  it("explicit deepseek without auth throws", async () => {
    await expect(
      search("q", { provider: "deepseek" }, { defaultProvider: "auto" }),
    ).rejects.toThrow("DeepSeek search provider unavailable");
  });

  it("auto chain falls back to deepseek after exa fails", async () => {
    const fetchMock = vi.fn(
      async (url: string) =>
        String(url).includes("exa.ai")
          ? new Response("boom", { status: 500, statusText: "Exa down" })
          : deepseekOkResponse(),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await search(
      "q",
      {},
      { defaultProvider: "auto", deepseek: deepseekAuth },
    );
    expect(result.provider).toBe("deepseek");
  });
});
