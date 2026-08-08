// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatView } from "../../renderer/components/ChatView";
import { useAppStore } from "../../renderer/store";
import type { Message, MountedPath, Session } from "../../renderer/types";

let capturedOnSubmit:
  | ((data: {
      text: string;
      images: Array<{ url: string; base64: string; mediaType: string }>;
      files: Array<{
        name: string;
        path: string;
        size: number;
        type: string;
        inlineDataBase64?: string;
      }>;
    }) => void)
  | null = null;
let capturedQueueSteer: ((id: string) => void) | null = null;

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

vi.mock("../../renderer/hooks/useIPC", () => ({
  useIPC: () => ({
    continueSession: vi.fn(),
    stopSession: vi.fn(),
    setSessionThinkingLevel: vi.fn(),
    setSessionProviderModel: vi.fn(),
    isElectron: false,
  }),
}));

vi.mock("../../renderer/components/ChatInput", async () => {
  const ReactModule = await import("react");
  return {
    ChatInput: ReactModule.forwardRef(function MockChatInput(props: { onSubmit: (d: unknown) => void }, ref) {
      ReactModule.useImperativeHandle(ref, () => ({
        clear: () => {},
        focus: () => {},
        setPrompt: () => {},
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
    id: "s1", title: "t", status,
    createdAt: Date.now(), updatedAt: Date.now(), cwd: "/tmp",
    mountedPaths: [] as MountedPath[], allowedTools: [],
    memoryEnabled: false, isProjectMode: false,
  };
}

function makeMessage(id: string): Message {
  return { id, sessionId: "s1", role: "user", timestamp: Date.now(), content: [{ type: "text", text: id }] };
}

function setInitialState(status: Session["status"]): void {
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
        inputQueue: [],
        steerRecords: [],
        partialToolResults: {}, backgroundAgents: [],
      } as never,
    },
  });
}

describe("ChatView non-idle send interception", () => {
  let container: HTMLDivElement;
  let root: Root;
  let scrollToDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
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
    await act(async () => { root.render(React.createElement(ChatView)); });
    await act(async () => {
      capturedOnSubmit!({ text: "keep going", images: [], files: [] });
    });
    const state = useAppStore.getState().sessionStates.s1!;
    expect(state.inputQueue.map((q) => q.text)).toEqual(["keep going"]);
    expect(state.messages).toHaveLength(1); // 不创建新消息
  });

  it("routes image attachment submits to inputQueue when running", async () => {
    setInitialState("running");
    await act(async () => { root.render(React.createElement(ChatView)); });
    await act(async () => {
      capturedOnSubmit!({
        text: "look at this",
        images: [
          { url: "data:image/png;base64,AAA", base64: "AAA", mediaType: "image/png" },
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
    await act(async () => { root.render(React.createElement(ChatView)); });
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
    await act(async () => { root.render(React.createElement(ChatView)); });
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
          historyHydrated: true, hasMoreOlder: false, oldestMessageId: null,
          messages: [
            makeMessage("u1"),
            { ...makeMessage("a1"), role: "assistant" },
            { ...makeMessage("g1"), role: "user", autoGenerated: true },
          ],
          partialByTurn: {}, partialMessage: "", partialThinking: "",
          pendingTurns: [], activeTurn: null,
          executionClock: { startAt: null, endAt: null },
          traceSteps: [], contextWindow: 0,
          compaction: { status: "idle" },
          inputQueue: [],
          steerRecords: [],
          partialToolResults: {}, backgroundAgents: [],
        } as never,
      },
    });
    await act(async () => { root.render(React.createElement(ChatView)); });
    await act(async () => {
      capturedOnSubmit!({ text: "深圳", images: [], files: [] });
    });
    const queuedId = useAppStore.getState().sessionStates.s1!.inputQueue[0].id;
    await act(async () => { capturedQueueSteer!(queuedId); });
    const record = useAppStore.getState().sessionStates.s1!.steerRecords[0];
    expect(record.anchorMessageId).toBe("a1"); // 最后一条可见消息，而非 autoGenerated 的 g1
  });
});
