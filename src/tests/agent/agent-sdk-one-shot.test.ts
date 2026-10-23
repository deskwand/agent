import { beforeEach, describe, expect, it, vi } from "vitest";

const completeSimpleMock = vi.hoisted(() => vi.fn());
const resolveProviderApiKeyMock = vi.hoisted(() => vi.fn());

vi.mock("@earendil-works/pi-ai/compat", () => ({
  completeSimple: completeSimpleMock,
  getProviders: vi.fn(() => []),
  getModels: vi.fn(() => []),
  getModel: vi.fn(() => undefined),
}));

vi.mock("../../main/agent/shared-model-runtime", () => ({
  resolveProviderApiKey: resolveProviderApiKeyMock,
}));

import type { AppConfig } from "../../main/config/config-store";
import { normalizeCodemodeConfig } from "../../shared/codemode-config";
import { normalizeWebAccessConfig } from "../../shared/web-access";
import {
  runPiAiOneShot,
  generateTitleWithAgentSdk,
} from "../../main/agent/agent-sdk-one-shot";

function makeConfig(): AppConfig {
  return {
    provider: "custom",
    customProtocol: "openai",
    apiKey: "test-key",
    baseUrl: "https://example.test/v1",
    model: "test-model",
    activeProfileKey: "custom:openai",
    activeProviderKey: "custom:openai",
    profiles: {},
    providers: {
      "custom:openai": {
        provider: "custom",
        customProtocol: "openai",
        apiKey: "test-key",
        baseUrl: "https://example.test/v1",
        defaultModel: "test-model",
        models: [{ id: "test-model", label: "test-model", source: "custom" }],
        updatedAt: "2026-05-24T00:00:00.000Z",
      },
    },
    deskWandCodePath: "",
    defaultWorkdir: "",
    enableDevLogs: false,
    theme: "light",
    sandboxEnabled: false,
    memoryEnabled: true,
    memoryRuntime: {
      maxNavSteps: 2,
      ingestionConcurrency: 4,
      storageRoot: "",
    },
    utilityRuntime: {
      inheritFromActive: true,
      providerProfileKey: undefined,
      model: "",
      timeoutMs: 180000,
    },
    enableThinking: false,
    themePreset: "zinc",
    thinkingLevel: "medium",
    autoSkillLearning: false,
    telemetryEnabled: true,
    isConfigured: true,
    webAccess: normalizeWebAccessConfig(undefined),
    codemode: normalizeCodemodeConfig(undefined),
  };
}

describe("runPiAiOneShot", () => {
  beforeEach(() => {
    completeSimpleMock.mockReset();
    completeSimpleMock.mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
      stopReason: "stop",
    });
  });

  it("passes generation options through to completeSimple", async () => {
    await runPiAiOneShot("hello", "system", makeConfig(), {
      temperature: 0.2,
      maxTokens: 1234,
    });

    expect(completeSimpleMock).toHaveBeenCalledTimes(1);
    expect(completeSimpleMock.mock.calls[0][2]).toMatchObject({
      apiKey: "test-key",
      temperature: 0.2,
      maxTokens: 1234,
    });
  });

  it("injects a session id so OpenCode can route one-shot requests", async () => {
    await runPiAiOneShot("hello", "system", makeConfig());

    const options = completeSimpleMock.mock.calls[0][2] as {
      sessionId?: unknown;
    };
    expect(typeof options.sessionId).toBe("string");
    expect((options.sessionId as string).length).toBeGreaterThan(0);
  });

  it("passes an explicit session id through", async () => {
    await runPiAiOneShot("hello", "system", makeConfig(), {
      sessionId: "session-abc",
    });

    expect(completeSimpleMock.mock.calls[0][2]).toMatchObject({
      sessionId: "session-abc",
    });
  });

  it("generates a distinct session id per one-shot call", async () => {
    await runPiAiOneShot("first", "system", makeConfig());
    await runPiAiOneShot("second", "system", makeConfig());

    const first = completeSimpleMock.mock.calls[0][2] as { sessionId: string };
    const second = completeSimpleMock.mock.calls[1][2] as {
      sessionId: string;
    };
    expect(first.sessionId).not.toBe(second.sessionId);
  });

  it("reuses the conversation session id for title generation", async () => {
    await generateTitleWithAgentSdk(
      "title prompt",
      makeConfig(),
      "session-xyz",
    );

    expect(completeSimpleMock.mock.calls[0][2]).toMatchObject({
      sessionId: "session-xyz",
    });
  });

  it("still injects a session id when title generation has no conversation", async () => {
    await generateTitleWithAgentSdk("title prompt", makeConfig());

    const options = completeSimpleMock.mock.calls[0][2] as {
      sessionId?: unknown;
    };
    expect(typeof options.sessionId).toBe("string");
    expect((options.sessionId as string).length).toBeGreaterThan(0);
  });

  it("resolves OAuth through the shared ModelRuntime adapter", async () => {
    const config = makeConfig();
    config.provider = "oauth";
    config.apiKey = "";
    config.activeProfileKey = "oauth:openai-codex";
    config.activeProviderKey = "oauth:openai-codex";
    config.model = "gpt-5.4";
    config.providers = {
      "oauth:openai-codex": {
        provider: "oauth",
        customProtocol: "openai",
        apiKey: "",
        defaultModel: "gpt-5.4",
        models: [{ id: "gpt-5.4", label: "gpt-5.4", source: "preset" }],
        updatedAt: "2026-07-27T00:00:00.000Z",
      },
    };
    resolveProviderApiKeyMock.mockResolvedValue("oauth-token");

    await runPiAiOneShot("hello", "system", config);

    expect(resolveProviderApiKeyMock).toHaveBeenCalledWith("openai-codex");
    expect(completeSimpleMock.mock.calls[0][2]).toMatchObject({
      apiKey: "oauth-token",
    });
  });
});
