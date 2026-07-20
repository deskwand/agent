import { describe, expect, it } from "vitest";
import {
  buildExecutionContext,
  bridgeSubagentLifecycleEvent,
} from "../../src/main/agent/subagent/event-bridge";

describe("event-bridge", () => {
  describe("buildExecutionContext", () => {
    it("returns main scope for empty agentId", () => {
      const ctx = buildExecutionContext({
        agentId: undefined,
        parentToolCallId: "tool-1",
      });
      expect(ctx.scope).toBe("main");
      expect(ctx.parentToolCallId).toBe("tool-1");
      expect(ctx.agentId).toBeUndefined();
    });

    it("returns subagent scope with full context", () => {
      const ctx = buildExecutionContext({
        agentId: "agent-123",
        agentType: "Explore",
        parentToolCallId: "tool-1",
        executionId: "exec-1",
      });
      expect(ctx.scope).toBe("subagent");
      expect(ctx.agentId).toBe("agent-123");
      expect(ctx.agentType).toBe("Explore");
      expect(ctx.parentToolCallId).toBe("tool-1");
      expect(ctx.executionId).toBe("exec-1");
    });

    it("defaults executionId to agentId when missing", () => {
      const ctx = buildExecutionContext({
        agentId: "agent-456",
        agentType: "general-purpose",
        parentToolCallId: "tool-2",
      });
      expect(ctx.scope).toBe("subagent");
      expect(ctx.executionId).toBe("agent-456");
    });
  });

  describe("bridgeSubagentLifecycleEvent", () => {
    it("produces subagent.lifecycle event for completed status", () => {
      const evt = bridgeSubagentLifecycleEvent(
        {
          agentId: "agent-456",
          agentType: "general-purpose",
          parentToolCallId: "tool-2",
          status: "completed",
          toolUses: 5,
          durationMs: 1234,
        },
        "session-1",
      );
      expect(evt.type).toBe("subagent.lifecycle");
      const p = evt.payload as Record<string, unknown>;
      expect(p.status).toBe("completed");
      expect(p.toolUses).toBe(5);
      expect(p.agentId).toBe("agent-456");
      expect(p.sessionId).toBe("session-1");
    });

    it("includes token info when provided", () => {
      const evt = bridgeSubagentLifecycleEvent(
        {
          agentId: "agent-789",
          agentType: "Explore",
          parentToolCallId: "tool-3",
          status: "completed",
          tokens: { input: 1000, output: 500, total: 1500 },
        },
        "session-2",
      );
      const p = evt.payload as Record<string, unknown>;
      const t = p.tokens as Record<string, number>;
      expect(t.input).toBe(1000);
      expect(t.output).toBe(500);
      expect(t.total).toBe(1500);
    });
  });
});
