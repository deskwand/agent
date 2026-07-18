import { afterEach, describe, expect, it, vi } from "vitest";
import { searchWithBrave } from "../../../main/agent/tools/web-access/brave";
import { searchWithExa } from "../../../main/agent/tools/web-access/exa";
import { searchWithOpenAI } from "../../../main/agent/tools/web-access/openai-search";
import {
  extractWithParallel,
  searchWithParallel,
} from "../../../main/agent/tools/web-access/parallel";
import { searchWithTavily } from "../../../main/agent/tools/web-access/tavily";
import { searchWithPerplexity } from "../../../main/agent/tools/web-access/perplexity";
import { searchWithGeminiApi } from "../../../main/agent/tools/web-access/gemini-api";

afterEach(() => vi.unstubAllGlobals());

describe("web search providers", () => {
  it("maps Brave results and sends its subscription token", async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        Response.json({
          web: {
            results: [
              {
                title: "Docs",
                url: "https://example.com/docs",
                description: "Guide",
              },
            ],
          },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchWithBrave(
      "docs",
      {
        numResults: 1,
        recencyFilter: "day",
        domainFilter: ["example.com", "-blocked.example"],
      },
      "brave-key",
    );
    expect(result.results).toEqual([
      { title: "Docs", url: "https://example.com/docs", snippet: "Guide" },
    ]);
    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestUrl.origin + requestUrl.pathname).toBe(
      "https://api.search.brave.com/res/v1/web/search",
    );
    expect(requestUrl.searchParams.get("freshness")).toBe("pd");
    expect(requestUrl.searchParams.get("q")).toContain("site:example.com");
    expect(requestUrl.searchParams.get("q")).toContain(
      "NOT site:blocked.example",
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: expect.objectContaining({ "X-Subscription-Token": "brave-key" }),
      signal: expect.any(AbortSignal),
    });
  });

  it("uses Exa direct API when a key is provided", async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        Response.json({
          answer: "Exa answer",
          citations: [{ title: "Exa Docs", url: "https://exa.ai/docs" }],
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchWithExa("exa", {}, "exa-key");
    expect(result?.answer).toBe("Exa answer");
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://api.exa.ai/answer",
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: expect.objectContaining({ "x-api-key": "exa-key" }),
      signal: expect.any(AbortSignal),
    });
  });

  it("uses Exa search API for filtered content requests", async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        Response.json({
          results: [
            {
              title: "Filtered",
              url: "https://example.com/filtered",
              text: "Full filtered content",
              highlights: ["Filtered highlight"],
            },
          ],
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchWithExa(
      "filtered",
      {
        numResults: 3,
        includeContent: true,
        recencyFilter: "week",
        domainFilter: ["example.com", "-blocked.example"],
      },
      "exa-key",
    );

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://api.exa.ai/search",
    );
    const body = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body),
    ) as Record<string, unknown>;
    expect(body).toMatchObject({
      numResults: 3,
      includeDomains: ["example.com"],
      excludeDomains: ["blocked.example"],
      contents: { text: true, highlights: true },
    });
    expect(body.startPublishedDate).toEqual(expect.any(String));
    expect(result?.inlineContent?.[0]?.content).toBe("Full filtered content");
  });

  it("uses zero-config Exa MCP without a key", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          result: {
            content: [
              {
                type: "text",
                text: "Title: MCP Result\nURL: https://example.com/mcp\nText: MCP content",
              },
            ],
          },
        }),
      ),
    );
    const result = await searchWithExa("mcp", {}, undefined);
    expect(result?.results[0]?.url).toBe("https://example.com/mcp");
  });

  it("maps Parallel excerpts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          results: [
            {
              title: "Parallel",
              url: "https://example.com/parallel",
              excerpts: ["Parallel excerpt"],
            },
          ],
        }),
      ),
    );
    const fetchMock = vi.mocked(fetch);
    const result = await searchWithParallel(
      "parallel",
      {
        recencyFilter: "month",
        domainFilter: ["example.com", "-blocked.example"],
      },
      "parallel-key",
    );
    expect(result.results[0]).toEqual({
      title: "Parallel",
      url: "https://example.com/parallel",
      snippet: "Parallel excerpt",
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://api.parallel.ai/v1/search",
    );
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      advanced_settings?: { source_policy?: Record<string, unknown> };
    };
    expect(body.advanced_settings?.source_policy).toMatchObject({
      include_domains: ["example.com"],
      exclude_domains: ["blocked.example"],
      after_date: expect.any(String),
    });
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("retries Parallel extraction for full content", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          results: [
            { url: "https://example.com/page", excerpts: ["too short"] },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          results: [
            {
              url: "https://example.com/page",
              title: "Page",
              full_content: "x".repeat(600),
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await extractWithParallel(
      "https://example.com/page",
      undefined,
      "parallel-key",
    );

    expect(result?.content).toHaveLength(600);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)),
    ).toMatchObject({
      advanced_settings: { full_content: true },
    });
  });

  it("maps Tavily answer and raw content", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          answer: "Tavily answer",
          results: [
            {
              title: "Tavily",
              url: "https://example.com/tavily",
              content: "snippet",
              raw_content: "# Full",
            },
          ],
        }),
      ),
    );
    const fetchMock = vi.mocked(fetch);
    const result = await searchWithTavily(
      "tavily",
      {
        includeContent: true,
        domainFilter: ["example.com", "-blocked.example"],
      },
      "tavily-key",
    );
    expect(result.answer).toBe("Tavily answer");
    expect(result.inlineContent?.[0]?.content).toBe("# Full");
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://api.tavily.com/search",
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: expect.objectContaining({ Authorization: "Bearer tavily-key" }),
      signal: expect.any(AbortSignal),
    });
    expect(
      JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)),
    ).toMatchObject({
      include_domains: ["example.com"],
      exclude_domains: ["blocked.example"],
    });
  });

  it("maps Perplexity citations", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          choices: [{ message: { content: "Perplexity answer" } }],
          citations: ["https://example.com/perplexity"],
        }),
      ),
    );
    const fetchMock = vi.mocked(fetch);
    const result = await searchWithPerplexity("pplx", {}, "pplx-key");
    expect(result.answer).toBe("Perplexity answer");
    expect(result.results[0]?.url).toBe("https://example.com/perplexity");
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://api.perplexity.ai/chat/completions",
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: expect.objectContaining({ Authorization: "Bearer pplx-key" }),
      signal: expect.any(AbortSignal),
    });
  });

  it("maps OpenAI response output and citations", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: "OpenAI answer",
                  annotations: [
                    {
                      type: "url_citation",
                      url: "https://example.com/openai",
                      title: "OpenAI source",
                    },
                  ],
                },
              ],
            },
          ],
        }),
      ),
    );
    const result = await searchWithOpenAI(
      "openai",
      { domainFilter: ["example.com", "-blocked.example"] },
      {
        provider: "openai",
        apiKey: "openai-key",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-5.4",
        headers: {},
      },
    );
    expect(result.answer).toBe("OpenAI answer");
    expect(result.results[0]?.url).toBe("https://example.com/openai");
    const fetchMock = vi.mocked(fetch);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://api.openai.com/v1/responses",
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: expect.objectContaining({ Authorization: "Bearer openai-key" }),
      signal: expect.any(AbortSignal),
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      tools?: Array<{ filters?: Record<string, unknown> }>;
    };
    expect(body.tools?.[0]?.filters).toEqual({
      allowed_domains: ["example.com"],
      blocked_domains: ["blocked.example"],
    });
  });

  it("resolves Gemini grounding redirect URLs", async () => {
    const redirectUrl =
      "https://vertexaisearch.cloud.google.com/grounding-api-redirect/example";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) =>
        String(input) === redirectUrl
          ? new Response(null, {
              status: 302,
              headers: { location: "https://example.com/resolved" },
            })
          : Response.json({
              candidates: [
                {
                  content: { parts: [{ text: "Gemini answer" }] },
                  groundingMetadata: {
                    groundingChunks: [
                      { web: { title: "Resolved", uri: redirectUrl } },
                    ],
                  },
                },
              ],
            }),
      ),
    );

    const result = await searchWithGeminiApi(
      "gemini",
      {},
      {
        provider: "gemini",
        apiKey: "gemini-key",
        baseUrl: "https://generativelanguage.googleapis.com",
      },
    );
    expect(result?.results[0]?.url).toBe("https://example.com/resolved");
  });

  it("maps Gemini grounding chunks", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          candidates: [
            {
              content: { parts: [{ text: "Gemini answer" }] },
              groundingMetadata: {
                groundingChunks: [
                  {
                    web: {
                      title: "Gemini source",
                      uri: "https://example.com/gemini",
                    },
                  },
                ],
              },
            },
          ],
        }),
      ),
    );
    const result = await searchWithGeminiApi(
      "gemini",
      {},
      {
        provider: "gemini",
        apiKey: "gemini-key",
        baseUrl: "https://generativelanguage.googleapis.com",
      },
    );
    expect(result?.answer).toBe("Gemini answer");
    expect(result?.results[0]?.url).toBe("https://example.com/gemini");
    const fetchMock = vi.mocked(fetch);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: expect.objectContaining({ "x-goog-api-key": "gemini-key" }),
      signal: expect.any(AbortSignal),
    });
  });

  it("rejects provider responses above the bounded JSON limit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response('{"output":[]}', {
            headers: { "content-length": String(6 * 1024 * 1024) },
          }),
      ),
    );

    await expect(
      searchWithOpenAI(
        "bounded",
        {},
        {
          provider: "openai",
          apiKey: "openai-key",
          baseUrl: "https://api.openai.com/v1",
          model: "gpt-5.4",
          headers: {},
        },
      ),
    ).rejects.toThrow(/exceeds 5 MB/);
  });

  it("does not expose an upstream error body in provider errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("apiKey=reflected-secret", {
            status: 500,
            statusText: "Internal Server Error",
          }),
      ),
    );

    const error = await searchWithOpenAI(
      "error",
      {},
      {
        provider: "openai",
        apiKey: "openai-key",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-5.4",
        headers: {},
      },
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain("reflected-secret");
  });
});
