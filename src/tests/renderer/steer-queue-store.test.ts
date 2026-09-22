import { describe, expect, it, beforeEach } from "vitest";
import { useAppStore } from "../../renderer/store";
import { selectedButton } from "../fixtures/element-selection";

describe("inputQueue", () => {
  beforeEach(() => {
    useAppStore.setState({
      activeSessionId: "s1",
      sessions: [{ id: "s1", status: "running" } as never],
      sessionStates: {
        s1: {
          historyHydrated: true,
          hasMoreOlder: false,
          oldestMessageId: null,
          messages: [],
          partialByTurn: {},
          partialMessage: "",
          partialThinking: "",
          pendingTurns: [],
          activeTurn: null,
          traceSteps: [],
          contextWindow: 0,
          compaction: { status: "idle" },
          partialToolResults: {},
          backgroundAgents: [],
          inputQueue: [],
          steerRecords: [],
          executionClock: { startAt: null, endAt: null },
        } as never,
      },
    });
  });

  it("enqueueInput appends in FIFO order and returns id", () => {
    const id1 = useAppStore.getState().enqueueInput("s1", "first");
    const id2 = useAppStore.getState().enqueueInput("s1", "second");
    const queue = useAppStore.getState().sessionStates.s1!.inputQueue;
    expect(queue.map((q) => q.text)).toEqual(["first", "second"]);
    expect(id1).not.toEqual(id2);
    expect(queue[0].ts).toBeGreaterThan(0);
  });

  it("元素快照随队列保存，clear 输入框不会丢失", () => {
    const selections = [selectedButton];
    useAppStore.getState().enqueueInput("s1", "改圆角", [], [], selections);
    expect(
      useAppStore.getState().sessionStates.s1!.inputQueue[0].elSelections,
    ).toEqual(selections);
  });

  it("removeInput deletes by id", () => {
    const id1 = useAppStore.getState().enqueueInput("s1", "first");
    useAppStore.getState().enqueueInput("s1", "second");
    useAppStore.getState().removeInput("s1", id1);
    expect(
      useAppStore.getState().sessionStates.s1!.inputQueue.map((q) => q.text),
    ).toEqual(["second"]);
  });
});

describe("steerRecords", () => {
  beforeEach(() => {
    useAppStore.setState({
      activeSessionId: "s1",
      sessions: [{ id: "s1", status: "running" } as never],
      sessionStates: {
        s1: {
          historyHydrated: true,
          hasMoreOlder: false,
          oldestMessageId: null,
          messages: [],
          partialByTurn: {},
          partialMessage: "",
          partialThinking: "",
          pendingTurns: [],
          activeTurn: null,
          traceSteps: [],
          contextWindow: 0,
          compaction: { status: "idle" },
          partialToolResults: {},
          backgroundAgents: [],
          inputQueue: [],
          steerRecords: [],
          executionClock: { startAt: null, endAt: null },
        } as never,
      },
    });
  });

  it("addSteerRecord creates injecting record and returns its id", () => {
    const id = useAppStore.getState().addSteerRecord("s1", "fix login");
    const record = useAppStore.getState().sessionStates.s1!.steerRecords[0];
    expect(record).toMatchObject({
      id,
      text: "fix login",
      status: "injecting",
    });
  });

  it("updateSteerRecord transitions status", () => {
    const id = useAppStore.getState().addSteerRecord("s1", "fix login");
    useAppStore.getState().updateSteerRecord("s1", id, { status: "delivered" });
    expect(
      useAppStore.getState().sessionStates.s1!.steerRecords[0].status,
    ).toBe("delivered");
  });

  it("updateSteerRecord ignores unknown id", () => {
    useAppStore
      .getState()
      .updateSteerRecord("s1", "nope", { status: "delivered" });
    expect(useAppStore.getState().sessionStates.s1!.steerRecords).toEqual([]);
  });

  it("failPendingSteerRecords marks injecting records failed and returns ids", () => {
    const id1 = useAppStore.getState().addSteerRecord("s1", "a");
    const id2 = useAppStore.getState().addSteerRecord("s1", "b");
    useAppStore
      .getState()
      .updateSteerRecord("s1", id1, { status: "delivered" });
    const failed = useAppStore
      .getState()
      .failPendingSteerRecords("s1", "session-stopped");
    expect(failed).toEqual([id2]);
    const records = useAppStore.getState().sessionStates.s1!.steerRecords;
    expect(records.find((r) => r.id === id1)!.status).toBe("delivered");
    expect(records.find((r) => r.id === id2)!).toMatchObject({
      status: "failed",
      reason: "session-stopped",
    });
  });
});
