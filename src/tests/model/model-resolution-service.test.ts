import { describe, expect, it, vi } from "vitest";

vi.mock("../../main/config/ollama-api", () => ({
  fetchOllamaModelInfo: vi.fn(async () => ({
    contextWindow: undefined,
    parameterSize: undefined,
  })),
}));

import { ModelResolutionService } from "../../main/model/model-resolution-service";
import type {
  AppConfig,
  ProviderProfileKey,
} from "../../main/config/config-store";

function buildAppConfig(): AppConfig {
  const providers = {
    openrouter: {
      provider: "openrouter",
      customProtocol: "anthropic",
      apiKey: "or-key",
      baseUrl: "https://openrouter.ai/api/v1",
      defaultModel: "anthropic/claude-sonnet-4-6",
      models: [
        {
          id: "anthropic/claude-sonnet-4-6",
          label: "anthropic/claude-sonnet-4-6",
          source: "preset" as const,
        },
      ],
      updatedAt: "2024-01-01T00:00:00.000Z",
    },
    openai: {
      provider: "openai",
      customProtocol: "openai",
      apiKey: "oa-key",
      baseUrl: "https://api.openai.com/v1/chat/completions",
      defaultModel: "gpt-5.4",
      models: [{ id: "gpt-5.4", label: "gpt-5.4", source: "preset" as const }],
      updatedAt: "2024-01-01T00:00:00.000Z",
    },
    anthropic: {
      provider: "anthropic",
      customProtocol: "anthropic",
      apiKey: "an-key",
      baseUrl: "https://api.anthropic.com",
      defaultModel: "claude-sonnet-4-6",
      models: [
        {
          id: "claude-sonnet-4-6",
          label: "claude-sonnet-4-6",
          source: "preset" as const,
        },
      ],
      updatedAt: "2024-01-01T00:00:00.000Z",
    },
    deepseek: {
      provider: "deepseek",
      customProtocol: "openai",
      apiKey: "ds-key",
      baseUrl: "https://api.deepseek.com/v1",
      defaultModel: "deepseek-v4-pro",
      models: [
        {
          id: "deepseek-v4-pro",
          label: "deepseek-v4-pro",
          source: "preset" as const,
        },
      ],
      updatedAt: "2024-01-01T00:00:00.000Z",
    },
    gemini: {
      provider: "gemini",
      customProtocol: "gemini",
      apiKey: "gm-key",
      baseUrl: "https://generativelanguage.googleapis.com",
      defaultModel: "gemini-2.5-flash",
      models: [
        {
          id: "gemini-2.5-flash",
          label: "gemini-2.5-flash",
          source: "preset" as const,
        },
      ],
      updatedAt: "2024-01-01T00:00:00.000Z",
    },
    "custom:anthropic": {
      provider: "custom",
      customProtocol: "anthropic",
      apiKey: "ca-key",
      baseUrl: "https://custom.example.com/anthropic",
      defaultModel: "glm-5",
      models: [{ id: "glm-5", label: "glm-5", source: "custom" as const }],
      updatedAt: "2024-01-01T00:00:00.000Z",
    },
    "custom:openai": {
      provider: "custom",
      customProtocol: "openai",
      apiKey: "co-key",
      baseUrl: "https://proxy.example.com/v1/chat/completions",
      defaultModel: "my-model",
      models: [
        {
          id: "my-model",
          label: "my-model",
          source: "custom" as const,
          contextWindow: 32000,
          maxTokens: 4000,
        },
      ],
      updatedAt: "2024-01-01T00:00:00.000Z",
    },
    "custom:gemini": {
      provider: "custom",
      customProtocol: "gemini",
      apiKey: "cg-key",
      baseUrl: "https://gemini-proxy.example.com",
      defaultModel: "gemini-proxy",
      models: [
        {
          id: "gemini-proxy",
          label: "gemini-proxy",
          source: "custom" as const,
        },
      ],
      updatedAt: "2024-01-01T00:00:00.000Z",
    },
  } satisfies AppConfig["providers"];

  return {
    provider: "openrouter",
    apiKey: "or-key",
    baseUrl: "https://openrouter.ai/api/v1",
    customProtocol: "anthropic",
    model: "anthropic/claude-sonnet-4-6",
    contextWindow: undefined,
    maxTokens: undefined,
    activeProfileKey: "openrouter",
    profiles: {},
    activeProviderKey: "openrouter",
    providers,
    deskWandCodePath: "",
    defaultWorkdir: "",
    enableDevLogs: false,
    theme: "light",
    sandboxEnabled: false,
    memoryEnabled: true,
    memoryRuntime: {
      llm: { inheritFromActive: true, timeoutMs: 180000 },
      embedding: { inheritFromActive: true, timeoutMs: 180000 },
      useEmbedding: false,
      maxNavSteps: 2,
      ingestionConcurrency: 4,
      storageRoot: "",
      evalEnabled: false,
      evalWorkspaces: [],
      evalMaxRounds: 12,
      evalArtifactsRoot: "",
      promptIterationRounds: 2,
    },
    enableThinking: false,
    themePreset: "graphite",
    thinkingLevel: "medium",
    autoSkillLearning: false,
    isConfigured: true,
  };
}

describe("ModelResolutionService", () => {
  const service = new ModelResolutionService();

  it("uses session provider and session model when provided", async () => {
    const result = await service.resolve({
      sessionProviderProfileKey: "openai",
      sessionModel: "gpt-5.4",
      appConfig: buildAppConfig(),
    });

    expect(result.providerProfileKey).toBe("openai");
    expect(result.modelId).toBe("gpt-5.4");
    expect(result.trace.providerSource).toBe("session");
    expect(result.trace.modelSource).toBe("session");
  });

  it("falls back to active provider when session provider is missing", async () => {
    const result = await service.resolve({
      sessionProviderProfileKey: "openai" as ProviderProfileKey,
      sessionModel: undefined,
      appConfig: {
        ...buildAppConfig(),
        activeProviderKey: "anthropic",
        providers: { ...buildAppConfig().providers, openai: undefined },
      },
    });

    expect(result.providerProfileKey).toBe("anthropic");
    expect(result.trace.providerSource).toBe("activeProvider");
    expect(result.trace.notes).toContain(
      "session_provider_missing_fell_back_to_active",
    );
  });

  it("normalizes openai-compatible base url", async () => {
    const result = await service.resolve({
      sessionProviderProfileKey: "custom:openai",
      sessionModel: "my-model",
      appConfig: buildAppConfig(),
    });

    expect(result.baseUrl).toBe("https://proxy.example.com/v1");
    expect(result.trace.notes).toContain(
      "normalized_openai_compatible_base_url",
    );
  });

  it("uses synthetic model when registry lookup misses", async () => {
    const result = await service.resolve({
      sessionProviderProfileKey: "custom:openai",
      sessionModel: "my-model",
      appConfig: buildAppConfig(),
    });

    expect(result.trace.piModelSource).toBe("synthetic");
    expect(result.trace.notes).toContain("registry_model_not_found");
    expect(result.piModel.id).toBe("my-model");
  });

  it("uses provider default model when session model is absent", async () => {
    const result = await service.resolve({
      sessionProviderProfileKey: "anthropic",
      appConfig: buildAppConfig(),
    });

    expect(result.modelId).toBe("claude-sonnet-4-6");
    expect(result.trace.modelSource).toBe("provider.defaultModel");
  });

  it("resolves a standard OpenRouter provider with a stored API key", async () => {
    const result = await service.resolve({
      sessionProviderProfileKey: "openrouter",
      sessionModel: "anthropic/claude-sonnet-4-6",
      appConfig: buildAppConfig(),
    });

    expect(result.providerProfileKey).toBe("openrouter");
    expect(result.providerType).toBe("openrouter");
    expect(result.apiKey).toBe("or-key");
    expect(result.baseUrl).toBe("https://openrouter.ai/api/v1");
  });

  it("fails when a standard OpenRouter provider has no API key", async () => {
    const appConfig = buildAppConfig();
    appConfig.providers.openrouter = {
      ...appConfig.providers.openrouter!,
      apiKey: "",
    };

    await expect(
      service.resolve({
        sessionProviderProfileKey: "openrouter",
        sessionModel: "anthropic/claude-sonnet-4-6",
        appConfig,
      }),
    ).rejects.toThrow(/api key/i);
  });
});
