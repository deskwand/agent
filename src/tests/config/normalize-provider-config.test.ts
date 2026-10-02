import { describe, it, expect } from "vitest";
import {
  normalizeProviderConfig,
  buildProjectedConfig,
  ConfigStore,
} from "../../main/config/config-store";
import type { ProviderProfileKey } from "../../main/config/config-store";
import { normalizeWebAccessConfig } from "../../shared/web-access";

// --------------- normalizeProviderConfig (non-custom path) ---------------

describe("normalizeProviderConfig — non-custom defaultModel selection", () => {
  const profileKey: ProviderProfileKey = "anthropic";

  it("uses raw.defaultModel when it matches a preset model", () => {
    const result = normalizeProviderConfig(profileKey, {
      defaultModel: "claude-opus-4-6",
    });
    expect(result.defaultModel).toBe("claude-opus-4-6");
  });

  it("falls back to first sorted preset when raw.defaultModel is unknown", () => {
    const result = normalizeProviderConfig(profileKey, {
      defaultModel: "nonexistent-model",
    });
    // alphabetically first anthropic preset
    expect(result.defaultModel).toBe("claude-3-7-sonnet-latest");
  });

  it("falls back to first sorted preset when raw.defaultModel is empty", () => {
    const result = normalizeProviderConfig(profileKey, { defaultModel: "" });
    expect(result.defaultModel).toBe("claude-3-7-sonnet-latest");
  });

  it("falls back to first sorted preset when raw is undefined", () => {
    const result = normalizeProviderConfig(profileKey, undefined);
    expect(result.defaultModel).toBe("claude-3-7-sonnet-latest");
  });

  it("falls back to first sorted preset when raw has no defaultModel", () => {
    const result = normalizeProviderConfig(profileKey, {});
    expect(result.defaultModel).toBe("claude-3-7-sonnet-latest");
  });

  it("picks deepseek-flash as the deepseek default (alphabetically first preset)", () => {
    expect(normalizeProviderConfig("deepseek", undefined).defaultModel).toBe(
      "deepseek-flash",
    );
    expect(normalizeProviderConfig("deepseek", {}).defaultModel).toBe(
      "deepseek-flash",
    );
  });

  it("keeps a saved preset model, and falls back when the saved id left the preset", () => {
    expect(
      normalizeProviderConfig("deepseek", { defaultModel: "deepseek-v4-pro" })
        .defaultModel,
    ).toBe("deepseek-v4-pro");
    // deepseek-v4-flash 已不在预设里 → 回落到字母序第一个。功能上等价：
    // 上游把旧名路由到 V4.1 Flash，正是 deepseek-flash。
    expect(
      normalizeProviderConfig("deepseek", {
        defaultModel: "deepseek-v4-flash",
      }).defaultModel,
    ).toBe("deepseek-flash");
  });
});

// --------------- buildProjectedConfig — thinkingLevel ---------------

describe("buildProjectedConfig — thinkingLevel persistence", () => {
  function stub(
    overrides: Partial<ReturnType<typeof buildProjectedConfig>> = {},
  ) {
    return buildProjectedConfig({
      activeProviderKey: "openrouter",
      providers: {},
      deskWandCodePath: "",
      defaultWorkdir: "",
      enableDevLogs: false,
      theme: "light",
      themePreset: "graphite",
      sandboxEnabled: false,
      memoryEnabled: true,
      memoryRuntime: {
        maxNavSteps: 2,
        ingestionConcurrency: 4,
      },
      utilityRuntime: {
        inheritFromActive: true,
        providerProfileKey: undefined,
        model: "",
        timeoutMs: 180000,
      },
      enableThinking: false,
      thinkingLevel: "medium",
      autoSkillLearning: false,
      telemetryEnabled: true,
      isConfigured: false,
      webAccess: normalizeWebAccessConfig(undefined),
      ...overrides,
    });
  }

  it("preserves thinkingLevel from stored config", () => {
    const result = stub({ thinkingLevel: "high" });
    expect(result.thinkingLevel).toBe("high");
  });

  it("does not coerce empty string to valid thinking level (pass-through)", () => {
    const result = stub({ thinkingLevel: "" } as any);
    expect(result.thinkingLevel).toBe("");
  });
});

// --------------- buildProjectedConfig — visionModel ---------------

describe("ConfigStore.saveProvider — openrouter dynamic models", () => {
  it("preserves fetched OpenRouter models and default model", () => {
    const store = new ConfigStore();

    store.saveProvider({
      profileKey: "openrouter",
      config: {
        provider: "openrouter",
        customProtocol: "anthropic",
        apiKey: "sk-or-v1-test",
        baseUrl: "https://openrouter.ai/api/v1",
        defaultModel: "openrouter/alpha-free",
        models: [
          {
            id: "openrouter/alpha-free",
            label: "Alpha Free (Free)",
            source: "preset",
          },
          {
            id: "openrouter/beta-paid",
            label: "Beta Paid",
            source: "preset",
          },
        ],
        updatedAt: "2024-01-01T00:00:00.000Z",
      },
    });

    const saved = store.getAll().providers.openrouter;
    expect(saved?.defaultModel).toBe("openrouter/alpha-free");
    expect(saved?.models).toEqual([
      {
        id: "openrouter/alpha-free",
        label: "Alpha Free (Free)",
        source: "preset",
      },
      {
        id: "openrouter/beta-paid",
        label: "Beta Paid",
        source: "preset",
      },
    ]);
  });

  it("falls back to another configured provider when clearing the active OpenRouter config", () => {
    const store = new ConfigStore();

    store.saveProvider({
      profileKey: "openrouter",
      config: {
        provider: "openrouter",
        customProtocol: "anthropic",
        apiKey: "sk-or-v1-test",
        baseUrl: "https://openrouter.ai/api/v1",
        defaultModel: "openrouter/alpha-free",
        models: [
          {
            id: "openrouter/alpha-free",
            label: "Alpha Free (Free)",
            source: "preset",
          },
        ],
        updatedAt: "2024-01-01T00:00:00.000Z",
      },
    });
    store.saveProvider({
      profileKey: "anthropic",
      config: {
        provider: "anthropic",
        customProtocol: "anthropic",
        apiKey: "sk-ant-test",
        baseUrl: "https://api.anthropic.com",
        defaultModel: "claude-sonnet-4-6",
        models: [],
        updatedAt: "2024-01-01T00:00:00.000Z",
      },
    });
    store.setActiveProvider({ profileKey: "openrouter" });

    const updated = store.deleteProvider({ profileKey: "openrouter" });

    expect(updated.activeProviderKey).toBe("anthropic");
  });
});

describe("buildProjectedConfig — visionModel pass-through", () => {
  function stub(
    overrides: Partial<ReturnType<typeof buildProjectedConfig>> = {},
  ) {
    return buildProjectedConfig({
      activeProviderKey: "openrouter",
      providers: {},
      deskWandCodePath: "",
      defaultWorkdir: "",
      enableDevLogs: false,
      theme: "light",
      themePreset: "graphite",
      sandboxEnabled: false,
      memoryEnabled: true,
      memoryRuntime: {
        maxNavSteps: 2,
        ingestionConcurrency: 4,
      },
      utilityRuntime: {
        inheritFromActive: true,
        providerProfileKey: undefined,
        model: "",
        timeoutMs: 180000,
      },
      enableThinking: false,
      thinkingLevel: "medium",
      autoSkillLearning: false,
      telemetryEnabled: true,
      isConfigured: false,
      webAccess: normalizeWebAccessConfig(undefined),
      ...overrides,
    });
  }

  it("defaults visionModel to undefined", () => {
    const result = stub();
    expect(result.visionModel).toBeUndefined();
  });

  it("preserves visionModel from stored config", () => {
    const config = {
      enabled: true,
      provider: "openai" as const,
      apiKey: "sk-test",
      model: "gpt-4o",
    };
    const result = stub({ visionModel: config });
    expect(result.visionModel).toEqual(config);
  });

  it("preserves visionModel with custom provider", () => {
    const config = {
      enabled: true,
      provider: "custom" as const,
      customProtocol: "gemini" as const,
      apiKey: "key-123",
      baseUrl: "https://custom.api/v1",
      model: "gemini-2.5-flash",
    };
    const result = stub({ visionModel: config });
    expect(result.visionModel).toEqual(config);
  });

  it("passes through disabled visionModel", () => {
    const config = {
      enabled: false,
      provider: "anthropic" as const,
      apiKey: "sk-ant-test",
      model: "",
    };
    const result = stub({ visionModel: config });
    expect(result.visionModel).toEqual(config);
    expect(result.visionModel?.enabled).toBe(false);
  });
});

// --------------- 持久化模型与 disabledModels ---------------
// 设计文档 §4.2.3：预设供应商的模型列表现在来自「连接」流程，
// 读（normalizeProviderConfig）与写（sanitizeSaveProviderPayload）两条路径
// 都必须保留它，只有为空时才回落内置目录。

describe("preset providers keep their persisted model list", () => {
  const persisted = {
    provider: "openai" as const,
    customProtocol: "openai" as const,
    apiKey: "sk-test",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-5.5-preview",
    models: [
      { id: "gpt-5.4", label: "gpt-5.4", source: "preset" as const },
      {
        id: "gpt-5.5-preview",
        label: "gpt-5.5-preview",
        source: "preset" as const,
      },
    ],
    disabledModels: ["gpt-5.4"],
    updatedAt: "2024-01-01T00:00:00.000Z",
  };

  it("keeps the persisted models on read", () => {
    const result = normalizeProviderConfig("openai", persisted);
    expect(result.models.map((m) => m.id)).toEqual([
      "gpt-5.4",
      "gpt-5.5-preview",
    ]);
    expect(result.defaultModel).toBe("gpt-5.5-preview");
    expect(result.disabledModels).toEqual(["gpt-5.4"]);
  });

  it("falls back to the preset list when nothing was persisted", () => {
    const result = normalizeProviderConfig("openai", undefined);
    expect(result.models.length).toBeGreaterThan(0);
    expect(result.disabledModels).toBeUndefined();
  });

  it("drops a default model that is not in the persisted list", () => {
    const result = normalizeProviderConfig("openai", {
      ...persisted,
      defaultModel: "gpt-9-does-not-exist",
    });
    expect(result.models.some((m) => m.id === result.defaultModel)).toBe(true);
  });
});

describe("disabledModels normalization", () => {
  it("dedupes, trims and ignores empty entries", () => {
    const result = normalizeProviderConfig("anthropic", {
      provider: "anthropic",
      customProtocol: "anthropic",
      apiKey: "sk-ant-test",
      baseUrl: "https://api.anthropic.com",
      defaultModel: "claude-sonnet-4-6",
      models: [
        {
          id: "claude-sonnet-4-6",
          label: "claude-sonnet-4-6",
          source: "preset",
        },
      ],
      disabledModels: [" claude-opus-4-6 ", "claude-opus-4-6", "", "   "],
      updatedAt: "2024-01-01T00:00:00.000Z",
    });
    expect(result.disabledModels).toEqual(["claude-opus-4-6"]);
  });
});
