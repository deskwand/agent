import { describe, expect, it } from "vitest";
import type {
  ApiProviderConfig,
  AppConfig,
} from "../../../main/config/config-store";
import { resolveWebAccessProviderAuth } from "../../../main/agent/tools/web-access/config-adapter";
import { normalizeWebAccessConfig } from "../../../shared/web-access";

function providerConfig(
  provider: ApiProviderConfig["provider"],
  apiKey: string,
  customProtocol: ApiProviderConfig["customProtocol"],
): ApiProviderConfig {
  return {
    provider,
    customProtocol,
    apiKey,
    baseUrl:
      customProtocol === "gemini"
        ? "https://generativelanguage.googleapis.com"
        : "https://api.openai.com/v1",
    defaultModel: "model",
    models: [{ id: "model", label: "model", source: "custom" }],
    updatedAt: "2026-07-17T00:00:00.000Z",
  };
}

function appConfigWithProviders(providers: AppConfig["providers"]): AppConfig {
  return {
    provider: "openai",
    apiKey: "",
    model: "gpt-5.4",
    activeProfileKey: "openai",
    profiles: {},
    activeProviderKey: "openai",
    providers,
    enableDevLogs: false,
    theme: "light",
    themePreset: "graphite",
    sandboxEnabled: false,
    memoryEnabled: true,
    memoryRuntime: {
      llm: { inheritFromActive: true, timeoutMs: 180000 },
      embedding: { inheritFromActive: true, timeoutMs: 180000 },
      useEmbedding: false,
      maxNavSteps: 2,
      ingestionConcurrency: 4,
    },
    enableThinking: false,
    thinkingLevel: "medium",
    autoSkillLearning: true,
    isConfigured: true,
    webAccess: normalizeWebAccessConfig(undefined),
  };
}

describe("normalizeWebAccessConfig", () => {
  it("allowlists providers and credential sources while trimming strings", () => {
    const normalized = normalizeWebAccessConfig({
      defaultProvider: "unknown",
      openai: {
        source: "unknown",
        profileKey: " openai ",
        apiKey: 42,
        baseUrl: " https://api.openai.com/v1/ ",
      },
      braveApiKey: " brave-key ",
    });
    expect(normalized).toMatchObject({
      defaultProvider: "auto",
      openai: {
        source: "inherit",
        profileKey: "openai",
        apiKey: "",
        baseUrl: "https://api.openai.com/v1/",
      },
      braveApiKey: "brave-key",
    });
    expect(normalized.openai).not.toBe(
      normalizeWebAccessConfig(undefined).openai,
    );
  });
});

describe("resolveWebAccessProviderAuth", () => {
  it("uses a dedicated OpenAI key", async () => {
    const result = await resolveWebAccessProviderAuth(
      "openai",
      {
        source: "dedicated",
        profileKey: "",
        apiKey: "dedicated",
        baseUrl: "https://api.openai.com/v1",
      },
      appConfigWithProviders({}),
      async () => undefined,
    );
    expect(result).toMatchObject({
      provider: "openai",
      apiKey: "dedicated",
    });
  });

  it("inherits only the selected compatible profile", async () => {
    const result = await resolveWebAccessProviderAuth(
      "gemini",
      {
        source: "inherit",
        profileKey: "gemini",
        apiKey: "",
        baseUrl: "",
      },
      appConfigWithProviders({
        gemini: providerConfig("gemini", "gemini-key", "gemini"),
        openai: providerConfig("openai", "wrong-key", "openai"),
      }),
      async () => undefined,
    );
    expect(result).toMatchObject({
      provider: "gemini",
      apiKey: "gemini-key",
    });
  });

  it("rejects a protocol-incompatible inherited profile", async () => {
    const result = await resolveWebAccessProviderAuth(
      "openai",
      {
        source: "inherit",
        profileKey: "gemini",
        apiKey: "",
        baseUrl: "",
      },
      appConfigWithProviders({
        gemini: providerConfig("gemini", "key", "gemini"),
      }),
      async () => undefined,
    );
    expect(result).toBeUndefined();
  });

  it("refreshes an inherited openai-codex OAuth token", async () => {
    const result = await resolveWebAccessProviderAuth(
      "openai",
      {
        source: "inherit",
        profileKey: "oauth:openai-codex",
        apiKey: "",
        baseUrl: "",
      },
      appConfigWithProviders({
        "oauth:openai-codex": providerConfig("oauth", "", "openai"),
      }),
      async (providerId) =>
        providerId === "openai-codex" ? "oauth-token" : undefined,
    );
    expect(result).toMatchObject({
      provider: "openai-codex",
      apiKey: "oauth-token",
    });
  });
});
