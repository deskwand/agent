import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  seed: {} as Record<string, unknown>,
  getModelsDevContextWindow: vi.fn(),
}));

vi.mock("../../main/config/models-dev-catalog", () => ({
  ensureModelsDevCatalog: vi.fn(async () => true),
  getModelsDevContextWindow: mocks.getModelsDevContextWindow,
}));

vi.mock("../../main/utils/logger", () => ({
  logWarn: vi.fn(),
  log: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("electron-store", () => {
  class MockStore {
    public store: Record<string, unknown>;
    public path = "/tmp/opencode-context-metadata.json";

    constructor(options: { defaults?: Record<string, unknown> }) {
      this.store = { ...options.defaults, ...mocks.seed };
    }

    set(value: Record<string, unknown>): void {
      this.store = { ...this.store, ...value };
    }
  }

  return { default: MockStore };
});

import { ConfigStore } from "../../main/config/config-store";

const GO_PROVIDER = {
  provider: "opencode-go" as const,
  customProtocol: "openai" as const,
  apiKey: "sk-test",
  baseUrl: "https://opencode.ai/inference/go/v1",
  updatedAt: "2026-10-22T00:00:00.000Z",
};

describe("opencode context metadata end to end", () => {
  beforeEach(() => {
    mocks.seed = {};
    mocks.getModelsDevContextWindow.mockReset();
    mocks.getModelsDevContextWindow.mockImplementation(
      (provider: string, id: string) =>
        provider === "opencode-go" && id === "minimax-m3.1-flash-free"
          ? 1000000
          : undefined,
    );
  });

  it("heals a stale persisted value on load, per provider", () => {
    mocks.seed = {
      activeProviderKey: "opencode-go",
      providers: {
        "opencode-go": {
          ...GO_PROVIDER,
          defaultModel: "minimax-m3.1-flash-free",
          models: [
            {
              id: "minimax-m3.1-flash-free",
              label: "minimax-m3.1-flash-free",
              source: "preset",
            },
            {
              id: "minimax-m3",
              label: "MiniMax-M3",
              source: "preset",
              contextWindow: 512000,
            },
          ],
        },
      },
    };

    const saved = new ConfigStore().getAll().providers["opencode-go"];

    // 端点独有模型：注册表没有，靠目录补
    expect(
      saved?.models.find((m) => m.id === "minimax-m3.1-flash-free")
        ?.contextWindow,
    ).toBe(1000000);
    // 历史脏值（opencode 那份 512K）：按 opencode-go 重算成 1M
    expect(
      saved?.models.find((m) => m.id === "minimax-m3")?.contextWindow,
    ).toBe(1000000);
    expect(saved?.defaultModel).toBe("minimax-m3.1-flash-free");
  });

  it("persists the derived value when the provider is saved", () => {
    const store = new ConfigStore();
    store.saveProvider({
      profileKey: "opencode-go",
      config: {
        ...GO_PROVIDER,
        defaultModel: "minimax-m3.1-flash-free",
        models: [
          {
            id: "minimax-m3.1-flash-free",
            label: "minimax-m3.1-flash-free",
            source: "preset",
          },
        ],
      },
    });

    expect(
      store
        .getAll()
        .providers[
          "opencode-go"
        ]?.models.find((m) => m.id === "minimax-m3.1-flash-free")
        ?.contextWindow,
    ).toBe(1000000);
  });
});

describe("user overrides survive the opencode registry rebuild", () => {
  it("keeps a pinned context window that the registry would otherwise overwrite", async () => {
    const { enrichProviderModelsFromRegistry } =
      await import("../../main/config/config-store");
    const enriched = await enrichProviderModelsFromRegistry({
      profileKey: "opencode-go",
      config: {
        ...GO_PROVIDER,
        defaultModel: "minimax-m3",
        models: [
          {
            id: "minimax-m3",
            label: "MiniMax-M3",
            source: "preset",
            contextWindow: 777777,
            contextWindowPinned: true,
          },
        ],
      },
    });
    const row = enriched.config.models.find((m) => m.id === "minimax-m3");
    expect(row?.contextWindow).toBe(777777);
    expect(row?.contextWindowPinned).toBe(true);
  });
});
