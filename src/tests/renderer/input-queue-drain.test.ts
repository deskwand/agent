// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatView } from "../../renderer/components/ChatView";
import { InputQueueDrainer } from "../../renderer/components/InputQueueDrainer";
import { useAppStore } from "../../renderer/store";
import {
  drainIdleInputQueues,
  resetInputQueueDrainState,
  sendQueuedInput,
} from "../../renderer/utils/input-queue-drain";
import type {
  Message,
  MountedPath,
  QueuedInput,
  Session,
} from "../../renderer/types";

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
  initReactI18next: { type: "3rdParty", init: () => {} },
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

function makeSession(id: string, status: Session["status"]): Session {
  return {
    id,
    title: id,
    status,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    cwd: "/tmp",
    mountedPaths: [] as MountedPath[],
    allowedTools: [],
    memoryEnabled: false,
    isProjectMode: false,
  };
}

function makeMessage(id: string, sessionId: string): Message {
  return {
    id,
    sessionId,
    role: "user",
    timestamp: Date.now(),
    content: [{ type: "text", text: id }],
  };
}

interface SessionSeed {
  id: string;
  status: Session["status"];
  queue?: QueuedInput[];
  compactionRunning?: boolean;
}

function setInitialState(
  seeds: SessionSeed[],
  activeSessionId: string | null = seeds[0]?.id ?? null,
): void {
  const sessionStates: Record<string, unknown> = {};
  for (const seed of seeds) {
    sessionStates[seed.id] = {
      historyHydrated: true,
      hasMoreOlder: false,
      oldestMessageId: null,
      messages: [makeMessage(`u-${seed.id}`, seed.id)],
      partialByTurn: {},
      partialMessage: "",
      partialThinking: "",
      pendingTurns: [],
      activeTurn: null,
      executionClock: { startAt: null, endAt: null },
      traceSteps: [],
      contextWindow: 0,
      compaction: { status: seed.compactionRunning ? "running" : "idle" },
      inputQueue: seed.queue ?? [],
      steerRecords: [],
      partialToolResults: {},
      backgroundAgents: [],
    };
  }
  useAppStore.setState({
    sessions: seeds.map((seed) => makeSession(seed.id, seed.status)),
    activeSessionId,
    sessionStates: sessionStates as never,
  });
}

describe("input queue auto-drain", () => {
  let container: HTMLDivElement;
  let root: Root;
  let scrollToDescriptor: PropertyDescriptor | undefined;

  const flush = async () => {
    await act(async () => {
      await Promise.resolve();
    });
  };

  const render = async (node: React.ReactNode) => {
    await act(async () => {
      root.render(node);
    });
    await flush();
  };

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    useAppStore.setState(useAppStore.getInitialState());
    // 出队簿记（in-flight / stop 抑制）在模块级，跨用例必须清空
    resetInputQueueDrainState();
    continueSessionMock.mockReset();
    continueSessionMock.mockImplementation(() => Promise.resolve());
    capturedOnStop = null;
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
      value: function scrollTo(this: HTMLElement) {
        this.scrollTop = 0;
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
    setInitialState([
      {
        id: "s1",
        status: "idle",
        queue: [{ id: "q1", text: "todo item", ts: 1 }],
      },
    ]);
    await render(React.createElement(InputQueueDrainer));
    expect(continueSessionMock).toHaveBeenCalledTimes(1);
    const args = continueSessionMock.mock.calls[0];
    expect(args[0]).toBe("s1");
    expect(args[1]).toEqual([{ type: "text", text: "todo item" }]);
    // 出队
    expect(useAppStore.getState().sessionStates.s1!.inputQueue).toHaveLength(0);
  });

  it("keeps draining a session the user has navigated away from", async () => {
    // 回归：用户排队后切到别的会话。出队器不在 ChatView 里，不依赖当前视图。
    setInitialState(
      [
        {
          id: "s1",
          status: "running",
          queue: [{ id: "q1", text: "queued while running", ts: 1 }],
        },
        { id: "s2", status: "idle" },
      ],
      "s2",
    );
    // 只挂出队器：正是「看不到 s1」的场景
    await render(React.createElement(InputQueueDrainer));
    expect(continueSessionMock).not.toHaveBeenCalled();

    // s1 的回合结束
    await act(async () => {
      useAppStore.getState().updateSession("s1", { status: "idle" });
    });
    await flush();
    expect(continueSessionMock).toHaveBeenCalledTimes(1);
    expect(continueSessionMock.mock.calls[0][0]).toBe("s1");
    expect(useAppStore.getState().sessionStates.s1!.inputQueue).toHaveLength(0);
  });

  it("does not auto-drain after an explicit user stop", async () => {
    setInitialState([
      {
        id: "s1",
        status: "running",
        queue: [{ id: "q1", text: "todo item", ts: 1 }],
      },
    ]);
    await render(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(InputQueueDrainer),
        React.createElement(ChatView),
      ),
    );
    // 用户点击停止：handleStop 置位抑制标记并将 session 置 idle
    await act(async () => {
      capturedOnStop!();
    });
    await flush();
    expect(continueSessionMock).not.toHaveBeenCalled();
    // 队列保留
    expect(useAppStore.getState().sessionStates.s1!.inputQueue).toHaveLength(1);
  });

  it("keeps the queue parked after a stop until the session runs again", async () => {
    setInitialState([
      {
        id: "s1",
        status: "running",
        queue: [{ id: "q1", text: "first", ts: 1 }],
      },
    ]);
    await render(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(InputQueueDrainer),
        React.createElement(ChatView),
      ),
    );
    await act(async () => {
      capturedOnStop!();
    });
    await flush();
    expect(continueSessionMock).not.toHaveBeenCalled();
    // 停止后的空闲期里，其它 store 变更（含新入队）都不许把队列踢起来
    useAppStore.getState().enqueueInput("s1", "second");
    await flush();
    expect(continueSessionMock).not.toHaveBeenCalled();
    expect(useAppStore.getState().sessionStates.s1!.inputQueue).toHaveLength(2);
    // 用户手动开新回合（running）→ 抑制解除；回合结束回 idle → 队列继续跑
    await act(async () => {
      useAppStore.getState().updateSession("s1", { status: "running" });
    });
    await flush();
    expect(continueSessionMock).not.toHaveBeenCalled();
    await act(async () => {
      useAppStore.getState().updateSession("s1", { status: "idle" });
    });
    await flush();
    expect(continueSessionMock).toHaveBeenCalledTimes(1);
    expect(continueSessionMock.mock.calls[0][1]).toEqual([
      { type: "text", text: "first" },
    ]);
  });

  it("drains multiple queued items across consecutive idle rounds (FIFO chain)", async () => {
    setInitialState([
      {
        id: "s1",
        status: "idle",
        queue: [
          { id: "q1", text: "first", ts: 1 },
          { id: "q2", text: "second", ts: 2 },
        ],
      },
    ]);
    await render(React.createElement(InputQueueDrainer));
    expect(continueSessionMock.mock.calls[0][1]).toEqual([
      { type: "text", text: "first" },
    ]);
    expect(useAppStore.getState().sessionStates.s1!.inputQueue).toHaveLength(1);
    // 模拟回合执行：session 置 running 再回 idle → 自动发送第二条
    await act(async () => {
      useAppStore.getState().updateSession("s1", { status: "running" });
    });
    await flush();
    await act(async () => {
      useAppStore.getState().updateSession("s1", { status: "idle" });
    });
    await flush();
    expect(continueSessionMock).toHaveBeenCalledTimes(2);
    expect(continueSessionMock.mock.calls[1][1]).toEqual([
      { type: "text", text: "second" },
    ]);
    expect(useAppStore.getState().sessionStates.s1!.inputQueue).toHaveLength(0);
  });

  it("auto-sends attachments with full content blocks", async () => {
    setInitialState([
      {
        id: "s1",
        status: "idle",
        queue: [
          {
            id: "q1",
            text: "with image",
            ts: 1,
            images: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/png",
                  data: "QUJD",
                },
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
        ],
      },
    ]);
    await render(React.createElement(InputQueueDrainer));
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

  it("holds the queue while the session is compacting", async () => {
    setInitialState([
      {
        id: "s1",
        status: "idle",
        compactionRunning: true,
        queue: [{ id: "q1", text: "wait for compaction", ts: 1 }],
      },
    ]);
    await render(React.createElement(InputQueueDrainer));
    expect(continueSessionMock).not.toHaveBeenCalled();
    await act(async () => {
      useAppStore
        .getState()
        .setSessionCompaction("s1", { status: "idle" } as never);
    });
    await flush();
    expect(continueSessionMock).toHaveBeenCalledTimes(1);
  });

  it("does not auto-drain an archived session's queue", async () => {
    setInitialState([
      {
        id: "s1",
        status: "idle",
        queue: [{ id: "q1", text: "after archive", ts: 1 }],
      },
    ]);
    useAppStore
      .getState()
      .updateSession("s1", { archived: true, archivedAt: Date.now() });
    await render(React.createElement(InputQueueDrainer));
    expect(continueSessionMock).not.toHaveBeenCalled();
  });

  it("a manual send blocks the drainer from sending the next item", async () => {
    // 手动引导（idle 点「引导」）与出队器共用 in-flight 标记：
    // 否则它发完第一条后，出队器会立刻把第二条也发出去（双回合）
    setInitialState([
      {
        id: "s1",
        status: "idle",
        queue: [
          { id: "q1", text: "first", ts: 1 },
          { id: "q2", text: "second", ts: 2 },
        ],
      },
    ]);
    const session = useAppStore.getState().sessions[0];
    const item = useAppStore.getState().sessionStates.s1!.inputQueue[1];
    sendQueuedInput("s1", item, continueSessionMock, session);
    // 手动发送之后立刻扫一遍（等价于 store 变更触发的扫描）
    drainIdleInputQueues(continueSessionMock);
    expect(continueSessionMock).toHaveBeenCalledTimes(1);
    expect(continueSessionMock.mock.calls[0][1]).toEqual([
      { type: "text", text: "second" },
    ]);
  });

  it("resets the in-flight guard when continueSession rejects", async () => {
    continueSessionMock.mockRejectedValueOnce(new Error("session gone"));
    setInitialState([
      {
        id: "s1",
        status: "idle",
        queue: [{ id: "q1", text: "doomed", ts: 1 }],
      },
    ]);
    await render(React.createElement(InputQueueDrainer));
    expect(continueSessionMock).toHaveBeenCalledTimes(1);
    // 失败后 guard 复位：队列加新条目后 idle 能再次自动发送
    useAppStore.getState().enqueueInput("s1", "next");
    await flush();
    expect(continueSessionMock).toHaveBeenCalledTimes(2);
    expect(continueSessionMock.mock.calls[1][1]).toEqual([
      { type: "text", text: "next" },
    ]);
  });
});
