import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockConfigState = vi.hoisted(() => ({
  config: {
    provider: "openrouter",
    apiKey: "",
    baseUrl: "https://openrouter.ai/api/v1",
    customProtocol: "anthropic",
    model: "anthropic/claude-sonnet-4-6",
    activeProfileKey: "openrouter",
    activeProviderKey: "openrouter",
    profiles: {},
    providers: {},
    deskWandCodePath: "",
    defaultWorkdir: "",
    enableDevLogs: false,
    theme: "light",
    sandboxEnabled: false,
    memoryEnabled: true,
    memoryRuntime: {
      maxNavSteps: 2,
      ingestionConcurrency: 2,
      storageRoot: "",
    },
    enableThinking: false,
    isConfigured: true,
  } as Record<string, unknown>,
}));

vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    getPath: () => "/tmp",
    getVersion: () => "0.0.0-test",
    getAppPath: () => "/tmp/deskwand-test-app",
  },
}));

vi.mock("../../main/config/config-store", () => {
  const configStore = {
    getAll: () => ({ ...mockConfigState.config }),
    get: (key: string) => mockConfigState.config[key],
    update: (updates: Record<string, unknown>) => {
      mockConfigState.config = { ...mockConfigState.config, ...updates };
    },
    set: (key: string, value: unknown) => {
      mockConfigState.config = { ...mockConfigState.config, [key]: value };
    },
  };
  return {
    configStore,
    PROVIDER_PRESETS: {},
  };
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseInstance } from "../../main/db/database";
import { getTeammateMemoryRoot } from "../../main/agents/teammate-paths";
import type { MemoryLLMClientLike } from "../../main/memory/memory-llm-client";
import { MemoryService } from "../../main/memory/memory-service";
import { TeammateMemoryRegistry } from "../../main/memory/teammate-memory-registry";
import { configStore } from "../../main/config/config-store";

const stubLlm: MemoryLLMClientLike = {
  complete: async () => ({ text: JSON.stringify({ actions: [] }) }),
};

describe("TeammateMemoryRegistry", () => {
  let tmp: string;
  let userData: string;
  let registry: TeammateMemoryRegistry;
  let globalService: MemoryService;
  const db = {} as DatabaseInstance;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "deskwand-tm-registry-"));
    userData = path.join(tmp, "userData");
    configStore.update({
      memoryEnabled: true,
      memoryRuntime: {
        maxNavSteps: 2,
        ingestionConcurrency: 2,
        storageRoot: path.join(tmp, "global-memory"),
      },
    });
    globalService = new MemoryService(db, { llmClient: stubLlm });
    registry = new TeammateMemoryRegistry(db, userData, { llmClient: stubLlm });
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("caches one service per agent with separate roots", () => {
    expect(registry.getForAgent("a")).toBe(registry.getForAgent("a"));
    expect(registry.getForAgent("a")).not.toBe(registry.getForAgent("b"));
  });

  it("isolates core memory between teammates and global", async () => {
    await registry.getForAgent("a").upsertCoreMemory("identity", "name", "A");
    expect(registry.getForAgent("b").getCoreMemoryRaw()).toEqual({});
    expect(globalService.getCoreMemoryRaw()).toEqual({});
    expect(
      fs.existsSync(
        path.join(getTeammateMemoryRoot(userData, "a"), "core_memory.json"),
      ),
    ).toBe(true);
  });

  it("dispose waits for pending writes and drops the cache", async () => {
    const svc = registry.getForAgent("a");
    const write = svc.upsertCoreMemory("identity", "name", "A");
    await registry.dispose("a");
    await expect(write).resolves.toBeDefined();
    expect(registry.getForAgent("a")).not.toBe(svc);
  });
});
