import { beforeEach, describe, expect, it, vi } from "vitest";

const getModelsDevContextWindowMock = vi.hoisted(() => vi.fn());
vi.mock("../../main/config/models-dev-catalog", () => ({
  getModelsDevContextWindow: getModelsDevContextWindowMock,
}));

import {
  resolveModelContextWindow,
  resolveModelReasoning,
  resolvePiRouteProtocol,
} from "../../main/agent/pi-model-resolution";

describe("resolvePiRouteProtocol", () => {
  it("routes opencode providers to their registry provider names", () => {
    expect(resolvePiRouteProtocol("opencode")).toBe("opencode");
    expect(resolvePiRouteProtocol("opencode-go")).toBe("opencode-go");
  });

  it("keeps existing provider routing unchanged", () => {
    expect(resolvePiRouteProtocol("openrouter")).toBe("openai");
    expect(resolvePiRouteProtocol("deepseek")).toBe("openai");
    expect(resolvePiRouteProtocol("anthropic")).toBe("anthropic");
    expect(resolvePiRouteProtocol("gemini")).toBe("gemini");
  });
});

describe("resolveModelContextWindow — provider aware", () => {
  beforeEach(() => {
    getModelsDevContextWindowMock.mockReset();
    getModelsDevContextWindowMock.mockReturnValue(undefined);
  });

  it("reads the context window from the session's own provider", () => {
    // 同一 id 在两个 provider 下取值不同，必须按 provider 取
    expect(resolveModelContextWindow("minimax-m3", "opencode-go")).toBe(
      1000000,
    );
    expect(resolveModelContextWindow("minimax-m3", "opencode")).toBe(512000);
  });

  it("falls back to models.dev when the registry is stale", () => {
    getModelsDevContextWindowMock.mockReturnValue(1000000);
    expect(
      resolveModelContextWindow(
        "deskwand-endpoint-only-test-model",
        "opencode-go",
      ),
    ).toBe(1000000);
    expect(getModelsDevContextWindowMock).toHaveBeenCalledWith(
      "opencode-go",
      "deskwand-endpoint-only-test-model",
    );
  });

  it("does not consult the catalog without a provider", () => {
    getModelsDevContextWindowMock.mockReturnValue(1000000);
    // custom / 未知 profile 没有注册表 provider，目录里也无从命中
    expect(resolveModelContextWindow("deskwand-endpoint-only-test-model")).toBe(
      0,
    );
    expect(getModelsDevContextWindowMock).not.toHaveBeenCalled();
  });

  it("prefers the catalog over the local family table for cloud providers", () => {
    // qwen3.9-ultra 不在任何 provider 的注册表里，裸前缀会误中 qwen3（40960）
    getModelsDevContextWindowMock.mockReturnValue(1000000);
    expect(resolveModelContextWindow("qwen3.9-ultra", "opencode-go")).toBe(
      1000000,
    );
  });

  it("does not use the local family table for cloud providers", () => {
    expect(resolveModelContextWindow("qwen3.9-ultra", "opencode-go")).toBe(0);
    // 同族里真实存在的 id 也不再被 40960 截胡，而是拿到注册表的 1M
    expect(resolveModelContextWindow("qwen3.7-max", "opencode-go")).toBe(
      1000000,
    );
  });

  it("strips a provider prefix from the model string", () => {
    expect(
      resolveModelContextWindow("opencode-go/minimax-m3", "opencode-go"),
    ).toBe(1000000);
  });

  it("keeps the Ollama family fallback ahead of the catalog", () => {
    getModelsDevContextWindowMock.mockReturnValue(1);
    expect(resolveModelContextWindow("llama3.2:3b", "ollama")).toBe(131072);
    expect(resolveModelContextWindow("qwen3.5:0.8b")).toBe(258048);
  });

  it("returns 0 for unknown models instead of inventing a number", () => {
    expect(resolveModelContextWindow("totally-unknown-model")).toBe(0);
  });
});

describe("resolveModelReasoning", () => {
  it("reads reasoning from a registry entry with the same id", () => {
    // deepseek-flash 在 pi-ai 1.4.0 目录里是 reasoning:true；gpt-4o 是 false
    expect(resolveModelReasoning("deepseek-flash")).toBe(true);
    expect(resolveModelReasoning("gpt-4o")).toBe(false);
  });

  it("strips a provider prefix before the registry lookup", () => {
    expect(resolveModelReasoning("deepseek/deepseek-flash")).toBe(true);
  });

  it("matches the label when the id is a relay alias", () => {
    // 真机案例：qoder 中转把 DeepSeek-Flash 暴露成 qoder/dfmodel
    expect(resolveModelReasoning("qoder/dfmodel", "DeepSeek-Flash")).toBe(true);
    expect(resolveModelReasoning("relay-alias", "DeepSeek Flash")).toBe(true);
  });

  it("returns false when neither id nor label names a reasoning model", () => {
    expect(resolveModelReasoning("qoder/dfmodel", "DF Model")).toBe(false);
    expect(resolveModelReasoning("my-relay-model")).toBe(false);
    expect(resolveModelReasoning("")).toBe(false);
  });

  it("still recognises the id keywords used before this change", () => {
    expect(resolveModelReasoning("some-reasoner-v2")).toBe(true);
    expect(resolveModelReasoning("kimi-k2-thinking")).toBe(true);
  });
});
