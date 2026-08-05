import { describe, expect, it } from "vitest";
import type { Session } from "../../renderer/types";
import type { AgentRuntimeExtension } from "../../main/extensions/agent-runtime-extension";
import { AgentRuntimeExtensionManager } from "../../main/extensions/agent-runtime-extension-manager";

function createSession(): Session {
  return {
    id: "session-1",
    title: "Test",
    status: "idle",
    mountedPaths: [],
    allowedTools: [],
    memoryEnabled: true,
    isProjectMode: false,
    createdAt: 1,
    updatedAt: 1,
  };
}

function createExtension(
  name: string,
  promptPrefix: string,
  systemPromptSuffix: string,
): AgentRuntimeExtension {
  return {
    name,
    beforeSessionRun: async () => ({ promptPrefix, systemPromptSuffix }),
  };
}

describe("AgentRuntimeExtensionManager.beforeSessionRun", () => {
  it("aggregates user prefixes and system suffixes independently", async () => {
    const manager = new AgentRuntimeExtensionManager([
      createExtension("one", "user-one", "system-one"),
      createExtension("two", "user-two", "system-two"),
    ]);

    const result = await manager.beforeSessionRun({
      session: createSession(),
      prompt: "hello",
      existingMessages: [],
      isColdStart: true,
    });

    expect(result.promptPrefix).toBe("user-one\n\nuser-two");
    expect(result.systemPromptSuffix).toBe("system-one\n\nsystem-two");
    expect(result.customTools).toEqual([]);
  });

  it("omits empty system suffixes", async () => {
    const manager = new AgentRuntimeExtensionManager([
      createExtension("empty", "", "   "),
    ]);

    const result = await manager.beforeSessionRun({
      session: createSession(),
      prompt: "hello",
      existingMessages: [],
      isColdStart: true,
    });

    expect(result.systemPromptSuffix).toBeUndefined();
  });
});

describe("AgentRuntimeExtensionManager.onSessionRunError", () => {
  it("aggregates goalStatus from extensions that report it", async () => {
    const manager = new AgentRuntimeExtensionManager([
      {
        name: "noop",
        // no onSessionRunError — must be skipped safely
      },
      {
        name: "goal",
        onSessionRunError: async () => ({
          goalStatus: { status: "paused" as const, objective: "test goal" },
        }),
      },
    ]);

    const result = await manager.onSessionRunError({
      sessionId: "session-1",
      error: new Error("network down"),
    });

    expect(result.goalStatus?.status).toBe("paused");
    expect(result.goalStatus?.objective).toBe("test goal");
  });

  it("returns empty result when no extension reports goalStatus", async () => {
    const manager = new AgentRuntimeExtensionManager([
      {
        name: "noop",
        onSessionRunError: async () => undefined,
      },
    ]);

    const result = await manager.onSessionRunError({
      sessionId: "session-1",
      error: new Error("boom"),
    });

    expect(result.goalStatus).toBeUndefined();
  });

  it("swallows extension errors without failing others", async () => {
    const manager = new AgentRuntimeExtensionManager([
      {
        name: "throwing",
        onSessionRunError: async () => {
          throw new Error("extension bug");
        },
      },
      {
        name: "goal",
        onSessionRunError: async () => ({
          goalStatus: { status: "paused" as const },
        }),
      },
    ]);

    const result = await manager.onSessionRunError({
      sessionId: "session-1",
      error: new Error("boom"),
    });

    expect(result.goalStatus?.status).toBe("paused");
  });
});
