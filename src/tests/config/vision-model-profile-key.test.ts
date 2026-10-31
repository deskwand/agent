import { describe, expect, it } from "vitest";
import { normalizeVisionModelConfig } from "../../main/config/vision-model";
import type { ApiProviderConfig } from "../../renderer/types";

const deepseek: ApiProviderConfig = {
  provider: "deepseek",
  customProtocol: "openai",
  apiKey: "sk-live",
  baseUrl: "https://api.deepseek.com/v1",
  defaultModel: "deepseek-chat",
  models: [{ id: "deepseek-chat", label: "Chat", source: "preset" }],
  updatedAt: "2024-01-01T00:00:00.000Z",
};

const base = {
  enabled: true,
  provider: "openai" as const,
  apiKey: "sk-old",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
};

describe("normalizeVisionModelConfig", () => {
  it("有 providerProfileKey 时用该 profile 的凭证覆盖", () => {
    const out = normalizeVisionModelConfig(
      { ...base, providerProfileKey: "deepseek" },
      { deepseek },
    );
    expect(out).toMatchObject({
      providerProfileKey: "deepseek",
      provider: "deepseek",
      apiKey: "sk-live",
      baseUrl: "https://api.deepseek.com/v1",
      model: "gpt-4o-mini",
    });
  });

  it("profile 被删后降级回自包含字段，不清空用户填的 key", () => {
    const out = normalizeVisionModelConfig(
      { ...base, providerProfileKey: "gone" },
      {},
    );
    expect(out.providerProfileKey).toBeUndefined();
    expect(out.apiKey).toBe("sk-old");
    expect(out.baseUrl).toBe("https://api.openai.com/v1");
  });

  it("没有 providerProfileKey 的旧配置原样返回", () => {
    const out = normalizeVisionModelConfig(base, { deepseek });
    expect(out).toEqual(base);
  });
});
