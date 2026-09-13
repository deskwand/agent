import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SaveProviderPayload } from "../../main/config/config-store";

const mocks = vi.hoisted(() => ({
  getModels: vi.fn(),
  logWarn: vi.fn(),
  seed: {} as Record<string, unknown>,
}));

vi.mock("@earendil-works/pi-ai/compat", () => ({
  getModels: mocks.getModels,
}));

vi.mock("../../main/utils/logger", () => ({
  logWarn: mocks.logWarn,
}));

vi.mock("electron-store", () => {
  class MockStore {
    public store: Record<string, unknown>;
    public path = "/tmp/oauth-provider-models.json";

    constructor(options: { defaults?: Record<string, unknown> }) {
      this.store = { ...options.defaults, ...mocks.seed };
    }

    set(value: Record<string, unknown>): void {
      this.store = { ...this.store, ...value };
    }
  }

  return { default: MockStore };
});

import {
  ConfigStore,
  enrichProviderModelsFromRegistry,
} from "../../main/config/config-store";

function oauthPayload(
  providerId: string,
  defaultModel = "",
): SaveProviderPayload {
  return {
    profileKey: `oauth:${providerId}`,
    config: {
      provider: "oauth",
      customProtocol: "anthropic",
      apiKey: "",
      baseUrl: "",
      defaultModel,
      models: [],
      updatedAt: "2026-09-13T00:00:00.000Z",
    },
  };
}

describe("OAuth provider SDK model catalogs", () => {
  beforeEach(() => {
    mocks.getModels.mockReset();
    mocks.logWarn.mockReset();
    mocks.seed = {};
  });

  it("uses the SDK catalog and selects its first model for a new OAuth profile", async () => {
    mocks.getModels.mockReturnValue([
      {
        id: "gpt-6-astra",
        name: "GPT-6 Astra",
        contextWindow: 272000,
        maxTokens: 128000,
        input: ["text", "image"],
      },
      {
        id: "gpt-5.6-sol",
        name: "GPT-5.6 Sol",
        contextWindow: 272000,
        maxTokens: 128000,
        input: ["text"],
      },
    ]);

    const enriched = await enrichProviderModelsFromRegistry(
      oauthPayload("openai-codex"),
    );

    expect(enriched.config.defaultModel).toBe("gpt-6-astra");
    expect(enriched.config.models).toEqual([
      expect.objectContaining({
        id: "gpt-6-astra",
        label: "GPT-6 Astra",
        source: "preset",
      }),
      expect.objectContaining({
        id: "gpt-5.6-sol",
        label: "GPT-5.6 Sol",
        source: "preset",
      }),
    ]);
  });

  it("keeps a valid OAuth default and replaces a removed one", async () => {
    mocks.getModels.mockReturnValue([
      { id: "gpt-6-astra", name: "GPT-6 Astra" },
      { id: "gpt-5.6-sol", name: "GPT-5.6 Sol" },
    ]);

    await expect(
      enrichProviderModelsFromRegistry(
        oauthPayload("openai-codex", "gpt-5.6-sol"),
      ),
    ).resolves.toMatchObject({ config: { defaultModel: "gpt-5.6-sol" } });
    await expect(
      enrichProviderModelsFromRegistry(
        oauthPayload("openai-codex", "retired-model"),
      ),
    ).resolves.toMatchObject({ config: { defaultModel: "gpt-6-astra" } });
  });

  it.each([undefined, []])(
    "rejects a new OAuth save when the SDK catalog is %p",
    async (catalog) => {
      mocks.getModels.mockReturnValue(catalog);

      await expect(
        enrichProviderModelsFromRegistry(oauthPayload("openai-codex")),
      ).rejects.toThrow("openai-codex");
    },
  );

  it("keeps OpenCode fallback behavior when its SDK catalog is unavailable", async () => {
    mocks.getModels.mockReturnValue([]);
    const payload: SaveProviderPayload = {
      profileKey: "opencode",
      config: {
        provider: "opencode",
        customProtocol: "openai",
        apiKey: "sk-test",
        baseUrl: "https://opencode.ai/zen/v1",
        defaultModel: "existing-model",
        models: [],
        updatedAt: "2026-09-13T00:00:00.000Z",
      },
    };

    await expect(enrichProviderModelsFromRegistry(payload)).resolves.toEqual(
      payload,
    );
  });

  it("synchronizes existing OAuth catalogs without changing the active profile", async () => {
    mocks.seed = {
      activeProviderKey: "oauth:openai-codex",
      providers: {
        "oauth:openai-codex": {
          provider: "oauth",
          customProtocol: "anthropic",
          name: "OpenAI Codex",
          apiKey: "",
          baseUrl: "",
          defaultModel: "gpt-5.6-sol",
          models: [
            { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", source: "preset" },
            { id: "retired-model", label: "Retired", source: "preset" },
          ],
          updatedAt: "2026-09-12T00:00:00.000Z",
        },
      },
    };
    mocks.getModels.mockReturnValue([
      { id: "gpt-6-astra", name: "GPT-6 Astra" },
      { id: "gpt-5.6-sol", name: "GPT-5.6 Sol" },
    ]);
    const store = new ConfigStore();

    await store.syncOAuthProviderModelsFromRegistry();

    const config = store.getAll();
    expect(config.activeProviderKey).toBe("oauth:openai-codex");
    expect(config.providers["oauth:openai-codex"]?.defaultModel).toBe(
      "gpt-5.6-sol",
    );
    expect(
      config.providers["oauth:openai-codex"]?.models.map((model) => model.id),
    ).toEqual(["gpt-6-astra", "gpt-5.6-sol"]);
  });

  it("retains a failed catalog while synchronizing later OAuth profiles", async () => {
    const originalCopilotModels = [
      { id: "copilot-existing", label: "Copilot existing", source: "preset" },
    ];
    mocks.seed = {
      providers: {
        "oauth:github-copilot": {
          provider: "oauth",
          customProtocol: "anthropic",
          apiKey: "",
          baseUrl: "",
          defaultModel: "copilot-existing",
          models: originalCopilotModels,
          updatedAt: "2026-09-12T00:00:00.000Z",
        },
        "oauth:openai-codex": {
          provider: "oauth",
          customProtocol: "anthropic",
          apiKey: "",
          baseUrl: "",
          defaultModel: "old-codex",
          models: [{ id: "old-codex", label: "Old Codex", source: "preset" }],
          updatedAt: "2026-09-12T00:00:00.000Z",
        },
      },
    };
    mocks.getModels.mockImplementation((providerId: string) => {
      if (providerId === "github-copilot") {
        throw new Error("catalog unavailable");
      }
      return [{ id: "gpt-6-astra", name: "GPT-6 Astra" }];
    });
    const store = new ConfigStore();

    await store.syncOAuthProviderModelsFromRegistry();

    expect(mocks.logWarn).toHaveBeenCalledWith(
      "[Config] Failed to sync OAuth provider models from pi-ai:",
      expect.objectContaining({
        profileKey: "oauth:github-copilot",
        providerId: "github-copilot",
      }),
    );
    expect(store.getAll().providers["oauth:github-copilot"]?.models).toEqual(
      originalCopilotModels,
    );
    expect(store.getAll().providers["oauth:openai-codex"]?.models).toEqual([
      expect.objectContaining({ id: "gpt-6-astra" }),
    ]);
  });
});
