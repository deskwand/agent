// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatView } from "../../renderer/components/ChatView";
import { PaneContext } from "../../renderer/components/split/pane-context";
import { useAppStore } from "../../renderer/store";
import { useSplitLayoutStore } from "../../renderer/store/split-layout";
import type { MountedPath, Session } from "../../renderer/types";
import type * as VoiceInputModule from "../../renderer/hooks/useVoiceInput";

const pushToTalkCalls: unknown[][] = [];
const focusCalls: string[] = [];
const voiceMock = { status: "idle", cancel: vi.fn(async () => {}) };

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

vi.mock("../../renderer/hooks/usePushToTalk", () => ({
  usePushToTalk: (...args: unknown[]) => {
    pushToTalkCalls.push(args);
  },
}));

vi.mock("../../renderer/hooks/useVoiceInput", async (importOriginal) => {
  const actual = await importOriginal<typeof VoiceInputModule>();
  return {
    ...actual,
    useVoiceInput: () => ({
      status: voiceMock.status,
      toggle: vi.fn(),
      cancel: voiceMock.cancel,
    }),
  };
});

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
    ChatInput: ReactModule.forwardRef(function MockChatInput(
      props: { draftKey?: string },
      ref,
    ) {
      ReactModule.useImperativeHandle(ref, () => ({
        clear: () => {},
        focus: () => {
          focusCalls.push(props.draftKey ?? "");
        },
        setPrompt: () => {},
        getPrompt: () => "",
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
vi.mock("../../renderer/components/ChatInputStatusBar", () => ({
  ChatInputStatusBar: () => React.createElement("div"),
  resolveInputStatus: () => null,
}));
vi.mock("../../renderer/components/ChatInputQueueBar", () => ({
  ChatInputQueueBar: () => React.createElement("div"),
}));

function makeSession(id: string): Session {
  return {
    id,
    title: id,
    status: "idle",
    createdAt: 1,
    updatedAt: 1,
    cwd: "/tmp",
    mountedPaths: [] as MountedPath[],
    allowedTools: [],
    memoryEnabled: false,
    isProjectMode: false,
  };
}

function emptyState(): never {
  return {
    historyHydrated: true,
    hasMoreOlder: false,
    oldestMessageId: null,
    messages: [],
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
  } as never;
}

describe("ChatView focus gating", () => {
  let container: HTMLDivElement;
  let root: Root;
  let p1: string;
  let p2: string;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    pushToTalkCalls.length = 0;
    voiceMock.status = "idle";
    voiceMock.cancel.mockClear();
    focusCalls.length = 0;
    class ResizeObserverMock {
      observe() {}
      disconnect() {}
      unobserve() {}
    }
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      writable: true,
      value: () => {},
    });
    useAppStore.setState(useAppStore.getInitialState(), true);
    useSplitLayoutStore.setState(useSplitLayoutStore.getInitialState(), true);
    useAppStore.setState({
      sessions: [makeSession("S1"), makeSession("S2")],
      activeSessionId: "S1",
      sessionStates: { S1: emptyState(), S2: emptyState() },
    });
    const layout = useSplitLayoutStore.getState();
    const first = layout.root;
    p1 = first.kind === "leaf" ? first.paneId : "";
    layout.setPaneSession(p1, "S1");
    p2 = layout.splitPane(p1, "row", "after", "S2") ?? "";
    layout.focusPane(p1);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function lastEnabled(): unknown {
    return pushToTalkCalls[pushToTalkCalls.length - 1]?.[2];
  }

  async function renderPane2(): Promise<void> {
    await act(async () => {
      root.render(
        <PaneContext.Provider value={{ paneId: p2, sessionId: "S2" }}>
          <ChatView />
        </PaneContext.Provider>,
      );
    });
  }

  it("未聚焦区域的 push-to-talk 被禁用，聚焦后恢复", async () => {
    useAppStore.setState({
      appConfig: { voiceEngine: { enabled: true, shortcut: "AltRight" } },
    } as never);
    await renderPane2();
    expect(pushToTalkCalls.length).toBeGreaterThan(0);
    expect(lastEnabled()).toBe(false);
    await act(async () => {
      useSplitLayoutStore.getState().focusPane(p2);
    });
    expect(lastEnabled()).toBe(true);
  });

  it("未聚焦区域不自动聚焦输入框", async () => {
    await renderPane2();
    expect(focusCalls).toEqual([]);
  });

  it("Provider 外（无分屏）push-to-talk 行为不变", async () => {
    useAppStore.setState({
      appConfig: { voiceEngine: { enabled: true, shortcut: "AltRight" } },
    } as never);
    await act(async () => {
      root.render(<ChatView />);
    });
    expect(lastEnabled()).toBe(true);
    expect(focusCalls.length).toBeGreaterThan(0);
  });

  it("录音中焦点移到别的区域：结束这一路录音", async () => {
    useSplitLayoutStore.getState().focusPane(p2);
    voiceMock.status = "recording";
    await renderPane2();
    expect(voiceMock.cancel).not.toHaveBeenCalled();
    await act(async () => {
      useSplitLayoutStore.getState().focusPane(p1);
    });
    expect(voiceMock.cancel).toHaveBeenCalledTimes(1);
  });
});
