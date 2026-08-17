import { describe, expect, it } from "vitest";
import {
  buildUtilityAppConfig,
  resolveUtilityModelConfig,
} from "../../main/memory/memory-llm-client";
import type { AppConfig } from "../../main/config/config-store";

function baseConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    provider: "openrouter",
    apiKey: "main-key",
    baseUrl: "https://openrouter.ai/api/v1",
    customProtocol: undefined,
    model: "anthropic/claude-sonnet-4-6",
    activeProfileKey: "openrouter",
    profiles: {},
    activeProviderKey: "openrouter",
    providers: {
      openrouter: {
        provider: "openrouter",
        customProtocol: undefined,
        apiKey: "main-key",
        baseUrl: "https://openrouter.ai/api/v1",
        models: [{ id: "anthropic/claude-sonnet-4-6", label: "Claude" }],
        defaultModel: "anthropic/claude-sonnet-4-6",
        updatedAt: "",
      } as never,
      "custom:deepseek": {
        provider: "custom",
        customProtocol: "openai",
        apiKey: "ds-key",
        baseUrl: "https://api.deepseek.com/v1",
        models: [{ id: "deepseek-chat", label: "DeepSeek Chat" }],
        defaultModel: "deepseek-chat",
        updatedAt: "",
      } as never,
    },
    utilityRuntime: {
      inheritFromActive: true,
      providerProfileKey: undefined,
      model: "",
      timeoutMs: 180000,
    },
    webAccess: {} as never,
    isConfigured: true,
    ...overrides,
  } as AppConfig;
}

describe("resolveUtilityModelConfig", () => {
  it("inherits main model when inheritFromActive is true", () => {
    const resolved = resolveUtilityModelConfig(baseConfig(), "fallback");
    expect(resolved).toMatchObject({
      provider: "openrouter",
      apiKey: "main-key",
      model: "anthropic/claude-sonnet-4-6",
      activeProviderKey: "openrouter",
    });
  });

  it("resolves referenced profile with default model when inherit is false", () => {
    const cfg = baseConfig({
      utilityRuntime: {
        inheritFromActive: false,
        providerProfileKey: "custom:deepseek",
        model: "",
        timeoutMs: 180000,
      },
    });
    const resolved = resolveUtilityModelConfig(cfg, "fallback");
    expect(resolved).toMatchObject({
      provider: "custom",
      customProtocol: "openai",
      apiKey: "ds-key",
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
      activeProviderKey: "custom:deepseek",
    });
  });

  it("falls back to main model when referenced profile is missing", () => {
    const cfg = baseConfig({
      utilityRuntime: {
        inheritFromActive: false,
        providerProfileKey: "custom:gone",
        model: "",
        timeoutMs: 180000,
      },
    });
    const resolved = resolveUtilityModelConfig(cfg, "fallback");
    expect(resolved.model).toBe("anthropic/claude-sonnet-4-6");
    expect(resolved.provider).toBe("openrouter");
  });
});

describe("buildUtilityAppConfig", () => {
  it("overrides model fields and keeps the rest", () => {
    const cfg = baseConfig({
      utilityRuntime: {
        inheritFromActive: false,
        providerProfileKey: "custom:deepseek",
        model: "",
        timeoutMs: 180000,
      },
    });
    const resolved = resolveUtilityModelConfig(cfg, "fallback");
    const built = buildUtilityAppConfig(cfg, resolved);
    expect(built.model).toBe("deepseek-chat");
    expect(built.provider).toBe("custom");
    expect(built.apiKey).toBe("ds-key");
    expect(built.activeProviderKey).toBe("custom:deepseek");
  });

  it("syncs activeProviderKey for an OAuth profile", () => {
    const cfg = baseConfig({
      providers: {
        "oauth:openai-codex": {
          provider: "oauth",
          customProtocol: undefined,
          apiKey: "",
          baseUrl: "",
          models: [{ id: "gpt-5-codex", label: "Codex" }],
          defaultModel: "gpt-5-codex",
          updatedAt: "",
        } as never,
      },
      utilityRuntime: {
        inheritFromActive: false,
        providerProfileKey: "oauth:openai-codex",
        model: "",
        timeoutMs: 180000,
      },
    });
    const resolved = resolveUtilityModelConfig(cfg, "fallback");
    expect(resolved.provider).toBe("oauth");
    expect(resolved.apiKey).toBe("");
    expect(resolved.activeProviderKey).toBe("oauth:openai-codex");

    const built = buildUtilityAppConfig(cfg, resolved);
    expect(built.activeProviderKey).toBe("oauth:openai-codex");
    expect(built.provider).toBe("oauth");
  });
});
