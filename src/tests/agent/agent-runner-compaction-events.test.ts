import { describe, expect, it, vi } from "vitest";
import {
  AgentRunner,
  resolveCompactionLifecyclePayload,
} from "../../main/agent/agent-runner";
import { PathResolver } from "../../main/sandbox/path-resolver";
import type { ServerEvent } from "../../renderer/types";

describe("automatic compaction event normalization", () => {
  it("maps SDK lifecycle events to renderer state", () => {
    expect(
      resolveCompactionLifecyclePayload("s1", { type: "compaction_start" }),
    ).toEqual({ sessionId: "s1", status: "running" });
    expect(
      resolveCompactionLifecyclePayload("s1", {
        type: "compaction_end",
        aborted: false,
        result: { estimatedTokensAfter: 39400 },
      }),
    ).toEqual({
      sessionId: "s1",
      status: "success",
      estimatedTokens: 39400,
    });
    expect(
      resolveCompactionLifecyclePayload("s1", {
        type: "compaction_end",
        aborted: false,
        errorMessage: "failed",
      }),
    ).toEqual({ sessionId: "s1", status: "failed" });
    expect(
      resolveCompactionLifecyclePayload("s1", {
        type: "compaction_end",
        aborted: true,
      }),
    ).toEqual({ sessionId: "s1", status: "aborted" });
  });
});

describe("AgentRunner manual compaction events", () => {
  it("emits running and success with the post-compaction estimate", async () => {
    const events: ServerEvent[] = [];
    const runner = new AgentRunner(
      { sendToRenderer: (event) => events.push(event) },
      new PathResolver(),
    );
    const compact = vi.fn().mockResolvedValue({ estimatedTokensAfter: 39400 });
    const cache = (runner as unknown as { piSessions: Map<string, unknown> })
      .piSessions;
    cache.set("s1", {
      session: { compact },
      modelId: "model",
      thinkingLevel: "medium",
      runtimeSignature: "runtime",
      skillsSignature: "skills",
      toolsSignature: "tools",
      extensionCommands: [],
    });

    await runner.compact("s1");

    expect(
      events.filter((event) => event.type === "session.compaction"),
    ).toEqual([
      {
        type: "session.compaction",
        payload: { sessionId: "s1", status: "running" },
      },
      {
        type: "session.compaction",
        payload: {
          sessionId: "s1",
          status: "success",
          estimatedTokens: 39400,
        },
      },
    ]);
  });
});
