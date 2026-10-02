import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "../../renderer/store";
import type {
  NestedToolRuntimeUi,
  NestedToolStatus,
} from "../../shared/nested-tool-calls";
import type { Message, MountedPath, Session } from "../../renderer/types";

function runtime(
  parentToolCallId: string,
  source: "live" | "final",
  parentStatus: NestedToolStatus = "running",
): NestedToolRuntimeUi {
  return {
    snapshot: {
      parentToolCallId,
      parentStatus,
      source,
      complete: source === "final",
      calls: [],
    },
    outputs: {},
  };
}

function message(id: string, content: string): Message {
  return {
    id,
    sessionId: "s1",
    role: "assistant",
    content: [{ type: "text", text: content }],
    timestamp: 1,
  };
}

function session(id: string, status: Session["status"] = "idle"): Session {
  return {
    id,
    title: `Session ${id}`,
    status,
    createdAt: 1,
    updatedAt: 1,
    cwd: "/tmp",
    mountedPaths: [] as MountedPath[],
    allowedTools: [],
    memoryEnabled: false,
    isProjectMode: false,
  };
}

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true);
});

describe("setNestedToolCalls", () => {
  it("keeps root snapshots isolated per session", () => {
    const state = useAppStore.getState();
    state.setNestedToolCalls("s1", runtime("p1", "live"));
    state.setNestedToolCalls("s2", runtime("p2", "final", "ok"));

    const states = useAppStore.getState().sessionStates;
    expect(states.s1.nestedToolCalls?.p1.snapshot.parentToolCallId).toBe("p1");
    expect(states.s1.nestedToolCalls?.p2).toBeUndefined();
    expect(states.s2.nestedToolCalls?.p2.snapshot.parentStatus).toBe("ok");
    expect(states.s2.nestedToolCalls?.p1).toBeUndefined();
  });

  it("text cleanup cannot erase nested metadata", () => {
    const state = useAppStore.getState();
    state.setNestedToolCalls("s", runtime("p", "live"));
    state.setPartialToolResult("s", "p", { content: "text", isError: false });
    state.setPartialToolResult("s", "p", null);

    expect(useAppStore.getState().sessionStates.s.nestedToolCalls?.p).toEqual(
      runtime("p", "live"),
    );
  });

  it("does not overwrite an authoritative final snapshot with late live data", () => {
    const state = useAppStore.getState();
    state.setNestedToolCalls("s", runtime("p", "final", "ok"));
    state.setNestedToolCalls("s", runtime("p", "live", "running"));

    expect(
      useAppStore.getState().sessionStates.s.nestedToolCalls?.p.snapshot.source,
    ).toBe("final");
  });

  it("lets an authoritative final snapshot replace an earlier live snapshot", () => {
    const state = useAppStore.getState();
    state.setNestedToolCalls("s", runtime("p", "live", "running"));
    state.setNestedToolCalls("s", runtime("p", "final", "ok"));

    expect(
      useAppStore.getState().sessionStates.s.nestedToolCalls?.p.snapshot,
    ).toMatchObject({ source: "final", parentStatus: "ok" });
  });

  it("clears stale runtime on a full inactive history reload", () => {
    const store = useAppStore.getState();
    store.addSession(session("s1"));
    store.setNestedToolCalls("s1", runtime("p", "live"));
    store.setMessagesTail("s1", [message("m1", "history")], false);

    expect(useAppStore.getState().sessionStates.s1.nestedToolCalls).toEqual({});
  });

  it("keeps runtime while the session is running", () => {
    const store = useAppStore.getState();
    store.addSession(session("s1", "running"));
    store.setNestedToolCalls("s1", runtime("p", "live"));
    store.setMessagesTail("s1", [message("m1", "history")], false);

    expect(
      useAppStore.getState().sessionStates.s1.nestedToolCalls?.p.snapshot
        .parentToolCallId,
    ).toBe("p");
  });

  it("keeps runtime when older history is only prepended (paging)", () => {
    const store = useAppStore.getState();
    store.addSession(session("s1"));
    store.setMessagesTail("s1", [message("m2", "tail")], true);
    store.setNestedToolCalls("s1", runtime("p", "live"));
    store.prependOlderMessages("s1", [message("m1", "older")], false);

    expect(
      useAppStore.getState().sessionStates.s1.nestedToolCalls?.p.snapshot
        .parentToolCallId,
    ).toBe("p");
  });

  it("clears runtime on a full inactive replace via setMessages", () => {
    const store = useAppStore.getState();
    store.addSession(session("s1"));
    store.setNestedToolCalls("s1", runtime("p", "live"));
    store.setMessages("s1", [message("m1", "history")]);

    expect(useAppStore.getState().sessionStates.s1.nestedToolCalls).toEqual({});
  });
});
