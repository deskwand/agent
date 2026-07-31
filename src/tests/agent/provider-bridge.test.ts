import type { Api, Model } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../../main/config/config-store";

const resolveMock = vi.hoisted(() => vi.fn());

vi.mock("../../main/model/model-resolution-service", () => ({
  modelResolutionService: { resolve: resolveMock },
}));

import {
  registerDeskWandProviders,
  resolveDeskWandModel,
} from "../../main/agent/subagent/provider-bridge";

const model: Model<Api> = {
  id: "model",
  name: "model",
  api: "openai-completions",
  provider: "openai",
  baseUrl: "https://example.test/v1",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 32000,
  maxTokens: 4096,
};

const appConfig = {
  providers: {
    current: {
      provider: "openai",
      customProtocol: "openai",
      apiKey: "profile-key",
      baseUrl: "https://example.test/v1",
      defaultModel: "model",
      models: [{ id: "model", label: "model", source: "custom" }],
      updatedAt: "2026-07-27T00:00:00.000Z",
    },
  },
} as unknown as AppConfig;

const runtimeMock = {
  getRegisteredProviderIds: vi.fn(() => ["deskwand:removed"]),
  unregisterProvider: vi.fn(),
  removeRuntimeApiKey: vi.fn(async () => undefined),
  registerProvider: vi.fn(),
  setRuntimeApiKey: vi.fn(async () => undefined),
  getModel: vi.fn(),
};
const runtime = runtimeMock as unknown as ModelRuntime;

describe("registerDeskWandProviders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtimeMock.getRegisteredProviderIds.mockReturnValue(["deskwand:removed"]);
    runtimeMock.removeRuntimeApiKey.mockResolvedValue(undefined);
    runtimeMock.setRuntimeApiKey.mockResolvedValue(undefined);
    runtimeMock.getModel.mockReturnValue(model);
    resolveMock.mockResolvedValue({
      providerProfileKey: "current",
      providerType: "openai",
      customProtocol: "openai",
      protocol: "openai",
      modelId: "model",
      apiKey: "profile-key",
      baseUrl: "https://example.test/v1",
      contextWindow: 32000,
      maxTokens: 4096,
      piModel: model,
      trace: {
        providerSource: "session",
        modelSource: "provider.defaultModel",
        piModelSource: "registry",
        notes: [],
      },
    });
  });

  it("removes stale providers and registers current profiles", async () => {
    await registerDeskWandProviders(runtime, appConfig);

    expect(runtimeMock.unregisterProvider).toHaveBeenCalledWith(
      "deskwand:removed",
    );
    expect(runtimeMock.removeRuntimeApiKey).toHaveBeenCalledWith(
      "deskwand:removed",
    );
    expect(runtimeMock.registerProvider).toHaveBeenCalledWith(
      "deskwand:current",
      expect.objectContaining({
        name: "current",
        apiKey: "deskwand-runtime-placeholder",
      }),
    );
    expect(runtimeMock.setRuntimeApiKey).toHaveBeenCalledWith(
      "deskwand:current",
      "profile-key",
      { allowNetwork: false },
    );
  });

  it("resolves a namespaced model exactly", () => {
    expect(resolveDeskWandModel("deskwand:current/model", runtime)).toBe(model);
    expect(runtimeMock.getModel).toHaveBeenCalledWith(
      "deskwand:current",
      "model",
    );
  });

  it("serializes concurrent synchronization", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<undefined>((resolve) => {
      release = () => resolve(undefined);
    });
    runtimeMock.setRuntimeApiKey
      .mockImplementationOnce(() => gate)
      .mockResolvedValue(undefined);

    const first = registerDeskWandProviders(runtime, appConfig);
    await vi.waitFor(() => {
      expect(runtimeMock.setRuntimeApiKey).toHaveBeenCalledTimes(1);
    });
    const second = registerDeskWandProviders(runtime, appConfig);
    await Promise.resolve();
    expect(runtimeMock.registerProvider).toHaveBeenCalledTimes(1);

    release?.();
    await first;
    await second;
    expect(runtimeMock.registerProvider).toHaveBeenCalledTimes(2);
  });

  it("allows a later synchronization after mutation failure", async () => {
    runtimeMock.setRuntimeApiKey
      .mockRejectedValueOnce(new Error("key update failed"))
      .mockResolvedValue(undefined);

    await expect(registerDeskWandProviders(runtime, appConfig)).rejects.toThrow(
      "key update failed",
    );
    await expect(
      registerDeskWandProviders(runtime, appConfig),
    ).resolves.toBeUndefined();
  });
});
