import { describe, it, expect, beforeEach } from "vitest";
import { useAppStore } from "../../renderer/store";
import type { Message, MountedPath } from "../../renderer/types";

// Reset store before each test
beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState());
});

describe("SessionState unified store", () => {
  const makeSession = (id: string) => ({
    id,
    title: `Session ${id}`,
    status: "idle" as const,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    cwd: "/tmp",
    mountedPaths: [] as MountedPath[],
    allowedTools: [] as string[],
    memoryEnabled: false,
    isProjectMode: false,
  });

  describe("addSession", () => {
    it("should initialize sessionStates entry with defaults", () => {
      const session = makeSession("s1");
      useAppStore.getState().addSession(session);

      const state = useAppStore.getState();
      expect(state.sessions).toHaveLength(1);
      expect(state.sessionStates["s1"]).toBeDefined();
      expect(state.sessionStates["s1"].historyHydrated).toBe(true);
      expect(state.sessionStates["s1"].messages).toEqual([]);
      expect(state.sessionStates["s1"].partialMessage).toBe("");
      expect(state.sessionStates["s1"].partialThinking).toBe("");
      expect(state.sessionStates["s1"].pendingTurns).toEqual([]);
      expect(state.sessionStates["s1"].activeTurn).toBeNull();
      expect(state.sessionStates["s1"].executionClock).toEqual({
        startAt: null,
        endAt: null,
      });
      expect(state.sessionStates["s1"].traceSteps).toEqual([]);
      expect(state.sessionStates["s1"].contextWindow).toBe(0);
    });
  });

  describe("removeSession", () => {
    it("should remove sessionStates entry", () => {
      const session = makeSession("s1");
      useAppStore.getState().addSession(session);
      expect(useAppStore.getState().sessionStates["s1"]).toBeDefined();

      useAppStore.getState().removeSession("s1");
      expect(useAppStore.getState().sessionStates["s1"]).toBeUndefined();
      expect(useAppStore.getState().sessions).toHaveLength(0);
    });

    it("should clear activeSessionId when removing active session", () => {
      const session = makeSession("s1");
      useAppStore.getState().addSession(session);
      useAppStore.getState().setActiveSession("s1");
      useAppStore.getState().removeSession("s1");
      expect(useAppStore.getState().activeSessionId).toBeNull();
    });
  });

  describe("removeSessions (batch)", () => {
    it("should remove multiple sessions at once", () => {
      useAppStore.getState().addSession(makeSession("s1"));
      useAppStore.getState().addSession(makeSession("s2"));
      useAppStore.getState().addSession(makeSession("s3"));
      expect(Object.keys(useAppStore.getState().sessionStates)).toHaveLength(3);

      useAppStore.getState().removeSessions(["s1", "s3"]);
      const state = useAppStore.getState();
      expect(state.sessions).toHaveLength(1);
      expect(state.sessions[0].id).toBe("s2");
      expect(state.sessionStates["s1"]).toBeUndefined();
      expect(state.sessionStates["s2"]).toBeDefined();
      expect(state.sessionStates["s3"]).toBeUndefined();
    });
  });

  describe("messages", () => {
    it("should add user messages and track pending turns", () => {
      useAppStore.getState().addSession(makeSession("s1"));
      const msg = {
        id: "msg1",
        sessionId: "s1",
        role: "user" as const,
        content: [{ type: "text" as const, text: "hello" }],
        timestamp: Date.now(),
      };
      useAppStore.getState().addMessage("s1", msg);

      const ss = useAppStore.getState().sessionStates["s1"];
      expect(ss.messages).toHaveLength(1);
      expect(ss.pendingTurns).toHaveLength(1);
      expect(ss.pendingTurns[0]).toMatchObject({
        turnId: "msg1",
        userMessageId: "msg1",
      });
    });

    it("should clear partials when adding assistant message", () => {
      useAppStore.getState().addSession(makeSession("s1"));
      useAppStore.getState().setPartialMessage("s1", "chunk1");
      useAppStore.getState().setPartialThinking("s1", "think1");

      const assistantMsg = {
        id: "msg2",
        sessionId: "s1",
        role: "assistant" as const,
        content: [{ type: "text" as const, text: "response" }],
        timestamp: Date.now(),
      };
      useAppStore.getState().addMessage("s1", assistantMsg);

      const ss = useAppStore.getState().sessionStates["s1"];
      expect(ss.messages).toHaveLength(1);
      expect(ss.partialMessage).toBe("");
      expect(ss.partialThinking).toBe("");
    });

    it("should set messages (bulk replace)", () => {
      useAppStore.getState().addSession(makeSession("s1"));
      const msgs = [
        {
          id: "a",
          sessionId: "s1",
          role: "user" as const,
          content: [{ type: "text" as const, text: "hi" }],
          timestamp: 1,
        },
        {
          id: "b",
          sessionId: "s1",
          role: "assistant" as const,
          content: [{ type: "text" as const, text: "hello" }],
          timestamp: 2,
        },
      ];
      useAppStore.getState().setMessages("s1", msgs);
      expect(useAppStore.getState().sessionStates["s1"].messages).toHaveLength(
        2,
      );
      expect(useAppStore.getState().sessionStates["s1"].historyHydrated).toBe(
        true,
      );
    });

    it("should not mark a session hydrated when only context metadata arrives", () => {
      useAppStore.getState().setSessionContextWindow("s-meta", 32000);
      expect(
        useAppStore.getState().sessionStates["s-meta"].historyHydrated,
      ).toBe(false);
    });
  });

  describe("partials", () => {
    it("should accumulate partial message deltas", () => {
      useAppStore.getState().addSession(makeSession("s1"));
      useAppStore.getState().setPartialMessage("s1", "Hello");
      useAppStore.getState().setPartialMessage("s1", " world");
      expect(useAppStore.getState().sessionStates["s1"].partialMessage).toBe(
        "Hello world",
      );
    });

    it("should clear partial message", () => {
      useAppStore.getState().addSession(makeSession("s1"));
      useAppStore.getState().setPartialMessage("s1", "data");
      useAppStore.getState().clearPartialMessage("s1");
      expect(useAppStore.getState().sessionStates["s1"].partialMessage).toBe(
        "",
      );
    });

    it("should accumulate partial thinking deltas", () => {
      useAppStore.getState().addSession(makeSession("s1"));
      useAppStore.getState().setPartialThinking("s1", "think");
      useAppStore.getState().setPartialThinking("s1", "ing");
      expect(useAppStore.getState().sessionStates["s1"].partialThinking).toBe(
        "thinking",
      );
    });

    it("should clear partial thinking", () => {
      useAppStore.getState().addSession(makeSession("s1"));
      useAppStore.getState().setPartialThinking("s1", "data");
      useAppStore.getState().clearPartialThinking("s1");
      expect(useAppStore.getState().sessionStates["s1"].partialThinking).toBe(
        "",
      );
    });
  });

  describe("execution clock", () => {
    it("should start and finish execution clock", () => {
      useAppStore.getState().addSession(makeSession("s1"));
      useAppStore.getState().startExecutionClock("s1", 1000);
      expect(useAppStore.getState().sessionStates["s1"].executionClock).toEqual(
        {
          startAt: 1000,
          endAt: null,
        },
      );

      useAppStore.getState().finishExecutionClock("s1", 2000);
      expect(useAppStore.getState().sessionStates["s1"].executionClock).toEqual(
        {
          startAt: 1000,
          endAt: 2000,
        },
      );
    });

    it("should not finish clock if never started", () => {
      useAppStore.getState().addSession(makeSession("s1"));
      useAppStore.getState().finishExecutionClock("s1", 2000);
      expect(useAppStore.getState().sessionStates["s1"].executionClock).toEqual(
        {
          startAt: null,
          endAt: null,
        },
      );
    });

    it("should clear execution clock", () => {
      useAppStore.getState().addSession(makeSession("s1"));
      useAppStore.getState().startExecutionClock("s1", 1000);
      useAppStore.getState().clearExecutionClock("s1");
      expect(useAppStore.getState().sessionStates["s1"].executionClock).toEqual(
        {
          startAt: null,
          endAt: null,
        },
      );
    });
  });

  describe("turns", () => {
    it("should activate next turn from pending queue", () => {
      useAppStore.getState().addSession(makeSession("s1"));
      // Add a user message to create pending turn
      useAppStore.getState().addMessage("s1", {
        id: "msg1",
        sessionId: "s1",
        role: "user",
        content: [{ type: "text", text: "test" }],
        timestamp: Date.now(),
      });
      expect(
        useAppStore.getState().sessionStates["s1"].pendingTurns,
      ).toHaveLength(1);
      expect(
        useAppStore.getState().sessionStates["s1"].pendingTurns[0],
      ).toMatchObject({ turnId: "msg1", userMessageId: "msg1" });

      useAppStore.getState().activateNextTurn("s1", "step1");
      const ss = useAppStore.getState().sessionStates["s1"];
      expect(ss.pendingTurns).toEqual([]);
      expect(ss.activeTurn).toMatchObject({
        stepId: "step1",
        turnId: "msg1",
        userMessageId: "msg1",
      });
    });

    it("should set activeTurn to null when no pending turns", () => {
      useAppStore.getState().addSession(makeSession("s1"));
      useAppStore.getState().activateNextTurn("s1", "step1");
      expect(useAppStore.getState().sessionStates["s1"].activeTurn).toBeNull();
    });

    it("should update active turn step", () => {
      useAppStore.getState().addSession(makeSession("s1"));
      // Setup an active turn first
      useAppStore.getState().addMessage("s1", {
        id: "msg1",
        sessionId: "s1",
        role: "user",
        content: [{ type: "text", text: "test" }],
        timestamp: Date.now(),
      });
      useAppStore.getState().activateNextTurn("s1", "step1");
      useAppStore.getState().updateActiveTurnStep("s1", "step2");
      expect(
        useAppStore.getState().sessionStates["s1"].activeTurn,
      ).toMatchObject({
        stepId: "step2",
        turnId: "msg1",
        userMessageId: "msg1",
      });
    });

    it("should clear active turn", () => {
      useAppStore.getState().addSession(makeSession("s1"));
      useAppStore.getState().addMessage("s1", {
        id: "msg1",
        sessionId: "s1",
        role: "user",
        content: [{ type: "text", text: "test" }],
        timestamp: Date.now(),
      });
      useAppStore.getState().activateNextTurn("s1", "step1");
      useAppStore.getState().clearActiveTurn("s1");
      expect(useAppStore.getState().sessionStates["s1"].activeTurn).toBeNull();
    });

    it("should only clear active turn when stepId matches", () => {
      useAppStore.getState().addSession(makeSession("s1"));
      useAppStore.getState().addMessage("s1", {
        id: "msg1",
        sessionId: "s1",
        role: "user",
        content: [{ type: "text", text: "test" }],
        timestamp: Date.now(),
      });
      useAppStore.getState().activateNextTurn("s1", "step1");
      // Try clearing with wrong stepId - should not clear
      useAppStore.getState().clearActiveTurn("s1", "wrong-step");
      expect(
        useAppStore.getState().sessionStates["s1"].activeTurn,
      ).not.toBeNull();
      // Clear with correct stepId
      useAppStore.getState().clearActiveTurn("s1", "step1");
      expect(useAppStore.getState().sessionStates["s1"].activeTurn).toBeNull();
    });

    it("should clear pending turns", () => {
      useAppStore.getState().addSession(makeSession("s1"));
      useAppStore.getState().addMessage("s1", {
        id: "msg1",
        sessionId: "s1",
        role: "user",
        content: [{ type: "text", text: "test" }],
        timestamp: Date.now(),
      });
      expect(
        useAppStore.getState().sessionStates["s1"].pendingTurns,
      ).toHaveLength(1);
      useAppStore.getState().clearPendingTurns("s1");
      expect(useAppStore.getState().sessionStates["s1"].pendingTurns).toEqual(
        [],
      );
    });
  });

  describe("queued messages", () => {
    it("should clear queued message status", () => {
      useAppStore.getState().addSession(makeSession("s1"));
      // Manually set messages with queued status
      useAppStore.getState().setMessages("s1", [
        {
          id: "msg1",
          sessionId: "s1",
          role: "user",
          content: [{ type: "text", text: "a" }],
          timestamp: 1,
          localStatus: "queued",
        },
        {
          id: "msg2",
          sessionId: "s1",
          role: "user",
          content: [{ type: "text", text: "b" }],
          timestamp: 2,
        },
      ]);
      useAppStore.getState().clearQueuedMessages("s1");
      const msgs = useAppStore.getState().sessionStates["s1"].messages;
      expect(msgs[0].localStatus).toBeUndefined();
      expect(msgs[1].localStatus).toBeUndefined();
    });

    it("should cancel queued messages", () => {
      useAppStore.getState().addSession(makeSession("s1"));
      useAppStore.getState().setMessages("s1", [
        {
          id: "msg1",
          sessionId: "s1",
          role: "user",
          content: [{ type: "text", text: "a" }],
          timestamp: 1,
          localStatus: "queued",
        },
      ]);
      useAppStore.getState().addMessage("s1", {
        id: "msg1",
        sessionId: "s1",
        role: "user",
        content: [{ type: "text", text: "a" }],
        timestamp: 1,
      });
      useAppStore.getState().cancelQueuedMessages("s1");
      expect(
        useAppStore.getState().sessionStates["s1"].messages[0].localStatus,
      ).toBe("cancelled");
    });
  });

  describe("trace steps", () => {
    it("should add and update trace steps", () => {
      useAppStore.getState().addSession(makeSession("s1"));
      const step = {
        id: "ts1",
        type: "tool_call" as const,
        status: "running" as const,
        title: "read",
        toolName: "read",
        timestamp: Date.now(),
      };
      useAppStore.getState().addTraceStep("s1", step);
      expect(
        useAppStore.getState().sessionStates["s1"].traceSteps,
      ).toHaveLength(1);

      useAppStore
        .getState()
        .updateTraceStep("s1", "ts1", { status: "completed" as const });
      expect(
        useAppStore.getState().sessionStates["s1"].traceSteps[0].status,
      ).toBe("completed");
    });

    it("should set trace steps (bulk replace)", () => {
      useAppStore.getState().addSession(makeSession("s1"));
      const steps = [
        {
          id: "ts1",
          type: "tool_call" as const,
          status: "completed" as const,
          title: "read",
          toolName: "read",
          timestamp: 1,
        },
        {
          id: "ts2",
          type: "thinking" as const,
          status: "completed" as const,
          title: "thinking",
          timestamp: 2,
        },
      ];
      useAppStore.getState().setTraceSteps("s1", steps);
      expect(
        useAppStore.getState().sessionStates["s1"].traceSteps,
      ).toHaveLength(2);
    });
  });

  describe("context window", () => {
    it("should set session context window", () => {
      useAppStore.getState().addSession(makeSession("s1"));
      useAppStore.getState().setSessionContextWindow("s1", 200000);
      expect(useAppStore.getState().sessionStates["s1"].contextWindow).toBe(
        200000,
      );
    });
  });

  describe("compaction state", () => {
    it("keeps compaction state isolated by session", () => {
      useAppStore.getState().addSession(makeSession("s1"));
      useAppStore.getState().addSession(makeSession("s2"));

      useAppStore.getState().setSessionCompaction("s1", "running");

      expect(useAppStore.getState().sessionStates.s1.compaction.status).toBe(
        "running",
      );
      expect(useAppStore.getState().sessionStates.s2.compaction.status).toBe(
        "idle",
      );
    });

    it("preserves a successful estimate when status is dismissed", () => {
      useAppStore.getState().addSession(makeSession("s1"));
      useAppStore.getState().setSessionCompaction("s1", "success", 39400);
      useAppStore.getState().dismissSessionCompaction("s1");

      expect(useAppStore.getState().sessionStates.s1.compaction).toEqual({
        status: "idle",
        estimatedTokens: 39400,
      });
    });

    it("marks successful compaction without an estimate as unknown", () => {
      useAppStore.getState().addSession(makeSession("s1"));
      useAppStore.getState().setSessionCompaction("s1", "success");

      expect(
        useAppStore.getState().sessionStates.s1.compaction.estimatedTokens,
      ).toBeNull();
    });

    it("clears the estimate when exact assistant usage arrives", () => {
      useAppStore.getState().addSession(makeSession("s1"));
      useAppStore.getState().setSessionCompaction("s1", "success", 39400);
      useAppStore.getState().addMessage("s1", {
        id: "a1",
        sessionId: "s1",
        role: "assistant",
        content: [{ type: "text", text: "done" }],
        timestamp: 1,
        tokenUsage: {
          input: 100,
          output: 10,
          totalPromptInput: 40100,
        },
      });

      expect(useAppStore.getState().sessionStates.s1.compaction).toEqual({
        status: "idle",
      });
    });
  });

  describe("backgroundAgents", () => {
    const agent = {
      id: "agent-1",
      type: "Explore",
      description: "find bug",
    };

    it("should add a background agent", () => {
      useAppStore.getState().addSession(makeSession("s1"));
      useAppStore.getState().addBackgroundAgent("s1", agent);

      const bg = useAppStore.getState().sessionStates["s1"].backgroundAgents;
      expect(bg).toHaveLength(1);
      expect(bg[0]).toMatchObject({
        id: "agent-1",
        type: "Explore",
        status: "running",
      });
    });

    it("should be idempotent — adding same agent ID twice only adds once", () => {
      useAppStore.getState().addSession(makeSession("s1"));
      useAppStore.getState().addBackgroundAgent("s1", agent);
      useAppStore.getState().addBackgroundAgent("s1", agent);

      expect(
        useAppStore.getState().sessionStates["s1"].backgroundAgents,
      ).toHaveLength(1);
    });

    it("should update agent status", () => {
      useAppStore.getState().addSession(makeSession("s1"));
      useAppStore.getState().addBackgroundAgent("s1", agent);
      useAppStore
        .getState()
        .updateBackgroundAgentStatus("s1", "agent-1", "done");

      expect(
        useAppStore.getState().sessionStates["s1"].backgroundAgents[0].status,
      ).toBe("done");
    });

    it("should remove agent by ID", () => {
      useAppStore.getState().addSession(makeSession("s1"));
      useAppStore.getState().addBackgroundAgent("s1", agent);
      useAppStore.getState().addBackgroundAgent("s1", {
        id: "agent-2",
        type: "Review",
        description: "check",
      });

      useAppStore.getState().removeBackgroundAgent("s1", "agent-1");

      const bg = useAppStore.getState().sessionStates["s1"].backgroundAgents;
      expect(bg).toHaveLength(1);
      expect(bg[0].id).toBe("agent-2");
    });

    it("should isolate background agents per session", () => {
      useAppStore.getState().addSession(makeSession("s1"));
      useAppStore.getState().addSession(makeSession("s2"));
      useAppStore.getState().addBackgroundAgent("s1", agent);

      expect(
        useAppStore.getState().sessionStates["s1"].backgroundAgents,
      ).toHaveLength(1);
      expect(
        useAppStore.getState().sessionStates["s2"].backgroundAgents,
      ).toHaveLength(0);
    });
  });

  describe("cross-session isolation", () => {
    it("should not affect other sessions when updating one", () => {
      useAppStore.getState().addSession(makeSession("s1"));
      useAppStore.getState().addSession(makeSession("s2"));

      useAppStore.getState().setPartialMessage("s1", "hello");
      useAppStore.getState().setSessionContextWindow("s2", 100000);

      expect(useAppStore.getState().sessionStates["s1"].partialMessage).toBe(
        "hello",
      );
      expect(useAppStore.getState().sessionStates["s1"].contextWindow).toBe(0);
      expect(useAppStore.getState().sessionStates["s2"].partialMessage).toBe(
        "",
      );
      expect(useAppStore.getState().sessionStates["s2"].contextWindow).toBe(
        100000,
      );
    });
  });
});

describe("message windowing (paged history)", () => {
  function msg(id: string, ts: number): Message {
    return {
      id,
      sessionId: "s1",
      role: "user",
      content: [],
      timestamp: ts,
    } as Message;
  }

  it("setMessagesTail stores tail page and paging flags", () => {
    const store = useAppStore.getState();
    store.setMessagesTail("s1", [msg("m1", 1), msg("m2", 2)], true);
    const ss = useAppStore.getState().sessionStates["s1"];
    expect(ss.messages.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(ss.historyHydrated).toBe(true);
    expect(ss.hasMoreOlder).toBe(true);
    expect(ss.oldestMessageId).toBe("m1");
  });

  it("prependOlderMessages inserts at the front and moves the cursor", () => {
    const store = useAppStore.getState();
    store.setMessagesTail("s2", [msg("m3", 3), msg("m4", 4)], true);
    store.prependOlderMessages("s2", [msg("m1", 1), msg("m2", 2)], false);
    const ss = useAppStore.getState().sessionStates["s2"];
    expect(ss.messages.map((m) => m.id)).toEqual(["m1", "m2", "m3", "m4"]);
    expect(ss.oldestMessageId).toBe("m1");
    expect(ss.hasMoreOlder).toBe(false);
    expect(ss.historyHydrated).toBe(true);
  });

  it("trimMessagesToWindow keeps only the newest messages and resets cursor", () => {
    const store = useAppStore.getState();
    const all = Array.from({ length: 5 }, (_, i) => msg(`m${i + 1}`, i + 1));
    store.setMessagesTail("s3", all, true);
    store.trimMessagesToWindow("s3", 2);
    const ss = useAppStore.getState().sessionStates["s3"];
    expect(ss.messages.map((m) => m.id)).toEqual(["m4", "m5"]);
    expect(ss.oldestMessageId).toBe("m4");
  });

  it("prependOlderMessages does not trim the just-loaded page", () => {
    const store = useAppStore.getState();
    store.setMessagesTail("s4", [msg("m3", 3), msg("m4", 4)], true);
    store.prependOlderMessages("s4", [msg("m1", 1), msg("m2", 2)], true);
    const ss = useAppStore.getState().sessionStates["s4"];
    expect(ss.messages).toHaveLength(4);
  });

  it("prependOlderMessages trims the oldest messages past the cap and reports the count", () => {
    const store = useAppStore.getState();
    // 内存窗口上限 2000 + 页 1000 = 3000；构造 3000 条再 prepend 1000 → 4000 → trim 到 2000
    const tail = Array.from({ length: 3000 }, (_, i) =>
      msg(`m${i + 1}`, i + 1),
    );
    store.setMessagesTail("s6", tail, true);
    const older = Array.from({ length: 1000 }, (_, i) =>
      msg(`old${i + 1}`, i + 1),
    );
    const trimmed = store.prependOlderMessages("s6", older, true);
    const ss = useAppStore.getState().sessionStates["s6"];
    expect(trimmed).toBe(2000);
    expect(ss.messages).toHaveLength(2000);
    // 保留的是最新的 2000 条：old 1000 条全部被 trim，尾部 2000 条保留
    expect(ss.messages[0].id).toBe("m1001");
    expect(ss.oldestMessageId).toBe("m1001");
  });

  it("prependOlderMessages does not trim below the cap threshold", () => {
    const store = useAppStore.getState();
    const tail = Array.from({ length: 2500 }, (_, i) =>
      msg(`m${i + 1}`, i + 1),
    );
    store.setMessagesTail("s7", tail, true);
    const older = Array.from({ length: 400 }, (_, i) =>
      msg(`old${i + 1}`, i + 1),
    );
    const trimmed = store.prependOlderMessages("s7", older, true);
    expect(trimmed).toBe(0);
    const ss = useAppStore.getState().sessionStates["s7"];
    expect(ss.messages).toHaveLength(2900); // 2500 + 400 < 3000，不 trim
  });

  it("addMessage still works after paging (tail append, no trim)", () => {
    const store = useAppStore.getState();
    store.setMessagesTail("s5", [msg("m1", 1)], false);
    store.addMessage("s5", msg("m2", 2));
    const ss = useAppStore.getState().sessionStates["s5"];
    expect(ss.messages.map((m) => m.id)).toEqual(["m1", "m2"]);
  });
});
