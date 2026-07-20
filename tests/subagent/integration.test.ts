import { describe, expect, it } from "vitest";
import { resolveSubagentModel } from "../../src/main/agent/subagent/model-strategy";
import {
  buildDeskWandModelId,
  buildDeskWandProviderId,
} from "../../src/main/agent/subagent/provider-bridge";
import { bridgeSubagentLifecycleEvent } from "../../src/main/agent/subagent/event-bridge";
import {
  DEFAULT_SUBAGENT_CONFIG,
} from "../../src/shared/subagent-config";

describe("subagent integration", () => {
  it("DEFAULT_SUBAGENT_CONFIG has mode inherit for defaultModel", () => {
    expect(DEFAULT_SUBAGENT_CONFIG.defaultModel.mode).toBe("inherit");
  });

  it("buildDeskWandModelId produces correct full id", () => {
    const id = buildDeskWandModelId("openai-work", "gpt-5");
    expect(id).toBe("deskwand:openai-work/gpt-5");
  });

  it("two profiles share different provider ids", () => {
    const a = buildDeskWandProviderId("work");
    const b = buildDeskWandProviderId("personal");
    expect(a).not.toBe(b);
  });

  it("bridge lifecycle event contains all required fields", () => {
    const evt = bridgeSubagentLifecycleEvent(
      {
        agentId: "ag-1",
        agentType: "Explore",
        parentToolCallId: "tc-1",
        status: "completed",
        toolUses: 3,
        durationMs: 500,
      },
      "session-1",
    );
    expect(evt.type).toBe("subagent.lifecycle");
    const p = evt.payload as Record<string, unknown>;
    expect(p.agentId).toBe("ag-1");
    expect(p.toolUses).toBe(3);
    expect(p.sessionId).toBe("session-1");
  });

  it("model strategy uses inherit when global default is inherit", () => {
    const registry = {
      find: () => undefined,
      getAvailable: () => [],
      getAll: () => [],
    };
    const parent = {
      id: "claude-opus",
      provider: "anthropic",
    } as unknown as ReturnType<typeof resolveSubagentModel>;
    const result = resolveSubagentModel({
        agentName: "test-agent",
        markdownModel: undefined,
        runtimeModel: undefined,
        parentModel: parent,
        registry: registry as any,
        defaultModel: { mode: "inherit" },
      });
    expect(result).toBe(parent);
  });
});
