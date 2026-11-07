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
  // i18n/config 在导入期就 use(initReactI18next)：缺了它整条 import 链直接抛错
  // （这份 mock 先前只提供 useTranslation，测试文件在 HEAD 上就已经跑不起来）。
  initReactI18next: { type: "3rdParty", init: () => {} },
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
  currentPlanDone?: boolean;
  lastNonEmptyTodos?: CurrentTodos | null;
  lastPlanDone?: boolean;
  /** 需要走"流式中折叠成 partial 消息"那条分支时传入。 */
  activeTurn?: { turnId: string; userMessageId: string } | null;
  partialMessage?: string;
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
        partialMessage: opts.partialMessage ?? "",
        partialThinking: "",
        pendingTurns: [],
        activeTurn: opts.activeTurn ?? null,
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
        currentPlanDone: opts.currentPlanDone ?? false,
        lastNonEmptyTodos: opts.lastNonEmptyTodos ?? null,
        lastPlanDone: opts.lastPlanDone ?? false,
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

  it("窗口被压缩（不再含 todo_write）后，消息区底部的清单仍在", () => {
    // 走真实链路，而不是直接往 store 里塞值：
    // ① 累积（addMessage）→ ② 压缩后的窗口（setMessagesTail）→ ③ 仍然渲染。
    // 破坏①或②任何一步，这条都会红。
    // 会话必须是 running：坞只在运行中与 5s 收尾窗口内出现（与停止按钮同源）。
    act(() =>
      setState({
        sessionStatus: "running",
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
    expect(
      container.querySelector('[data-testid="chat-task-dock"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("写迁移");
  });

  it("清单被清空后，坞里仍显示收尾态", () => {
    act(() =>
      setState({
        sessionStatus: "running",
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
    expect(container.textContent).toContain("activity.statusCleared");
    expect(
      container.querySelector('[data-testid="chat-task-dock"]'),
    ).not.toBeNull();
  });

  it("上一份清单声明过 done → 收尾态显示「已完成」", () => {
    act(() =>
      setState({
        sessionStatus: "running",
        messages: [
          makeMessage("u1", "user", [{ type: "text", text: "跑完了" }]),
        ],
        currentTodos: [],
        lastNonEmptyTodos: [
          { content: "建表", status: "completed" },
          { content: "补测试", status: "completed" },
        ],
        lastPlanDone: true,
      }),
    );
    render();

    expect(container.textContent).toContain("2/2");
    expect(container.textContent).toContain("activity.statusDone");
  });

  it("运行中：过程摘要只在坞里出现一次（不和新位置重复）", () => {
    act(() =>
      setState({
        sessionStatus: "running",
        messages: [
          makeMessage("u1", "user", [{ type: "text", text: "列一下目录" }]),
          {
            ...makeMessage("a1", "assistant", [
              {
                type: "tool_use",
                id: "b1",
                name: "bash",
                input: { command: "ls" },
              },
            ]),
            turnId: "t1",
          },
        ],
        currentTodos: null,
      }),
    );
    render();

    const text = container.textContent ?? "";
    const occurrences = text.split("tool.grouped.executedCommands").length - 1;
    expect(occurrences, `摘要应只出现一次：${text}`).toBe(1);
    // 那一次在坞里
    expect(
      container.querySelector('[data-testid="chat-task-dock"]')?.textContent,
    ).toContain("tool.grouped.executedCommands");
  });

  it("回合结束后：摘要回到转录原位，坞里不再重复", () => {
    act(() =>
      setState({
        sessionStatus: "completed",
        messages: [
          makeMessage("u1", "user", [{ type: "text", text: "列一下目录" }]),
          {
            ...makeMessage("a1", "assistant", [
              {
                type: "tool_use",
                id: "b1",
                name: "bash",
                input: { command: "ls" },
              },
            ]),
            turnId: "t1",
          },
        ],
        currentTodos: null,
      }),
    );
    render();

    const occurrences =
      (container.textContent ?? "").split("tool.grouped.executedCommands")
        .length - 1;
    expect(occurrences, `摘要应只出现一次：${container.textContent}`).toBe(1);
    expect(
      container.querySelector('[data-testid="chat-task-dock"]'),
    ).toBeNull();
  });

  // 一轮里可能有好几条"带正文 + 带工具"的助手消息：坞按整轮聚合，所以转录侧
  // 必须按轮抑制，只按最后一条消息抑制会让前一条的计数重复出现。
  function twoTextTurns(): Message[] {
    return [
      makeMessage("u1", "user", [{ type: "text", text: "先看看再改" }]),
      {
        ...makeMessage("a1", "assistant", [
          { type: "text", text: "先看一眼目录。" },
          {
            type: "tool_use",
            id: "b1",
            name: "bash",
            input: { command: "ls" },
          },
          // 第一组两条命令：与尾部那组（1 条）用 pluralKey 就能区分开
          {
            type: "tool_use",
            id: "c1",
            name: "bash",
            input: { command: "pwd" },
          },
        ]),
        turnId: "t1",
      },
      {
        ...makeMessage("a2", "assistant", [
          { type: "text", text: "再跑一次测试。" },
          {
            type: "tool_use",
            id: "b2",
            name: "bash",
            input: { command: "ls" },
          },
        ]),
        turnId: "t1",
      },
    ];
  }

  /** 坞里的那份文本（从整页文本里扣除，用来断言"剩下的是转录里的"）。 */
  function outsideDockText(): string {
    const dock = container.querySelector('[data-testid="chat-task-dock"]');
    return (container.textContent ?? "").replace(dock?.textContent ?? "", "");
  }

  it("一轮两条带正文的消息：摘要也只出现一次（按轮抑制）", () => {
    act(() =>
      setState({
        sessionStatus: "running",
        messages: twoTextTurns(),
        currentTodos: null,
      }),
    );
    render();

    // 坞里只有尾部那一组（1 条 → pluralKey 走 one）；
    // 先前那组（2 条 → other）留在转录里，全页各出现一次。
    const dock = container.querySelector('[data-testid="chat-task-dock"]');
    expect(dock?.textContent).toContain("tool.grouped.executedCommands_one");
    expect(dock?.textContent).not.toContain("executedCommands_other");
    expect(outsideDockText()).toContain("tool.grouped.executedCommands_other");
    expect(outsideDockText()).not.toContain("executedCommands_one");
  });

  it("流式中（activeTurn + partial）同样只出现一次", () => {
    act(() =>
      setState({
        sessionStatus: "running",
        messages: twoTextTurns(),
        currentTodos: null,
        activeTurn: { turnId: "t1", userMessageId: "u1" },
        partialMessage: "正在收尾",
      }),
    );
    render();

    expect(
      container.querySelector('[data-testid="chat-task-dock"]')?.textContent,
    ).toContain("tool.grouped.executedCommands_one");
    expect(outsideDockText()).toContain("tool.grouped.executedCommands_other");
    expect(outsideDockText()).not.toContain("executedCommands_one");
  });

  it("上提过的摘要：运行中进坞，回合结束后回到转录原位", () => {
    // 纯工具消息会被并进前一条同轮助手消息 → 该轮走"上提"路径。
    const messages: Message[] = [
      makeMessage("u1", "user", [{ type: "text", text: "跑一下" }]),
      {
        ...makeMessage("a1", "assistant", [
          { type: "text", text: "开始。" },
          {
            type: "tool_use",
            id: "b1",
            name: "bash",
            input: { command: "ls" },
          },
        ]),
        turnId: "t1",
      },
      {
        ...makeMessage("a2", "assistant", [
          {
            type: "tool_use",
            id: "b2",
            name: "bash",
            input: { command: "pwd" },
          },
        ]),
        turnId: "t1",
      },
    ];

    act(() =>
      setState({ sessionStatus: "running", messages, currentTodos: null }),
    );
    render();
    expect(
      container.querySelector('[data-testid="chat-task-dock"]')?.textContent,
    ).toContain("tool.grouped.executedCommands");

    act(() =>
      setState({ sessionStatus: "completed", messages, currentTodos: null }),
    );
    render();
    const occurrences =
      (container.textContent ?? "").split("tool.grouped.executedCommands")
        .length - 1;
    expect(occurrences, `回合结束后摘要应回到转录且只有一份`).toBe(1);
    expect(
      container.querySelector('[data-testid="chat-task-dock"]'),
    ).toBeNull();
  });

  it("只把尾部那一组搬进坞：先前跑完的组留在转录里往上滚", () => {
    // 一轮两段工具活动（中间夹一段正文）→ 转录里两组摘要，坞只该接走最后一组。
    const blocks = (id: string, command: string) => ({
      type: "tool_use" as const,
      id,
      name: "bash",
      input: { command },
    });
    act(() =>
      setState({
        sessionStatus: "running",
        messages: [
          makeMessage("u1", "user", [{ type: "text", text: "跑一下" }]),
          {
            ...makeMessage("a1", "assistant", [
              { type: "text", text: "先看目录。" },
              blocks("b1", "ls"),
              blocks("c1", "pwd"),
              { type: "text", text: "再跑一次。" },
              blocks("b2", "whoami"),
            ]),
            turnId: "t1",
          },
        ],
        currentTodos: null,
      }),
    );
    render();

    const dock = container.querySelector('[data-testid="chat-task-dock"]');
    // 坞里只有尾部一组（1 条命令），不是整轮聚合（3 条）
    expect(dock?.textContent).toContain("tool.grouped.executedCommands_one");
    expect(dock?.textContent).not.toContain("executedCommands_other");
    // 先前那组（2 条）留在转录里
    const outsideDock = (container.textContent ?? "").replace(
      dock?.textContent ?? "",
      "",
    );
    expect(outsideDock).toContain("tool.grouped.executedCommands_other");
  });

  it("发出新一轮消息后，坞不再挂着上一轮的摘要", () => {
    // eagent pickDockTail 的口径：起点是最后一条 user 行之后 ——
    // 用户已发新消息、新轮还没产出时，坞里不能显示上一轮的活动。
    act(() =>
      setState({
        sessionStatus: "running",
        messages: [
          makeMessage("u1", "user", [{ type: "text", text: "第一轮" }]),
          {
            ...makeMessage("a1", "assistant", [
              {
                type: "tool_use",
                id: "b1",
                name: "bash",
                input: { command: "ls" },
              },
            ]),
            turnId: "t1",
          },
          makeMessage("u2", "user", [{ type: "text", text: "第二轮" }]),
        ],
        currentTodos: null,
      }),
    );
    render();

    const dock = container.querySelector('[data-testid="chat-task-dock"]');
    expect(dock?.textContent ?? "").not.toContain(
      "tool.grouped.executedCommands",
    );
    // 上一轮那行仍在转录里（没有被搬走、也没有被藏掉）
    expect(container.textContent).toContain("tool.grouped.executedCommands");
  });

  it("切到另一个会话后坞不残留（只看当前会话的清单与计时）", () => {
    act(() =>
      setState({
        sessionStatus: "running",
        messages: [
          makeMessage("u1", "user", [{ type: "text", text: "做点事" }]),
        ],
        currentTodos: [{ content: "写迁移", status: "in_progress" }],
      }),
    );
    render();
    expect(
      container.querySelector('[data-testid="chat-task-dock"]'),
    ).not.toBeNull();

    act(() => {
      const state = useAppStore.getState();
      useAppStore.setState({
        sessions: [
          ...state.sessions,
          {
            id: "s2",
            title: "另一个会话",
            status: "completed",
            createdAt: 2,
            updatedAt: 2,
            cwd: "/tmp",
            mountedPaths: [],
            allowedTools: [],
            memoryEnabled: false,
            isProjectMode: false,
          },
        ],
        activeSessionId: "s2",
      } as never);
    });

    expect(
      container.querySelector('[data-testid="chat-task-dock"]'),
    ).toBeNull();
  });
});
