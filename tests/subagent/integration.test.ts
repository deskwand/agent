import { describe, expect, it } from "vitest";
import {
  buildDeskWandModelId,
  buildDeskWandProviderId,
} from "../../src/main/agent/subagent/provider-bridge";
import { bridgeSubagentLifecycleEvent } from "../../src/main/agent/subagent/event-bridge";

describe("subagent integration", () => {
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
});
