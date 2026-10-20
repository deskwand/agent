// @vitest-environment jsdom
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOpenSession } from "../../renderer/hooks/useOpenSession";
import { useAppStore } from "../../renderer/store";
import type { Message, Session, TraceStep } from "../../renderer/types";

const ipc = vi.hoisted(() => ({
  getSessionMessagesPage: vi.fn(),
  getSessionTraceSteps: vi.fn(),
}));

vi.mock("../../renderer/hooks/useIPC", () => ({
  useIPC: () => ({ ...ipc, isElectron: true }),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function session(id: string): Session {
  return {
    id,
    title: id,
    status: "idle",
    mountedPaths: [],
    allowedTools: [],
    memoryEnabled: false,
    isProjectMode: false,
    createdAt: 1,
    updatedAt: 1,
  };
}

function message(id: string): Message {
  return {
    id,
    sessionId: "a",
    role: "assistant",
    content: [],
    timestamp: 1,
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("useOpenSession", () => {
  let container: HTMLDivElement;
  let root: Root;
  let openSession: (sessionId: string) => Promise<boolean>;

  function Harness(): null {
    openSession = useOpenSession();
    return null;
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    useAppStore.setState(useAppStore.getInitialState(), true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(React.createElement(Harness));
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = "";
  });

  it("loads history before switching, so the chat never lands on an empty hydrating view", async () => {
    const pending = deferred<{ messages: Message[]; hasMore: boolean }>();
    ipc.getSessionMessagesPage.mockReturnValue(pending.promise);
    ipc.getSessionTraceSteps.mockResolvedValue([]);
    useAppStore.setState({ sessions: [session("a")] });

    let switching: Promise<boolean> | undefined;
    await act(async () => {
      switching = openSession("a");
    });
    // 历史还没回来：此时切过去只会看到「正在加载历史」。
    expect(useAppStore.getState().activeSessionId).toBeNull();

    pending.resolve({ messages: [message("m1")], hasMore: false });
    await act(async () => {
      await switching;
    });

    expect(useAppStore.getState().activeSessionId).toBe("a");
    expect(useAppStore.getState().sessionStates.a?.historyHydrated).toBe(true);
    expect(useAppStore.getState().sessionStates.a?.messages).toHaveLength(1);
  });

  it("keeps the later switch when an earlier slow response lands afterwards", async () => {
    const slow = deferred<{ messages: Message[]; hasMore: boolean }>();
    const fast = deferred<{ messages: Message[]; hasMore: boolean }>();
    ipc.getSessionMessagesPage.mockImplementation((sessionId: string) =>
      sessionId === "a" ? slow.promise : fast.promise,
    );
    ipc.getSessionTraceSteps.mockResolvedValue([]);
    useAppStore.setState({ sessions: [session("a"), session("b")] });

    let firstSwitch: Promise<boolean> | undefined;
    let secondSwitch: Promise<boolean> | undefined;
    await act(async () => {
      firstSwitch = openSession("a");
      secondSwitch = openSession("b");
    });

    fast.resolve({ messages: [], hasMore: false });
    await act(async () => {
      await secondSwitch;
    });
    expect(useAppStore.getState().activeSessionId).toBe("b");

    slow.resolve({ messages: [], hasMore: false });
    await act(async () => {
      await firstSwitch;
    });
    expect(useAppStore.getState().activeSessionId).toBe("b");
  });

  it("reports a failed preload instead of switching to an empty chat", async () => {
    ipc.getSessionMessagesPage.mockRejectedValue(new Error("ipc down"));
    useAppStore.setState({ sessions: [session("a")] });

    let opened: boolean | undefined;
    await act(async () => {
      opened = await openSession("a");
    });

    expect(opened).toBe(false);
    expect(useAppStore.getState().activeSessionId).toBeNull();
  });

  it("switches straight away when history and trace are already in the store", async () => {
    const step: TraceStep = {
      id: "step-1",
      type: "text",
      status: "completed",
      title: "done",
      timestamp: 1,
    };
    useAppStore.getState().setMessagesTail("c", [], false);
    useAppStore.getState().setTraceSteps("c", [step]);
    useAppStore.setState({ sessions: [session("c")] });

    await act(async () => {
      await openSession("c");
    });

    expect(useAppStore.getState().activeSessionId).toBe("c");
    expect(ipc.getSessionMessagesPage).not.toHaveBeenCalled();
    expect(ipc.getSessionTraceSteps).not.toHaveBeenCalled();
  });
});
