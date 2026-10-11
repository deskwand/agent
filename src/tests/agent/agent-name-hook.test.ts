import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AGENT_TOOL_NAME,
  registerAgentNameHook,
} from "../../main/agent/subagent/agent-name-hook";
import { resolveModel } from "../../../node_modules/@tintinweb/pi-subagents/dist/model-resolver.js";
import {
  checkModelScope,
  setScopeModelsEnabled,
} from "../../../node_modules/@tintinweb/pi-subagents/dist/model-scope.js";

type TestModel = { provider: string; id: string; name: string };
type ToolCallHandler = (
  event: { toolName: string; input: Record<string, unknown> },
  ctx: ExtensionContext,
) => void;

function harness(getAvailable: () => TestModel[] = () => []) {
  const handlers = new Map<string, ToolCallHandler>();
  const pi = {
    on: (channel: string, handler: ToolCallHandler) => {
      handlers.set(channel, handler);
      return () => handlers.delete(channel);
    },
  } as unknown as ExtensionAPI;
  registerAgentNameHook(pi);
  const handler = handlers.get("tool_call") as ToolCallHandler;
  const ctx = {
    modelRegistry: {
      getAvailable,
      // This deliberately contains a model that is registered but unavailable.
      getAll: () => [{ provider: "deskwand:oa", id: "gpt-5", name: "GPT-5" }],
    },
  } as unknown as ExtensionContext;
  return (event: Parameters<ToolCallHandler>[0]) => handler(event, ctx);
}

describe("registerAgentNameHook", () => {
  it("模型没给名字时补一个合法兜底名", () => {
    const handler = harness();
    const input: Record<string, unknown> = { subagent_type: "Explore" };
    handler({ toolName: AGENT_TOOL_NAME, input });
    expect(String(input.name)).toMatch(/^[a-z0-9_-]+$/);
  });

  it("模型给了中文名时替换成合法名", () => {
    const handler = harness();
    const input: Record<string, unknown> = { name: "图灵" };
    handler({ toolName: AGENT_TOOL_NAME, input });
    expect(input.name).not.toBe("图灵");
    expect(String(input.name)).toMatch(/^[a-z0-9_-]+$/);
  });

  it("模型给了合法 ASCII 名时原样保留", () => {
    const handler = harness();
    const input: Record<string, unknown> = { name: "auth-audit" };
    handler({ toolName: AGENT_TOOL_NAME, input });
    expect(input.name).toBe("auth-audit");
  });

  it("非 Agent 工具不碰", () => {
    const handler = harness();
    const input: Record<string, unknown> = { command: "ls" };
    handler({ toolName: "bash", input });
    expect(input.name).toBeUndefined();
  });

  it("normalizes model even when name is already valid", () => {
    const handler = harness(() => [
      { provider: "deskwand:oa", id: "gpt-5", name: "GPT-5" },
    ]);
    const input: Record<string, unknown> = {
      name: "turing",
      model: "oa/gpt-5",
    };
    handler({ toolName: AGENT_TOOL_NAME, input });
    expect(input).toEqual({ name: "turing", model: "deskwand:oa/gpt-5" });
  });

  it("does not substitute registered-but-unavailable models", () => {
    const input: Record<string, unknown> = {
      name: "turing",
      model: "oa/gpt-5",
    };
    harness()({ toolName: AGENT_TOOL_NAME, input });
    expect(input.model).toBe("oa/gpt-5");
  });

  it("reads availability on every call", () => {
    let available: TestModel[] = [];
    const handler = harness(() => available);
    const first: Record<string, unknown> = {
      name: "turing",
      model: "oa/gpt-5",
    };
    handler({ toolName: AGENT_TOOL_NAME, input: first });
    expect(first.model).toBe("oa/gpt-5");
    available = [{ provider: "deskwand:oa", id: "gpt-5", name: "GPT-5" }];
    const second: Record<string, unknown> = {
      name: "curie",
      model: "oa/gpt-5",
    };
    handler({ toolName: AGENT_TOOL_NAME, input: second });
    expect(second.model).toBe("deskwand:oa/gpt-5");
  });

  it("defensively preserves non-string models without throwing", () => {
    const handler = harness();
    for (const value of [null, 123, { id: "gpt-5" }, undefined]) {
      const input: Record<string, unknown> = { name: "turing", model: value };
      expect(() => handler({ toolName: AGENT_TOOL_NAME, input })).not.toThrow();
      expect(input.model).toBe(value);
    }
  });

  it("does not repair an already-qualified spec, even when it is unavailable", () => {
    const input: Record<string, unknown> = {
      name: "turing",
      model: "deskwand:missing/gpt-5",
    };
    harness(() => [{ provider: "deskwand:oa", id: "gpt-5", name: "GPT-5" }])({
      toolName: AGENT_TOOL_NAME,
      input,
    });
    expect(input.model).toBe("deskwand:missing/gpt-5");
  });

  it("does not touch model on non-Agent tools", () => {
    const input: Record<string, unknown> = { model: "oa/gpt-5" };
    harness(() => [{ provider: "deskwand:oa", id: "gpt-5", name: "GPT-5" }])({
      toolName: "bash",
      input,
    });
    expect(input).toEqual({ model: "oa/gpt-5" });
  });
});

describe("caller normalization with upstream resolution and scope", () => {
  // These blocks load the real upstream `dist` modules as the oracle rather than
  // restating their algorithm. They validate the dist contract, not the published
  // types, so a `@tintinweb/pi-subagents` upgrade must re-run them (a package
  // restructure shows up as an import error, not a test failure).
  const native: TestModel = {
    provider: "anthropic",
    id: "claude-sonnet-4-5",
    name: "Sonnet",
  };
  const other: TestModel = { ...native, provider: "deskwand:other" };
  const profile: TestModel = { ...native, provider: "deskwand:anthropic" };
  const opus: TestModel = {
    provider: "deskwand:anthropic",
    id: "claude-opus-4-5",
    name: "Opus",
  };
  const raw = `${native.provider}/${native.id}`;
  const target = `${profile.provider}/${profile.id}`;

  function resolveViaHook(models: TestModel[]) {
    const input: Record<string, unknown> = { name: "turing", model: raw };
    harness(() => models)({ toolName: AGENT_TOOL_NAME, input });
    const registry = {
      getAll: () => models,
      getAvailable: () => models,
      find: (provider: string, id: string) =>
        models.find((model) => model.provider === provider && model.id === id),
    };
    const result: unknown = resolveModel(String(input.model), registry);
    return { input, registry, result };
  }

  it("keeps native exact resolution when a configured profile lacks the target", () => {
    for (const models of [
      [native, opus, other],
      [other, opus, native],
    ]) {
      const { input, result } = resolveViaHook(models);
      expect(input.model).toBe(raw);
      expect(result).toMatchObject({
        provider: native.provider,
        id: native.id,
      });
    }
  });

  it("selects the available profile under either registry order", () => {
    for (const models of [
      [native, profile, other],
      [other, profile, native],
    ]) {
      const { input, result } = resolveViaHook(models);
      expect(input.model).toBe(target);
      expect(result).toMatchObject({
        provider: profile.provider,
        id: profile.id,
      });
    }
  });

  it.each([
    { enabled: true, patterns: [raw], expected: "error" },
    { enabled: true, patterns: [target], expected: "ok" },
    { enabled: false, patterns: [raw], expected: "ok" },
  ])(
    "respects scope: $enabled / $patterns",
    ({ enabled, patterns, expected }) => {
      const cwd = mkdtempSync(join(tmpdir(), "caller-model-scope-"));
      const settingsDir = join(cwd, ".pi");
      mkdirSync(settingsDir);
      const settingsPath = join(settingsDir, "settings.json");
      const settings = JSON.stringify({ enabledModels: patterns });
      writeFileSync(settingsPath, settings, "utf-8");
      try {
        setScopeModelsEnabled(enabled);
        const { input, registry, result } = resolveViaHook([
          native,
          profile,
          other,
        ]);
        expect(result).toMatchObject({
          provider: profile.provider,
          id: profile.id,
        });
        const verdict = checkModelScope({
          model: result as TestModel,
          cwd,
          modelRegistry: registry,
          callerSupplied: true,
          agentLabel: "turing",
          modelInput: String(input.model),
        });
        expect(verdict.kind).toBe(expected);
        if (verdict.kind === "error") {
          expect(verdict.message).toContain("Model not in scope");
        }
        // No silent allowlist migration or additional account authorization.
        expect(readFileSync(settingsPath, "utf-8")).toBe(settings);
      } finally {
        setScopeModelsEnabled(false);
        rmSync(cwd, { recursive: true, force: true });
      }
    },
  );
});
