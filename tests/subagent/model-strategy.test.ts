import { describe, expect, it } from "vitest";
import { resolveSubagentModel } from "../../src/main/agent/subagent/model-strategy";
import type { SubagentDefaultModel } from "../../src/shared/subagent-config";

function mockRegistry(
  ...entries: Array<{ provider: string; id: string }>
) {
  const models = entries.map((e) => ({
    id: e.id,
    name: e.id,
    provider: e.provider,
    api: "anthropic-messages" as const,
    baseUrl: "",
    reasoning: false,
    input: ["text", "image"] as ("text" | "image")[],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 8192,
  }));
  return {
    find: (p: string, id: string) =>
      models.find((m) => m.provider === p && m.id === id),
    getAvailable: () => models,
    getAll: () => models,
  };
}

const registry = mockRegistry(
  { provider: "deskwand:main-openai", id: "gpt-5" },
  { provider: "anthropic", id: "claude-haiku-4-5" },
  { provider: "deskwand:cheap-deepseek", id: "deepseek-v3" },
);

const parentModel = {
  id: "claude-opus-4-5",
  provider: "anthropic",
} as unknown as ReturnType<typeof resolveSubagentModel>;

describe("resolveSubagentModel (simplified: no agentOverrides)", () => {
  describe("priority 1: Markdown model", () => {
    it("uses markdown model when specified", () => {
      const result = resolveSubagentModel({
        agentName: "Explore",
        markdownModel: "anthropic/claude-haiku-4-5",
        runtimeModel: undefined,
        parentModel,
        registry: registry as any,
        defaultModel: { mode: "inherit" },
      });
      expect(result?.id).toBe("claude-haiku-4-5");
    });

    it("uses parent model when markdown says inherit", () => {
      const result = resolveSubagentModel({
        agentName: "Explore",
        markdownModel: "inherit",
        runtimeModel: undefined,
        parentModel,
        registry: registry as any,
        defaultModel: { mode: "inherit" },
      });
      expect(result).toBe(parentModel);
    });
  });

  describe("priority 2: Runtime model", () => {
    it("uses runtime model when no markdown model", () => {
      const result = resolveSubagentModel({
        agentName: "general-purpose",
        markdownModel: undefined,
        runtimeModel: "anthropic/claude-haiku-4-5",
        parentModel,
        registry: registry as any,
        defaultModel: { mode: "inherit" },
      });
      expect(result?.id).toBe("claude-haiku-4-5");
    });

    it("uses parent model when runtime model says inherit", () => {
      const result = resolveSubagentModel({
        agentName: "general-purpose",
        markdownModel: undefined,
        runtimeModel: "inherit",
        parentModel,
        registry: registry as any,
        defaultModel: { mode: "inherit" },
      });
      expect(result).toBe(parentModel);
    });
  });

  describe("priority 3: Global default", () => {
    it("uses global model when specified", () => {
      const defaultModel: SubagentDefaultModel = {
        mode: "model",
        providerProfileKey: "cheap-deepseek",
        modelId: "deepseek-v3",
      };
      const result = resolveSubagentModel({
        agentName: "general-purpose",
        markdownModel: undefined,
        runtimeModel: undefined,
        parentModel,
        registry: registry as any,
        defaultModel,
      });
      expect(result?.id).toBe("deepseek-v3");
    });

    it("uses parent model when global default is inherit", () => {
      const result = resolveSubagentModel({
        agentName: "general-purpose",
        markdownModel: undefined,
        runtimeModel: undefined,
        parentModel,
        registry: registry as any,
        defaultModel: { mode: "inherit" },
      });
      expect(result).toBe(parentModel);
    });

    it("throws when global model not found", () => {
      expect(() =>
        resolveSubagentModel({
          agentName: "general-purpose",
          markdownModel: undefined,
          runtimeModel: undefined,
          parentModel,
          registry: registry as any,
          defaultModel: {
            mode: "model",
            providerProfileKey: "nonexistent",
            modelId: "nonexistent",
          },
        }),
      ).toThrow(/not found/);
    });
  });
});
