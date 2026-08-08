// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatView } from "../../renderer/components/ChatView";
import { useAppStore } from "../../renderer/store";
import type { Message, MountedPath, QueuedInput, Session } from "../../renderer/types";

const { continueSessionMock } = vi.hoisted(() => ({
  // 默认返回已 resolve 的 Promise（真实 continueSession 是 async）
  continueSessionMock: vi.fn(
    (_sessionId: string, _content: unknown[], ..._rest: unknown[]) =>
      Promise.resolve(),
  ),
}));

let capturedOnStop: (() => void) | null = null;

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

vi.mock("../../renderer/hooks/useIPC", () => ({
  useIPC: () => ({
    continueSession: continueSessionMock,
    stopSession: vi.fn(),
    setSessionThinkingLevel: vi.fn(),
    setSessionProviderModel: vi.fn(),
    isElectron: false,
  }),
}));

vi.mock("../../renderer/components/ChatInput", async () => {
  const ReactModule = await import("react");
  return {
    ChatInput: ReactModule.forwardRef(function MockChatInput(
      props: { onSubmit: (d: unknown) => void; bottomSlot?: React.ReactNode },
      ref,
    ) {
      ReactModule.useImperativeHandle(ref, () => ({
        clear: () => {},
        focus: () => {},
        setPrompt: () => {},
        submit: () => {},
        isEmpty: () => true,
        selectFiles: () => {},
      }));
      // 渲染 bottomSlot 以便 ChatInputBottomBar（含 onStop）真正挂载
      return ReactModule.createElement("div", null, props.bottomSlot);
    }),
  };
});

vi.mock("../../renderer/components/ChatInputBottomBar", async () => {
  const ReactModule = await import("react");
  return {
    ChatInputBottomBar: function MockBottomBar(props: { onStop?: () => void }) {
      capturedOnStop = props.onStop ?? null;
      return ReactModule.createElement("div");
    },
  };
});

vi.mock("../../renderer/components/ChatInputStatusBar", () => ({
  ChatInputStatusBar: () => React.createElement("div"),
  resolveInputStatus: () => null,
}));

function makeSession(status: Session["status"]): Session {
  return {
    id: "s1", title: "t", status,
    createdAt: Date.now(), updatedAt: Date.now(), cwd: "/tmp",
    mountedPaths: [] as MountedPath[], allowedTools: [],
    memoryEnabled: false, isProjectMode: false,
  };
}

function makeMessage(id: string): Message {
  return { id, sessionId: "s1", role: "user", timestamp: Date.now(), content: [{ type: "text", text: id }] };
}

function setInitialState(status: Session["status"], inputQueue: QueuedInput[] = []): void {
  useAppStore.setState({
    sessions: [makeSession(status)],
    activeSessionId: "s1",
    sessionStates: {
      s1: {
        historyHydrated: true, hasMoreOlder: false, oldestMessageId: null,
        messages: [makeMessage("u1")],
        partialByTurn: {}, partialMessage: "", partialThinking: "",
        pendingTurns: [], activeTurn: null,
        executionClock: { startAt: null, endAt: null },
        traceSteps: [], contextWindow: 0,
        compaction: { status: "idle" },
        inputQueue,
        steerRecords: [],
        partialToolResults: {}, backgroundAgents: [],
      } as never,
    },
  });
}

describe("ChatView queue auto-drain", () => {
  let container: HTMLDivElement;
  let root: Root;
  let scrollToDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    useAppStore.setState(useAppStore.getInitialState());
    continueSessionMock.mockReset();
    class ResizeObserverMock {
      observe() {}
      disconnect() {}
      unobserve() {}
    }
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    scrollToDescriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollTo",
    );
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      writable: true,
      value: function scrollTo(
        this: HTMLElement,
        optionsOrX?: ScrollToOptions | number,
        y?: number,
      ) {
        const requestedTop =
          typeof optionsOrX === "number" ? (y ?? 0) : (optionsOrX?.top ?? 0);
        const maxScrollTop = Math.max(0, this.scrollHeight - this.clientHeight);
        this.scrollTop = Math.min(Math.max(0, requestedTop), maxScrollTop);
      },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    capturedOnStop = null;
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    if (scrollToDescriptor) {
      Object.defineProperty(
        HTMLElement.prototype,
        "scrollTo",
        scrollToDescriptor,
      );
    } else {
      delete (
        HTMLElement.prototype as unknown as {
          scrollTo?: HTMLElement["scrollTo"];
        }
      ).scrollTo;
    }
  });

  it("auto-sends the first queued item when the session is idle", async () => {
    setInitialState("idle", [{ id: "q1", text: "todo item", ts: 1 }]);
    await act(async () => { root.render(React.createElement(ChatView)); });
    await act(async () => { await Promise.resolve(); });
    expect(continueSessionMock).toHaveBeenCalledTimes(1);
    const args = continueSessionMock.mock.calls[0];
    expect(args[0]).toBe("s1");
    expect(args[1]).toEqual([{ type: "text", text: "todo item" }]);
    // 出队
    expect(useAppStore.getState().sessionStates.s1!.inputQueue).toHaveLength(0);
  });

  it("does not auto-drain after an explicit user stop", async () => {
    setInitialState("running", [{ id: "q1", text: "todo item", ts: 1 }]);
    await act(async () => { root.render(React.createElement(ChatView)); });
    // 用户点击停止：handleStop 置位抑制标记并将 session 置 idle
    await act(async () => { capturedOnStop!(); });
    await act(async () => { await Promise.resolve(); });
    expect(continueSessionMock).not.toHaveBeenCalled();
    // 队列保留
    expect(useAppStore.getState().sessionStates.s1!.inputQueue).toHaveLength(1);
  });

  it("auto-drains again after stop suppression is consumed", async () => {
    setInitialState("running", [{ id: "q1", text: "first", ts: 1 }]);
    await act(async () => { root.render(React.createElement(ChatView)); });
    await act(async () => { capturedOnStop!(); }); // 抑制一次
    await act(async () => { await Promise.resolve(); });
    expect(continueSessionMock).not.toHaveBeenCalled();
    // 用户手动引导（idle 普通发送）触发新回合，然后回合结束回 idle ——
    // 模拟：队列加第二条、会话回 idle 再触发
    useAppStore.getState().enqueueInput("s1", "second");
    await act(async () => { await Promise.resolve(); });
    expect(continueSessionMock).toHaveBeenCalledTimes(1);
    expect(continueSessionMock.mock.calls[0][1]).toEqual([
      { type: "text", text: "first" },
    ]);
  });
});

describe("ChatView queue auto-drain edge paths", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    useAppStore.setState(useAppStore.getInitialState());
    continueSessionMock.mockReset();
    class ResizeObserverMock {
      observe() {}
      disconnect() {}
      unobserve() {}
    }
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      writable: true,
      value: function scrollTo(
        this: HTMLElement,
        optionsOrX?: ScrollToOptions | number,
        y?: number,
      ) {
        const requestedTop =
          typeof optionsOrX === "number" ? (y ?? 0) : (optionsOrX?.top ?? 0);
        const maxScrollTop = Math.max(0, this.scrollHeight - this.clientHeight);
        this.scrollTop = Math.min(Math.max(0, requestedTop), maxScrollTop);
      },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    delete (HTMLElement.prototype as unknown as { scrollTo?: HTMLElement["scrollTo"] }).scrollTo;
  });

  it("drains multiple queued items across consecutive idle rounds (FIFO chain)", async () => {
    setInitialState("idle", [
      { id: "q1", text: "first", ts: 1 },
      { id: "q2", text: "second", ts: 2 },
    ]);
    await act(async () => { root.render(React.createElement(ChatView)); });
    // 第一轮：自动发送第一条
    await act(async () => { await Promise.resolve(); });
    expect(continueSessionMock.mock.calls[0][1]).toEqual([
      { type: "text", text: "first" },
    ]);
    expect(useAppStore.getState().sessionStates.s1!.inputQueue).toHaveLength(1);
    // 模拟回合执行：session 置 running 再回 idle → 自动发送第二条
    await act(async () => {
      useAppStore.getState().updateSession("s1", { status: "running" });
    });
    await act(async () => { await Promise.resolve(); });
    await act(async () => {
      useAppStore.getState().updateSession("s1", { status: "idle" });
    });
    await act(async () => { await Promise.resolve(); });
    expect(continueSessionMock).toHaveBeenCalledTimes(2);
    expect(continueSessionMock.mock.calls[1][1]).toEqual([
      { type: "text", text: "second" },
    ]);
    expect(useAppStore.getState().sessionStates.s1!.inputQueue).toHaveLength(0);
  });

  it("auto-sends attachments with full content blocks", async () => {
    setInitialState("idle", [
      {
        id: "q1",
        text: "with image",
        ts: 1,
        images: [
          {
            type: "image",
            source: { type: "base64", media_type: "image/png", data: "QUJD" },
          },
        ],
        files: [
          {
            type: "file_attachment",
            filename: "a.txt",
            relativePath: "/tmp/a.txt",
            size: 3,
            inlineDataBase64: "YWJj",
          },
        ],
      },
    ]);
    await act(async () => { root.render(React.createElement(ChatView)); });
    await act(async () => { await Promise.resolve(); });
    expect(continueSessionMock.mock.calls[0][1]).toEqual([
      {
        type: "image",
        source: { type: "base64", media_type: "image/png", data: "QUJD" },
      },
      {
        type: "file_attachment",
        filename: "a.txt",
        relativePath: "/tmp/a.txt",
        size: 3,
        inlineDataBase64: "YWJj",
      },
      { type: "text", text: "with image" },
    ]);
  });

  it("resets the in-flight guard when continueSession rejects", async () => {
    continueSessionMock.mockRejectedValueOnce(new Error("session gone"));
    setInitialState("idle", [{ id: "q1", text: "doomed", ts: 1 }]);
    await act(async () => { root.render(React.createElement(ChatView)); });
    await act(async () => { await Promise.resolve(); });
    // 失败后 guard 复位：队列加新条目后 idle 能再次自动发送
    useAppStore.getState().enqueueInput("s1", "next");
    await act(async () => { await Promise.resolve(); });
    expect(continueSessionMock).toHaveBeenCalledTimes(2);
    expect(continueSessionMock.mock.calls[1][1]).toEqual([
      { type: "text", text: "next" },
    ]);
  });
});
