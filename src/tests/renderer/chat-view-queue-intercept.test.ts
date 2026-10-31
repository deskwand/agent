// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatView } from "../../renderer/components/ChatView";
import type { ChatInputSubmitData } from "../../renderer/components/ChatInput";
import { useAppStore } from "../../renderer/store";
import type { Message, MountedPath, Session } from "../../renderer/types";
import { selectedButton } from "../fixtures/element-selection";

let capturedOnSubmit: ((data: ChatInputSubmitData) => void) | null = null;
let capturedQueueSteer: ((id: string) => void) | null = null;
const capturedSetPrompt: string[] = [];

const ipcMocks = vi.hoisted(() => ({ submitAskUser: vi.fn() }));

// 真 i18n 配置会在模块加载时 i18n.use(initReactI18next)，缺这个导出会让整份
// 测试文件在收集阶段就挂掉（本文件在 main 上已因此红了，这里顺手补齐）。
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
  initReactI18next: { type: "3rdParty", init: () => undefined },
}));

vi.mock("../../renderer/hooks/useIPC", () => ({
  useIPC: () => ({
    continueSession: vi.fn(),
    stopSession: vi.fn(),
    setSessionThinkingLevel: vi.fn(),
    setSessionProviderModel: vi.fn(),
    isElectron: false,
    submitAskUser: ipcMocks.submitAskUser,
  }),
}));

vi.mock("../../renderer/components/ChatInput", async () => {
  const ReactModule = await import("react");
  return {
    ChatInput: ReactModule.forwardRef(function MockChatInput(
      props: { onSubmit: (d: unknown) => void },
      ref,
    ) {
      ReactModule.useImperativeHandle(ref, () => ({
        clear: () => {},
        focus: () => {},
        setPrompt: (text: string) => {
          capturedSetPrompt.push(text);
        },
        submit: () => {},
        isEmpty: () => true,
        selectFiles: () => {},
      }));
      capturedOnSubmit = props.onSubmit as never;
      return ReactModule.createElement("div");
    }),
  };
});

vi.mock("../../renderer/components/ChatInputBottomBar", () => ({
  ChatInputBottomBar: () => React.createElement("div"),
}));

vi.mock("../../renderer/components/ChatInputStatusBar", () => ({
  ChatInputStatusBar: () => React.createElement("div"),
  resolveInputStatus: () => null,
}));

vi.mock("../../renderer/components/ChatInputQueueBar", async () => {
  const ReactModule = await import("react");
  return {
    ChatInputQueueBar: function MockQueueBar(props: {
      items: unknown[];
      onSteer: (id: string) => void;
    }) {
      capturedQueueSteer = props.onSteer;
      return ReactModule.createElement("div");
    },
  };
});

function makeSession(status: Session["status"]): Session {
  return {
    id: "s1",
    title: "t",
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

function makeMessage(id: string): Message {
  return {
    id,
    sessionId: "s1",
    role: "user",
    timestamp: Date.now(),
    content: [{ type: "text", text: id }],
  };
}

function setInitialState(status: Session["status"]): void {
  useAppStore.setState({
    sessions: [makeSession(status)],
    activeSessionId: "s1",
    sessionStates: {
      s1: {
        historyHydrated: true,
        hasMoreOlder: false,
        oldestMessageId: null,
        messages: [makeMessage("u1")],
        partialByTurn: {},
        partialMessage: "",
        partialThinking: "",
        pendingTurns: [],
        activeTurn: null,
        executionClock: { startAt: null, endAt: null },
        traceSteps: [],
        contextWindow: 0,
        compaction: { status: "idle" },
        inputQueue: [],
        steerRecords: [],
        partialToolResults: {},
        backgroundAgents: [],
      } as never,
    },
  });
}

describe("ChatView non-idle send interception", () => {
  let container: HTMLDivElement;
  let root: Root;
  let scrollToDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
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
    capturedOnSubmit = null;
    capturedSetPrompt.length = 0;
    ipcMocks.submitAskUser.mockClear();
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

  it("routes plain-text submit to inputQueue when running", async () => {
    setInitialState("running");
    await act(async () => {
      root.render(React.createElement(ChatView));
    });
    await act(async () => {
      capturedOnSubmit!({ text: "keep going", images: [], files: [] });
    });
    const state = useAppStore.getState().sessionStates.s1!;
    expect(state.inputQueue.map((q) => q.text)).toEqual(["keep going"]);
    expect(state.messages).toHaveLength(1); // 不创建新消息
  });

  it("routes image attachment submits to inputQueue when running", async () => {
    setInitialState("running");
    await act(async () => {
      root.render(React.createElement(ChatView));
    });
    await act(async () => {
      capturedOnSubmit!({
        text: "look at this",
        images: [
          {
            url: "data:image/png;base64,AAA",
            base64: "AAA",
            mediaType: "image/png",
          },
        ],
        files: [],
      });
    });
    const state = useAppStore.getState().sessionStates.s1!;
    expect(state.inputQueue).toHaveLength(1);
    expect(state.inputQueue[0].text).toBe("look at this");
    expect(state.inputQueue[0].images).toHaveLength(1);
    expect(state.inputQueue[0].images![0].source.data).toBe("AAA");
    expect(state.messages).toHaveLength(1); // 不创建新消息
  });

  it("routes file attachment submits to inputQueue when running", async () => {
    setInitialState("running");
    await act(async () => {
      root.render(React.createElement(ChatView));
    });
    await act(async () => {
      capturedOnSubmit!({
        text: "check this file",
        images: [],
        files: [
          {
            name: "report.pdf",
            path: "/tmp/report.pdf",
            size: 1024,
            type: "application/pdf",
            inlineDataBase64: "QUJD",
          },
        ],
      });
    });
    const state = useAppStore.getState().sessionStates.s1!;
    expect(state.inputQueue).toHaveLength(1);
    expect(state.inputQueue[0].files).toHaveLength(1);
    expect(state.inputQueue[0].files![0].filename).toBe("report.pdf");
    expect(state.messages).toHaveLength(1); // 不创建新消息
  });

  it("does not intercept when idle", async () => {
    setInitialState("idle");
    await act(async () => {
      root.render(React.createElement(ChatView));
    });
    await act(async () => {
      capturedOnSubmit!({ text: "normal send", images: [], files: [] });
    });
    const state = useAppStore.getState().sessionStates.s1!;
    expect(state.inputQueue).toEqual([]);
  });

  it("anchors the steer record to the last visible message, skipping auto-generated ones", async () => {
    // 消息流末尾存在 autoGenerated 消息（goal 自动 prompt，UI 不可见）
    useAppStore.setState({
      sessions: [makeSession("running")],
      activeSessionId: "s1",
      sessionStates: {
        s1: {
          historyHydrated: true,
          hasMoreOlder: false,
          oldestMessageId: null,
          messages: [
            makeMessage("u1"),
            { ...makeMessage("a1"), role: "assistant" },
            { ...makeMessage("g1"), role: "user", autoGenerated: true },
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
          inputQueue: [],
          steerRecords: [],
          partialToolResults: {},
          backgroundAgents: [],
        } as never,
      },
    });
    await act(async () => {
      root.render(React.createElement(ChatView));
    });
    await act(async () => {
      capturedOnSubmit!({ text: "深圳", images: [], files: [] });
    });
    const queuedId = useAppStore.getState().sessionStates.s1!.inputQueue[0].id;
    await act(async () => {
      capturedQueueSteer!(queuedId);
    });
    const record = useAppStore.getState().sessionStates.s1!.steerRecords[0];
    expect(record.anchorMessageId).toBe("a1"); // 最后一条可见消息，而非 autoGenerated 的 g1
  });

  it("运行中携元素入队，不能通过 steer 丢掉附件", async () => {
    setInitialState("running");
    await act(async () => {
      root.render(React.createElement(ChatView));
    });
    await act(async () => {
      capturedOnSubmit!({
        text: "",
        images: [],
        files: [],
        elSelections: [selectedButton],
      });
    });
    const queued = useAppStore.getState().sessionStates.s1!.inputQueue[0];
    expect(queued.elSelections).toEqual([selectedButton]);
    await act(async () => {
      capturedQueueSteer!(queued.id);
    });
    // 引导会把条目从队列移走；带元素的条目必须原样留在队列里等下一次正常出队
    expect(useAppStore.getState().sessionStates.s1!.inputQueue[0].id).toBe(
      queued.id,
    );
  });

  function seedPendingAskUser(): void {
    useAppStore.setState({
      pendingAskUsers: {
        "t-1": {
          sessionId: "s1",
          toolCallId: "t-1",
          questions: [
            {
              question: "数据库用哪个？",
              header: "技术栈",
              type: "choice",
              options: [{ label: "PostgreSQL" }, { label: "SQLite" }],
            },
          ],
        },
      },
    });
  }

  it("卡片挂起时提交：走 steer 而不是排队区", async () => {
    setInitialState("running");
    seedPendingAskUser();
    await act(async () => {
      root.render(React.createElement(ChatView));
    });
    await act(async () => {
      capturedOnSubmit!({ text: "直接用 SQLite", images: [], files: [] });
    });
    const state = useAppStore.getState().sessionStates.s1!;
    expect(state.inputQueue).toEqual([]);
    expect(state.steerRecords).toHaveLength(1);
    expect(state.steerRecords[0]!.text).toBe("直接用 SQLite");
    expect(ipcMocks.submitAskUser).not.toHaveBeenCalled();
  });

  it("卡片挂起 + 元素附件：程序化跳过卡片，仍走排队区", async () => {
    setInitialState("running");
    seedPendingAskUser();
    await act(async () => {
      root.render(React.createElement(ChatView));
    });
    await act(async () => {
      capturedOnSubmit!({
        text: "",
        images: [],
        files: [],
        elSelections: [selectedButton],
      });
    });
    const state = useAppStore.getState().sessionStates.s1!;
    expect(state.inputQueue).toHaveLength(1);
    expect(state.inputQueue[0]!.elSelections).toEqual([selectedButton]);
    expect(state.steerRecords).toEqual([]);
    expect(ipcMocks.submitAskUser).toHaveBeenCalledWith("s1", "t-1", {
      "0": "__SKIPPED__",
    });
  });

  it("卡片挂起时 steer 失败：把文本回填输入框（会话等不到 idle）", async () => {
    setInitialState("running");
    seedPendingAskUser();
    await act(async () => {
      root.render(React.createElement(ChatView));
    });
    await act(async () => {
      capturedOnSubmit!({ text: "直接用 SQLite", images: [], files: [] });
    });
    const record = useAppStore.getState().sessionStates.s1!.steerRecords[0]!;
    // 主进程回报 steer 失败（no-active-session / sdk-error）
    await act(async () => {
      useAppStore.getState().updateSteerRecord("s1", record.id, {
        status: "failed",
        reason: "sdk-error",
      });
    });
    // 卡片还挂着 → 等不到 idle，必须就地回填，否则用户打的字凭空消失
    expect(capturedSetPrompt).toContain("直接用 SQLite");
  });
});
