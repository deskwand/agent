// @vitest-environment jsdom
//
// 接线回归：面板必须真的只收到「本轮」的行。
//
// 纯函数（collectCurrentRoundToolCallIds / buildBackgroundAgentRows）各自有单测，
// 但把第 4 个参数写掉、或传成 null，所有单测仍然全绿、功能却整体失效。
// 这条测试挂真 ChatView + 真 ChatInputStatusBar，断言面板里出现的是哪些行。
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

const OLD_SPAWN = "call-old-done";
const OLD_LIVE = "call-old-running";
const NEW_SPAWN = "call-new-done";

function makeMessage(
  id: string,
  role: Message["role"],
  content: ContentBlock[],
): Message {
  return { id, sessionId: "s1", role, timestamp: 1, content };
}

function makeActivity(
  parentToolCallId: string,
  name: string,
  description: string,
  status: SubagentActivity["status"],
): SubagentActivity {
  return {
    sessionId: "s1",
    agentId: `agent-${parentToolCallId}`,
    parentToolCallId,
    name,
    type: "general-purpose",
    description,
    background: true,
    status,
    steps: [],
    stats: { toolUses: 1, durationMs: 100 },
  };
}

function setState(): void {
  const session: Session = {
    id: "s1",
    title: "round scope",
    // 必须不是 running：run 中状态栏会先显示「thinking」，面板压根不渲染
    status: "completed",
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
        messages: [
          makeMessage("u1", "user", [{ type: "text", text: "第一轮" }]),
          makeMessage("a1", "assistant", [
            { type: "tool_use", id: OLD_SPAWN, name: "Agent", input: {} },
            { type: "tool_use", id: OLD_LIVE, name: "Agent", input: {} },
          ]),
          // 这一条把回合边界推到这里：它之前的两个 agent 都属于上一轮
          makeMessage("u2", "user", [{ type: "text", text: "第二轮" }]),
          makeMessage("a2", "assistant", [
            { type: "tool_use", id: NEW_SPAWN, name: "Agent", input: {} },
          ]),
        ],
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
        subagentActivities: {
          [OLD_SPAWN]: makeActivity(
            OLD_SPAWN,
            "euler",
            "old task",
            "completed",
          ),
          [OLD_LIVE]: makeActivity(
            OLD_LIVE,
            "turing",
            "old live task",
            "running",
          ),
          [NEW_SPAWN]: makeActivity(
            NEW_SPAWN,
            "darwin",
            "new task",
            "completed",
          ),
        },
      },
    },
  } as never);
}

describe("background panel round scope wiring", () => {
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

  it("上一轮已完成的被收窄掉，上一轮还在跑的和本轮的都保留", () => {
    act(() => setState());
    act(() => {
      root.render(React.createElement(ChatView));
    });

    // 本轮还有一行在跑 → 文案走 statusRunning；两套文案都带这个前缀。
    const chip = Array.from(container.querySelectorAll("button")).find((el) =>
      el.textContent?.includes("subagent.status"),
    );
    expect(chip).toBeTruthy();
    act(() => chip?.click());

    const panel = container.querySelector("[role='dialog']");
    expect(panel).toBeTruthy();
    // 本轮完成 + 跨回合仍在跑 → 在
    expect(panel?.textContent).toContain("darwin");
    expect(panel?.textContent).toContain("turing");
    // 上一轮已完成的 → 被收窄掉
    expect(panel?.textContent).not.toContain("euler");
    expect(panel?.textContent).not.toContain("old task");
  });
});
