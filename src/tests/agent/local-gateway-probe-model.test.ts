import { beforeEach, describe, expect, it, vi } from "vitest";

const completeSimpleMock = vi.hoisted(() => vi.fn());
const getModelMock = vi.hoisted(() => vi.fn());

vi.mock("@earendil-works/pi-ai/compat", () => ({
  completeSimple: completeSimpleMock,
  getProviders: vi.fn(() => ["opencode-go"]),
  getModels: vi.fn(() => []),
  getModel: getModelMock,
}));

vi.mock("../../main/agent/shared-model-runtime", () => ({
  resolveProviderApiKey: vi.fn(),
}));

import type { AppConfig } from "../../main/config/config-store";
import { normalizeCodemodeConfig } from "../../shared/codemode-config";
import { normalizeWebAccessConfig } from "../../shared/web-access";
import { probeWithAgentSdk } from "../../main/agent/agent-sdk-one-shot";

const registryModel = {
  id: "kimi-k3",
  name: "Kimi K3",
  provider: "opencode-go",
  api: "openai-completions",
  baseUrl: "https://registry.test/v1",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 1_000_000,
  maxTokens: 16_384,
};

function makeConfig(): AppConfig {
  return {
    provider: "openrouter",
    customProtocol: "anthropic",
    apiKey: "or-key",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "anthropic/claude-sonnet-4-6",
    activeProfileKey: "openrouter",
    activeProviderKey: "openrouter",
    profiles: {},
    providers: {
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
            source: "preset",
          },
        ],
        updatedAt: "2026-10-24T00:00:00.000Z",
      },
      "custom:magpie": {
        provider: "custom",
        customProtocol: "openai",
        name: "Magpie",
        apiKey: "magpie",
        baseUrl: "http://127.0.0.1:3425/v1",
        defaultModel: "opencode-go/kimi-k3",
        models: [
          {
            id: "opencode-go/kimi-k3",
            label: "Kimi K3",
            source: "custom",
          },
        ],
        localGateway: "magpie",
        updatedAt: "2026-10-24T00:00:00.000Z",
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

describe("probeWithAgentSdk — local gateway model ids", () => {
  beforeEach(() => {
    completeSimpleMock.mockReset();
    completeSimpleMock.mockResolvedValue({
      content: [{ type: "text", text: "2+2=4 sdk_probe_ok" }],
      stopReason: "stop",
    });
    getModelMock.mockReset();
    getModelMock.mockImplementation((provider: string, model: string) =>
      provider === "opencode-go" && model === "kimi-k3"
        ? registryModel
        : undefined,
    );
  });

  it("keeps the namespace when probing a non-active Magpie profile", async () => {
    const result = await probeWithAgentSdk(
      {
        provider: "custom",
        customProtocol: "openai",
        apiKey: "magpie",
        baseUrl: "http://127.0.0.1:3425/v1",
        model: "opencode-go/kimi-k3",
      },
      makeConfig(),
    );

    expect(result.ok).toBe(true);
    expect(completeSimpleMock).toHaveBeenCalledTimes(1);
    const sent = completeSimpleMock.mock.calls[0][0] as { id: string };
    expect(sent.id).toBe("opencode-go/kimi-k3");
  });
});
