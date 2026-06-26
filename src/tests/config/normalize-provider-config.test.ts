import { describe, it, expect } from "vitest";
import {
  normalizeProviderConfig,
  buildProjectedConfig,
} from "../../main/config/config-store";
import type { ProviderProfileKey } from "../../main/config/config-store";

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
});

// --------------- buildProjectedConfig — thinkingLevel ---------------

describe("buildProjectedConfig — thinkingLevel persistence", () => {
  function stub(overrides: Partial<ReturnType<typeof buildProjectedConfig>> = {}) {
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
        llm: { inheritFromActive: true, timeoutMs: 180000 },
        embedding: { inheritFromActive: true, model: "text-embedding-3-small", timeoutMs: 180000 },
        useEmbedding: false,
        maxNavSteps: 2,
        ingestionConcurrency: 4,
      },
      enableThinking: false,
      thinkingLevel: "medium",
      autoSkillLearning: false,
      isConfigured: false,
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

describe("buildProjectedConfig — visionModel pass-through", () => {
  function stub(overrides: Partial<ReturnType<typeof buildProjectedConfig>> = {}) {
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
        llm: { inheritFromActive: true, timeoutMs: 180000 },
        embedding: { inheritFromActive: true, model: "text-embedding-3-small", timeoutMs: 180000 },
        useEmbedding: false,
        maxNavSteps: 2,
        ingestionConcurrency: 4,
      },
      enableThinking: false,
      thinkingLevel: "medium",
      autoSkillLearning: false,
      isConfigured: false,
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
