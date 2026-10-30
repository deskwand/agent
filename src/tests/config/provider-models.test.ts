import { beforeEach, describe, expect, it, vi } from "vitest";

const { openaiListMock } = vi.hoisted(() => ({ openaiListMock: vi.fn() }));
const { anthropicListMock } = vi.hoisted(() => ({
  anthropicListMock: vi.fn(),
}));
const { genaiListMock } = vi.hoisted(() => ({ genaiListMock: vi.fn() }));
const { fetchOpenRouterModelsMock } = vi.hoisted(() => ({
  fetchOpenRouterModelsMock: vi.fn(),
}));

vi.mock("openai", () => ({
  default: class {
    models = { list: openaiListMock };
    constructor(readonly options: unknown) {}
  },
}));

vi.mock("@anthropic-ai/sdk", () => ({
  Anthropic: class {
    models = { list: anthropicListMock };
    constructor(readonly options: unknown) {}
  },
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { list: genaiListMock };
    constructor(readonly options: unknown) {}
  },
}));

vi.mock("../../main/config/openrouter-models", () => ({
  fetchOpenRouterModels: fetchOpenRouterModelsMock,
}));

import {
  filterChatModels,
  isChatModelId,
  listProviderModels,
} from "../../main/config/provider-models";

/** 模拟 SDK 的分页对象：支持 `for await`，与 OpenAI / Anthropic / GenAI 的 Pager 行为一致 */
function paged<T>(items: T[]) {
  return {
    async *[Symbol.asyncIterator]() {
      yield* items;
    },
  };
}

function httpError(status: number, message = "boom") {
  return Object.assign(new Error(message), { status });
}

describe("provider model filtering", () => {
  it("keeps chat models", () => {
    for (const id of [
      "gpt-5.4",
      "gpt-5.4-mini",
      "claude-sonnet-4-6",
      "deepseek-v4-pro",
      "gemini-2.5-flash",
      "openai/gpt-5.4",
      "MiniMax-M2.5",
      "qwen-max",
    ]) {
      expect(isChatModelId(id), id).toBe(true);
    }
  });

  it("drops non-chat families", () => {
    for (const id of [
      "text-embedding-3-large",
      "text-embedding-004",
      "whisper-1",
      "tts-1",
      "gpt-4o-audio-preview",
      "gpt-4o-realtime-preview",
      "dall-e-3",
      "gpt-image-1",
      "omni-moderation-latest",
      "imagen-3.0-generate-002",
      "veo-2.0-generate-001",
      "rerank-v3.5",
      "aqa",
      "gemini-2.5-flash-image",
    ]) {
      expect(isChatModelId(id), id).toBe(false);
    }
  });

  it("counts how many entries were filtered out", () => {
    const result = filterChatModels([
      { id: "gpt-5.4" },
      { id: "tts-1" },
      { id: "o3" },
    ]);
    expect(result.models.map((m) => m.id)).toEqual(["gpt-5.4", "o3"]);
    expect(result.filtered).toBe(1);
  });

  it("is case-insensitive", () => {
    expect(isChatModelId("TEXT-EMBEDDING-3-LARGE")).toBe(false);
  });
});

describe("listProviderModels — OpenAI compatible", () => {
  beforeEach(() => {
    openaiListMock.mockReset();
    anthropicListMock.mockReset();
    genaiListMock.mockReset();
    fetchOpenRouterModelsMock.mockReset();
  });

  it("maps and filters the endpoint list", async () => {
    openaiListMock.mockResolvedValue(
      paged([{ id: "gpt-5.4" }, { id: "tts-1" }, { id: "o3" }]),
    );
    const result = await listProviderModels({
      provider: "openai",
      apiKey: "sk-test",
    });
    expect(result.ok).toBe(true);
    expect(result.source).toBe("live");
    expect(result.models.map((m) => m.id)).toEqual(["gpt-5.4", "o3"]);
    expect(result.models[0].label).toBe("gpt-5.4");
    expect(result.filtered).toBe(1);
  });

  it("reports a missing key without calling the SDK", async () => {
    const result = await listProviderModels({
      provider: "custom",
      customProtocol: "openai",
      apiKey: "   ",
      baseUrl: "https://relay.example.com/v1",
    });
    expect(result.ok).toBe(false);
    expect(result.source).toBe("error");
    expect(result.errorType).toBe("missing_key");
    expect(openaiListMock).not.toHaveBeenCalled();
  });

  it("treats 404 as 'endpoint does not list models'", async () => {
    openaiListMock.mockRejectedValue(httpError(404, "not found"));
    const result = await listProviderModels({
      provider: "deepseek",
      apiKey: "sk-test",
    });
    expect(result.ok).toBe(true);
    expect(result.source).toBe("unsupported");
    expect(result.models).toEqual([]);
  });

  it("classifies 401 / 403 as unauthorized", async () => {
    openaiListMock.mockRejectedValue(httpError(401, "invalid api key"));
    const result = await listProviderModels({
      provider: "openai",
      apiKey: "sk-bad",
    });
    expect(result.ok).toBe(false);
    expect(result.source).toBe("error");
    expect(result.errorType).toBe("unauthorized");
    expect(result.error).toContain("invalid api key");
  });

  it("classifies network failures", async () => {
    openaiListMock.mockRejectedValue(
      Object.assign(new Error("fetch failed"), {
        cause: new Error("ENOTFOUND"),
      }),
    );
    const result = await listProviderModels({
      provider: "openai",
      apiKey: "sk-test",
    });
    expect(result.ok).toBe(false);
    expect(result.errorType).toBe("network_error");
  });
});

describe("listProviderModels — anthropic", () => {
  beforeEach(() => {
    anthropicListMock.mockReset();
  });

  it("iterates every entry the SDK page yields", async () => {
    anthropicListMock.mockResolvedValue(
      paged([
        { id: "claude-opus-4-6", display_name: "Claude Opus 4.6" },
        { id: "claude-sonnet-4-6", display_name: "Claude Sonnet 4.6" },
      ]),
    );
    const result = await listProviderModels({
      provider: "anthropic",
      apiKey: "sk-ant-test",
    });
    expect(result.models.map((m) => m.id)).toEqual([
      "claude-opus-4-6",
      "claude-sonnet-4-6",
    ]);
    expect(result.models[0].label).toBe("Claude Opus 4.6");
  });
});

describe("listProviderModels — gemini", () => {
  beforeEach(() => {
    genaiListMock.mockReset();
  });

  it("strips the models/ prefix and keeps only generateContent models", async () => {
    genaiListMock.mockResolvedValue(
      paged([
        {
          name: "models/gemini-2.5-flash",
          displayName: "Gemini 2.5 Flash",
          supportedActions: ["generateContent"],
          inputTokenLimit: 1048576,
        },
        { name: "models/aqa", supportedActions: ["generateAnswer"] },
        {
          name: "models/gemini-2.0-flash-live-001",
          supportedActions: ["bidiGenerateContent"],
        },
      ]),
    );
    const result = await listProviderModels({
      provider: "gemini",
      apiKey: "AIza-test",
    });
    expect(result.models).toEqual([
      {
        id: "gemini-2.5-flash",
        label: "Gemini 2.5 Flash",
        contextWindow: 1048576,
      },
    ]);
    expect(result.source).toBe("live");
  });

  it("requires an API key", async () => {
    const result = await listProviderModels({ provider: "gemini", apiKey: "" });
    expect(result.errorType).toBe("missing_key");
    expect(genaiListMock).not.toHaveBeenCalled();
  });
});

describe("listProviderModels — openrouter", () => {
  beforeEach(() => {
    fetchOpenRouterModelsMock.mockReset();
  });

  it("reuses the OpenRouter catalogue without an API key", async () => {
    fetchOpenRouterModelsMock.mockResolvedValue({
      models: [
        {
          id: "anthropic/claude-sonnet-4.6",
          label: "Anthropic: Claude Sonnet 4.6",
          source: "preset",
          contextWindow: 200000,
        },
      ],
      usedFallback: false,
    });
    const result = await listProviderModels({
      provider: "openrouter",
      apiKey: "",
    });
    expect(result.source).toBe("live");
    expect(result.models[0]).toEqual({
      id: "anthropic/claude-sonnet-4.6",
      label: "Anthropic: Claude Sonnet 4.6",
      contextWindow: 200000,
    });
  });

  it("falls back to 'unsupported' when the catalogue used its preset fallback", async () => {
    fetchOpenRouterModelsMock.mockResolvedValue({
      models: [
        { id: "openai/gpt-5.4", label: "openai/gpt-5.4", source: "preset" },
      ],
      usedFallback: true,
      error: "timeout",
    });
    const result = await listProviderModels({
      provider: "openrouter",
      apiKey: "",
    });
    expect(result.source).toBe("unsupported");
    expect(result.ok).toBe(true);
  });
});

describe("listProviderModels — endpoint metadata", () => {
  beforeEach(() => {
    openaiListMock.mockReset();
  });

  it("reads context window, output cap, image support and display name", async () => {
    openaiListMock.mockResolvedValue(
      paged([
        {
          id: "opencode-go/glm-5.2",
          display_name: "GLM-5.2",
          context_length: 1000000,
          context_window: 1000000,
          max_output_tokens: 131072,
          modalities: { input: ["text"] },
        },
        {
          id: "auto/gpt-5.6-luna",
          display_name: "GPT-5.6 Luna",
          context_window: 922000,
          max_output_tokens: 128000,
          modalities: { input: ["text", "image"] },
        },
        // 上游没给 modalities 的模型（Magpie 里的 GLM-5.1）：不能凭空判成支持图片
        { id: "opencode-go/glm-5.1", display_name: "GLM-5.1" },
      ]),
    );

    const result = await listProviderModels({
      provider: "custom",
      customProtocol: "openai",
      apiKey: "magpie",
      baseUrl: "http://127.0.0.1:3425/v1",
    });

    expect(result.source).toBe("live");
    expect(result.models).toEqual([
      {
        id: "opencode-go/glm-5.2",
        label: "GLM-5.2",
        contextWindow: 1000000,
        maxTokens: 131072,
        input: ["text"],
      },
      {
        id: "auto/gpt-5.6-luna",
        label: "GPT-5.6 Luna",
        contextWindow: 922000,
        maxTokens: 128000,
        input: ["text", "image"],
      },
      { id: "opencode-go/glm-5.1", label: "GLM-5.1" },
    ]);
  });

  it("leaves metadata off when the endpoint reports none", async () => {
    openaiListMock.mockResolvedValue(paged([{ id: "gpt-5.4" }]));

    const result = await listProviderModels({
      provider: "openai",
      apiKey: "sk-test",
    });

    expect(result.models).toEqual([{ id: "gpt-5.4", label: "gpt-5.4" }]);
  });

  it("ignores unusable metadata instead of writing NaN or 0", async () => {
    openaiListMock.mockResolvedValue(
      paged([
        {
          id: "relay-model",
          display_name: "   ",
          context_window: "1000000",
          context_length: 0,
          max_output_tokens: -5,
          modalities: { input: ["text", "video"] },
        },
      ]),
    );

    const result = await listProviderModels({
      provider: "custom",
      customProtocol: "openai",
      apiKey: "sk-relay",
      baseUrl: "https://relay.example.com/v1",
    });

    expect(result.models).toEqual([
      { id: "relay-model", label: "relay-model", input: ["text"] },
    ]);
  });
});
