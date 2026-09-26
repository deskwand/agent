// @vitest-environment jsdom
//
// 端到端验收：这两条是本次改动要修的用户可见结果，改动前可以直接复现失败。
//  1. 模型正在回答（状态走 thinking/responding）时，后台子代理计数仍然可见；
//  2. 窗口被压缩（不再含 todo_write）之后，计划条仍在。
//
// 挂真 ChatView + 真 ChatInputStatusBar；mock 脚手架与
// chat-input-status-bar / background-panel-round-scope 同一套。
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatView } from "../../renderer/components/ChatView";
import { useAppStore } from "../../renderer/store";
import type {
  ContentBlock,
  Message,
  MountedPath,
  Session,
} from "../../renderer/types";
import type { SubagentActivity } from "../../shared/subagent-activity";
import type { CurrentTodos } from "../../renderer/utils/current-todos";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));

vi.mock("../../renderer/hooks/useIPC", () => ({
  useIPC: () => ({
    continueSession: vi.fn(),
    stopSession: vi.fn(),
    forkSession: vi.fn(),
    setSessionThinkingLevel: vi.fn(),
    setSessionProviderModel: vi.fn(),
    getSessionMessagesPage: vi.fn(),
    isElectron: false,
  }),
}));

vi.mock("../../renderer/components/ChatInput", async () => {
  const ReactModule = await import("react");
  return {
    ChatInput: ReactModule.forwardRef(function MockChatInput(_props, ref) {
      ReactModule.useImperativeHandle(ref, () => ({
        clear: () => {},
        focus: () => {},
        setPrompt: () => {},
        submit: () => {},
        isEmpty: () => true,
        selectFiles: () => {},
      }));
      return ReactModule.createElement("div");
    }),
  };
});

vi.mock("../../renderer/components/ChatInputBottomBar", () => ({
  ChatInputBottomBar: () => React.createElement("div"),
}));

const SPAWN = "call-live";

function makeMessage(
  id: string,
  role: Message["role"],
  content: ContentBlock[],
): Message {
  return { id, sessionId: "s1", role, timestamp: 1, content };
}

function runningActivity(): SubagentActivity {
  return {
    sessionId: "s1",
    agentId: "agent-live",
    parentToolCallId: SPAWN,
    name: "curie",
    type: "general-purpose",
    description: "background task",
    background: true,
    status: "running",
    steps: [],
    stats: { toolUses: 1, durationMs: 100 },
  };
}

function setState(opts: {
  sessionStatus: Session["status"];
  messages: Message[];
  currentTodos: CurrentTodos | null;
  lastNonEmptyTodos?: CurrentTodos | null;
}): void {
  const session: Session = {
    id: "s1",
    title: "activity strip",
    status: opts.sessionStatus,
    createdAt: 1,
    updatedAt: 1,
    cwd: "/tmp",
    mountedPaths: [] as MountedPath[],
    allowedTools: [],
    memoryEnabled: false,
    isProjectMode: false,
  };

  useAppStore.setState({
    sessions: [session],
    activeSessionId: "s1",
    sessionStates: {
      s1: {
        historyHydrated: true,
        hasMoreOlder: false,
        oldestMessageId: null,
        messages: opts.messages,
        partialByTurn: {},
        partialMessage: "",
        partialThinking: "",
        pendingTurns: [],
        activeTurn: null,
        executionClock: { startAt: null, endAt: null },
        traceSteps: [],
        contextWindow: 0,
        compaction: { status: "idle" },
        retry: { active: false, attempt: 0 },
        inputQueue: [],
        steerRecords: [],
        partialToolResults: {},
        backgroundAgents: [],
        subagentActivities: { [SPAWN]: runningActivity() },
        currentTodos: opts.currentTodos,
        lastNonEmptyTodos: opts.lastNonEmptyTodos ?? null,
      },
    },
  } as never);
}

describe("activity strip end to end", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    useAppStore.setState(useAppStore.getInitialState());
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
      value: () => {},
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function render(): void {
    act(() => {
      root.render(React.createElement(ChatView));
    });
  }

  it("回答进行中时，后台子代理计数仍然可见", () => {
    // 改动前的失败态：会话在跑 → 状态走 thinking，整行只显示那句过程状态，
    // 后台计数被单槽位优先级吃掉，页面上根本找不到它。
    act(() =>
      setState({
        sessionStatus: "running",
        messages: [
          makeMessage("u1", "user", [
            { type: "text", text: "起一个后台子代理" },
          ]),
          makeMessage("a1", "assistant", [
            { type: "tool_use", id: SPAWN, name: "Agent", input: {} },
          ]),
        ],
        currentTodos: null,
      }),
    );
    render();

    expect(container.textContent).toContain("activity.subagents");
  });

  it("窗口被压缩（不再含 todo_write）后，计划条仍在", () => {
    // 走真实链路，而不是直接往 store 里塞值：
    // ① 累积（addMessage）→ ② 压缩后的窗口（setMessagesTail）→ ③ 仍然渲染。
    // 破坏①或②任何一步，这条都会红。
    act(() =>
      setState({
        sessionStatus: "completed",
        messages: [],
        currentTodos: null,
      }),
    );

    act(() => {
      useAppStore.getState().addMessage(
        "s1",
        makeMessage("a1", "assistant", [
          {
            type: "tool_use",
            id: "t1",
            name: "todo_write",
            input: {
              todos: [
                { content: "建表", status: "completed" },
                { content: "写迁移", status: "in_progress" },
              ],
            },
          },
        ]),
      );
    });

    act(() => {
      useAppStore
        .getState()
        .setMessagesTail(
          "s1",
          [makeMessage("u9", "user", [{ type: "text", text: "压缩后的摘要" }])],
          false,
        );
    });

    render();

    expect(container.textContent).toContain("1/2");
    expect(container.querySelector("[role='progressbar']")).toBeTruthy();
  });

  it("清单被清空后，输入框上方仍显示收尾态", () => {
    act(() =>
      setState({
        sessionStatus: "completed",
        messages: [
          makeMessage("u1", "user", [{ type: "text", text: "跑完了" }]),
        ],
        currentTodos: [],
        lastNonEmptyTodos: [
          { content: "建表", status: "completed" },
          { content: "补测试", status: "completed" },
        ],
      }),
    );
    render();

    expect(container.textContent).toContain("2/2");
    expect(container.textContent).toContain("补测试");
  });
});
