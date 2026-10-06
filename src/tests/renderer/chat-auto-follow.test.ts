// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatView } from "../../renderer/components/ChatView";
import { useAppStore } from "../../renderer/store";
import type { Message, MountedPath, Session } from "../../renderer/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));

const getSessionMessagesPageMock = vi.fn();

vi.mock("../../renderer/hooks/useIPC", () => ({
  useIPC: () => ({
    continueSession: vi.fn(),
    stopSession: vi.fn(),
    setSessionThinkingLevel: vi.fn(),
    setSessionProviderModel: vi.fn(),
    getSessionMessagesPage: getSessionMessagesPageMock,
    isElectron: false,
  }),
}));

vi.mock("../../renderer/components/ChatInput", async () => {
  const ReactModule = await import("react");
  return {
    ChatInput: ReactModule.forwardRef(function MockChatInput(
      props: { onToggleExpand?: () => void },
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
      return ReactModule.createElement("button", {
        "aria-label": "test.expandInput",
        onClick: props.onToggleExpand,
      });
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

function makeSession(): Session {
  return {
    id: "s1",
    title: "Auto-follow test",
    status: "running",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    cwd: "/tmp",
    mountedPaths: [] as MountedPath[],
    allowedTools: [],
    memoryEnabled: false,
    isProjectMode: false,
  };
}

function makeMessage(id: string, role: Message["role"]): Message {
  return {
    id,
    sessionId: "s1",
    role,
    timestamp: Date.now(),
    content: [{ type: "text", text: id }],
  };
}

function makeReplies(count: number, turnId = "turn-1"): Message[] {
  return Array.from({ length: count }, (_, i) => ({
    ...makeMessage(`reply-${i}`, "assistant"),
    turnId,
    content: [{ type: "text", text: `answer-${i}` }],
  }));
}

function renderedIds(scroller: HTMLElement, prefix = ""): string[] {
  return Array.from(scroller.querySelectorAll<HTMLElement>("[data-message-id]"))
    .map((node) => node.dataset.messageId!)
    .filter((id) => id.startsWith(prefix));
}

function setInitialState(): void {
  useAppStore.setState({
    sessions: [makeSession()],
    activeSessionId: "s1",
    sessionStates: {
      s1: {
        historyHydrated: true,
        hasMoreOlder: false,
        oldestMessageId: null,
        messages: [makeMessage("u1", "user"), makeMessage("a1", "assistant")],
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
        subagentActivities: {},
        currentTodos: null,
        lastNonEmptyTodos: null,
        currentPlanDone: false,
        lastPlanDone: false,
      },
    },
  });
}

describe("ChatView auto-follow", () => {
  let container: HTMLDivElement;
  let root: Root;
  let resizeCallbacks: Map<Element, ResizeObserverCallback>;
  let scrollToDescriptor: PropertyDescriptor | undefined;
  let scrollIntoViewDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    useAppStore.setState(useAppStore.getInitialState());
    setInitialState();
    getSessionMessagesPageMock.mockReset();

    resizeCallbacks = new Map();
    class ResizeObserverMock {
      private readonly targets = new Set<Element>();

      constructor(private readonly callback: ResizeObserverCallback) {}

      observe(target: Element) {
        this.targets.add(target);
        resizeCallbacks.set(target, this.callback);
      }

      disconnect() {
        for (const target of this.targets) {
          if (resizeCallbacks.get(target) === this.callback) {
            resizeCallbacks.delete(target);
          }
        }
        this.targets.clear();
      }

      unobserve(target: Element) {
        this.targets.delete(target);
        if (resizeCallbacks.get(target) === this.callback) {
          resizeCallbacks.delete(target);
        }
      }
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

    scrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(
      Element.prototype,
      "scrollIntoView",
    );
    Object.defineProperty(Element.prototype, "scrollIntoView", {
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
    vi.restoreAllMocks();
    vi.useRealTimers();
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
    if (scrollIntoViewDescriptor) {
      Object.defineProperty(
        Element.prototype,
        "scrollIntoView",
        scrollIntoViewDescriptor,
      );
    } else {
      delete (
        Element.prototype as unknown as {
          scrollIntoView?: Element["scrollIntoView"];
        }
      ).scrollIntoView;
    }
  });

  async function renderStreamingWindow(historyCount = 500, replyCount = 35) {
    // jsdom has no layout. Suppress auto-fill and model message heights only.
    vi.stubGlobal("requestAnimationFrame", () => 1);
    const history = Array.from({ length: historyCount }, (_, i) =>
      makeMessage(`history-${i}`, i % 2 === 0 ? "user" : "assistant"),
    );
    useAppStore.setState((state) => ({
      sessionStates: {
        ...state.sessionStates,
        s1: {
          ...state.sessionStates.s1!,
          messages: [
            ...history,
            makeMessage("u1", "user"),
            ...makeReplies(replyCount),
          ],
          activeTurn: {
            turnId: "turn-1",
            userMessageId: "u1",
            startedAt: Date.now(),
          },
          partialMessage: "streaming tail",
        },
      },
    }));
    await act(async () => root.render(React.createElement(ChatView)));
    const scroller =
      container.querySelector<HTMLDivElement>(".overflow-y-auto")!;
    installMessageHeights(scroller);
    await act(async () => {
      scroller.scrollTop = scroller.scrollHeight - scroller.clientHeight;
      scroller.dispatchEvent(new Event("scroll"));
    });
    expect(scroller.textContent).toContain(`answer-${replyCount - 1}`);
    return scroller;
  }

  function installMessageHeights(
    scroller: HTMLDivElement,
    heightFor: (id: string) => number = (id) =>
      id.startsWith("partial-") ? 350 : id.startsWith("reply-") ? 30 : 10,
  ) {
    let top = scroller.scrollTop;
    Object.defineProperties(scroller, {
      scrollHeight: {
        configurable: true,
        get: () =>
          renderedIds(scroller).reduce((sum, id) => sum + heightFor(id), 0),
      },
      clientHeight: { configurable: true, value: 500 },
      scrollTop: {
        configurable: true,
        get: () => top,
        set: (value: number) => {
          top = Math.min(
            Math.max(0, value),
            Math.max(0, scroller.scrollHeight - 500),
          );
        },
      },
    });
  }

  function installMessageRects(
    scroller: HTMLDivElement,
    heightFor: (id: string) => number,
  ) {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        let top = 0;
        if (this.dataset.messageId) {
          for (
            let sibling = this.previousElementSibling;
            sibling;
            sibling = sibling.previousElementSibling
          ) {
            const id = (sibling as HTMLElement).dataset.messageId;
            if (id) top += heightFor(id);
          }
          top -= scroller.scrollTop;
        }
        const height = this.dataset.messageId
          ? heightFor(this.dataset.messageId)
          : 500;
        return {
          x: 0,
          y: top,
          top,
          bottom: top + height,
          left: 0,
          right: 500,
          width: 500,
          height,
          toJSON: () => ({}),
        };
      },
    );
  }

  async function stopFollowing(scroller: HTMLElement) {
    await act(async () => {
      scroller.dispatchEvent(
        new WheelEvent("wheel", { bubbles: true, deltaY: -4 }),
      );
    });
  }

  it("keeps an idle conversation pinned after content grows during programmatic scrolling", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    await act(async () => root.render(React.createElement(ChatView)));

    const scrollContainer =
      container.querySelector<HTMLDivElement>(".overflow-y-auto");
    expect(scrollContainer).not.toBeNull();

    let scrollHeight = 1000;
    Object.defineProperties(scrollContainer!, {
      scrollHeight: { configurable: true, get: () => scrollHeight },
      clientHeight: { configurable: true, value: 500 },
    });
    scrollContainer!.scrollTop = 500;

    const messagesContainer = scrollContainer!.firstElementChild;
    expect(messagesContainer).not.toBeNull();
    expect(resizeCallbacks.has(messagesContainer!)).toBe(true);

    scrollHeight = 1120;
    await act(async () => {
      resizeCallbacks.get(messagesContainer!)?.([], {} as ResizeObserver);
    });

    const distanceToBottom =
      scrollHeight - scrollContainer!.scrollTop - scrollContainer!.clientHeight;
    expect(distanceToBottom).toBeLessThanOrEqual(1);
  });

  it("does not pull an idle conversation back down after the user scrolls upward", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    await act(async () => root.render(React.createElement(ChatView)));

    const scrollContainer =
      container.querySelector<HTMLDivElement>(".overflow-y-auto");
    expect(scrollContainer).not.toBeNull();

    let scrollHeight = 1000;
    Object.defineProperties(scrollContainer!, {
      scrollHeight: { configurable: true, get: () => scrollHeight },
      clientHeight: { configurable: true, value: 500 },
    });
    scrollContainer!.scrollTop = 500;

    await act(async () => {
      scrollContainer!.dispatchEvent(
        new WheelEvent("wheel", { bubbles: true, deltaY: -20 }),
      );
    });

    const messagesContainer = scrollContainer!.firstElementChild;
    expect(messagesContainer).not.toBeNull();
    scrollHeight = 1120;
    await act(async () => {
      resizeCallbacks.get(messagesContainer!)?.([], {} as ResizeObserver);
    });

    expect(scrollContainer!.scrollTop).toBe(500);
  });

  it("stops following streaming output as soon as the user scrolls upward", async () => {
    await act(async () => root.render(React.createElement(ChatView)));

    const scrollContainer =
      container.querySelector<HTMLDivElement>(".overflow-y-auto");
    expect(scrollContainer).not.toBeNull();

    Object.defineProperties(scrollContainer!, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 500 },
    });
    scrollContainer!.scrollTop = 500;

    await act(async () => {
      scrollContainer!.dispatchEvent(
        new WheelEvent("wheel", { bubbles: true, deltaY: -20 }),
      );
      scrollContainer!.scrollTop = 490;
      scrollContainer!.dispatchEvent(new Event("scroll"));
    });

    await act(async () => {
      useAppStore.setState((state) => ({
        sessionStates: {
          ...state.sessionStates,
          s1: {
            ...state.sessionStates.s1!,
            partialMessage: "next token",
          },
        },
      }));
    });

    expect(scrollContainer!.scrollTop).toBe(490);
  });

  it("stops following when an upward scroll does not emit a wheel event", async () => {
    await act(async () => root.render(React.createElement(ChatView)));

    const scrollContainer =
      container.querySelector<HTMLDivElement>(".overflow-y-auto");
    expect(scrollContainer).not.toBeNull();

    Object.defineProperties(scrollContainer!, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 500 },
    });
    scrollContainer!.scrollTop = 500;
    scrollContainer!.dispatchEvent(new Event("scroll"));

    await act(async () => {
      scrollContainer!.scrollTop = 490;
      scrollContainer!.dispatchEvent(new Event("scroll"));
    });

    await act(async () => {
      useAppStore.setState((state) => ({
        sessionStates: {
          ...state.sessionStates,
          s1: {
            ...state.sessionStates.s1!,
            partialMessage: "next token",
          },
        },
      }));
    });

    expect(scrollContainer!.scrollTop).toBe(490);
  });

  it("does not follow after wheel-up even when a bottom scroll event intervenes", async () => {
    // wheel-up kills follow immediately; an intervening scroll event
    // reporting the bottom does not revive it.
    await act(async () => root.render(React.createElement(ChatView)));

    const scrollContainer =
      container.querySelector<HTMLDivElement>(".overflow-y-auto");
    expect(scrollContainer).not.toBeNull();

    Object.defineProperties(scrollContainer!, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 500 },
    });
    scrollContainer!.scrollTop = 500;
    scrollContainer!.dispatchEvent(new Event("scroll"));

    await act(async () => {
      scrollContainer!.dispatchEvent(
        new WheelEvent("wheel", { bubbles: true, deltaY: -20 }),
      );
      scrollContainer!.dispatchEvent(new Event("scroll"));
    });

    await act(async () => {
      useAppStore.setState((state) => ({
        sessionStates: {
          ...state.sessionStates,
          s1: {
            ...state.sessionStates.s1!,
            partialMessage: "next token",
          },
        },
      }));
    });

    expect(scrollContainer!.scrollTop).toBe(500);
  });

  it("keeps following when content shrinkage clamps the viewport at the bottom", async () => {
    await act(async () => root.render(React.createElement(ChatView)));

    const scrollContainer =
      container.querySelector<HTMLDivElement>(".overflow-y-auto");
    expect(scrollContainer).not.toBeNull();

    let scrollHeight = 1000;
    Object.defineProperties(scrollContainer!, {
      scrollHeight: { configurable: true, get: () => scrollHeight },
      clientHeight: { configurable: true, value: 500 },
    });
    scrollContainer!.scrollTop = 500;
    scrollContainer!.dispatchEvent(new Event("scroll"));

    await act(async () => {
      scrollHeight = 900;
      scrollContainer!.scrollTop = 400;
      scrollContainer!.dispatchEvent(new Event("scroll"));
    });

    await act(async () => {
      scrollHeight = 910;
      useAppStore.setState((state) => ({
        sessionStates: {
          ...state.sessionStates,
          s1: {
            ...state.sessionStates.s1!,
            partialMessage: "next token",
          },
        },
      }));
    });

    expect(scrollContainer!.scrollTop).toBe(910);
  });

  it("resumes following when the user scrolls back to the bottom mid-stream", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    await act(async () => root.render(React.createElement(ChatView)));

    const scrollContainer =
      container.querySelector<HTMLDivElement>(".overflow-y-auto");
    expect(scrollContainer).not.toBeNull();

    let scrollHeight = 1000;
    Object.defineProperties(scrollContainer!, {
      scrollHeight: { configurable: true, get: () => scrollHeight },
      clientHeight: { configurable: true, value: 500 },
    });
    scrollContainer!.scrollTop = 500;
    scrollContainer!.dispatchEvent(new Event("scroll"));

    // Scroll up to read history
    await act(async () => {
      scrollContainer!.dispatchEvent(
        new WheelEvent("wheel", { bubbles: true, deltaY: -20 }),
      );
      scrollContainer!.scrollTop = 300;
      scrollContainer!.dispatchEvent(new Event("scroll"));
    });

    // Streaming continues while reading — must not yank
    scrollHeight = 1200;
    await act(async () => {
      useAppStore.setState((state) => ({
        sessionStates: {
          ...state.sessionStates,
          s1: {
            ...state.sessionStates.s1!,
            partialMessage: "t1",
          },
        },
      }));
    });
    expect(scrollContainer!.scrollTop).toBe(300);

    // Scroll back to the bottom (max = 700) mid-stream
    await act(async () => {
      scrollContainer!.dispatchEvent(
        new WheelEvent("wheel", { bubbles: true, deltaY: 400 }),
      );
      scrollContainer!.scrollTop = 700;
      scrollContainer!.dispatchEvent(new Event("scroll"));
    });

    // Next token must pin to the new bottom. Use a different-length token
    // so the layout effect observes the partialMessage length change. jsdom
    // does not clamp direct scrollTop assignments, so assert distance (same
    // style as test 1).
    scrollHeight = 1300;
    await act(async () => {
      useAppStore.setState((state) => ({
        sessionStates: {
          ...state.sessionStates,
          s1: {
            ...state.sessionStates.s1!,
            partialMessage: "t2x",
          },
        },
      }));
    });
    const distanceToBottom = scrollHeight - scrollContainer!.scrollTop - 500;
    expect(distanceToBottom).toBeLessThanOrEqual(1);
  });

  it("kills follow on a small scrollbar-style upward move (no wheel event)", async () => {
    await act(async () => root.render(React.createElement(ChatView)));

    const scrollContainer =
      container.querySelector<HTMLDivElement>(".overflow-y-auto");
    expect(scrollContainer).not.toBeNull();

    let scrollHeight = 1000;
    Object.defineProperties(scrollContainer!, {
      scrollHeight: { configurable: true, get: () => scrollHeight },
      clientHeight: { configurable: true, value: 500 },
    });
    scrollContainer!.scrollTop = 500;
    scrollContainer!.dispatchEvent(new Event("scroll"));

    // 10px upward move via scrollbar/keyboard — no wheel event at all
    await act(async () => {
      scrollContainer!.scrollTop = 490;
      scrollContainer!.dispatchEvent(new Event("scroll"));
    });

    // Streaming continues — follow must stay OFF (killed by the upward move)
    scrollHeight = 1010;
    await act(async () => {
      useAppStore.setState((state) => ({
        sessionStates: {
          ...state.sessionStates,
          s1: {
            ...state.sessionStates.s1!,
            partialMessage: "next token",
          },
        },
      }));
    });

    expect(scrollContainer!.scrollTop).toBe(490);
  });

  it("ignores a 1px upward wheel jitter at the bottom", async () => {
    await act(async () => root.render(React.createElement(ChatView)));

    const scrollContainer =
      container.querySelector<HTMLDivElement>(".overflow-y-auto");
    expect(scrollContainer).not.toBeNull();

    let scrollHeight = 1000;
    Object.defineProperties(scrollContainer!, {
      scrollHeight: { configurable: true, get: () => scrollHeight },
      clientHeight: { configurable: true, value: 500 },
    });
    scrollContainer!.scrollTop = 500;
    scrollContainer!.dispatchEvent(new Event("scroll"));

    await act(async () => {
      scrollContainer!.dispatchEvent(
        new WheelEvent("wheel", { bubbles: true, deltaY: -1 }),
      );
    });

    // Streaming continues — follow must survive the jitter
    scrollHeight = 1010;
    await act(async () => {
      useAppStore.setState((state) => ({
        sessionStates: {
          ...state.sessionStates,
          s1: {
            ...state.sessionStates.s1!,
            partialMessage: "next token",
          },
        },
      }));
    });

    expect(scrollContainer!.scrollTop).toBe(1010);
  });

  it("does not kill follow when the wheel scrolls a nested overflow area", async () => {
    await act(async () => root.render(React.createElement(ChatView)));

    const scrollContainer =
      container.querySelector<HTMLDivElement>(".overflow-y-auto");
    expect(scrollContainer).not.toBeNull();

    let scrollHeight = 1000;
    Object.defineProperties(scrollContainer!, {
      scrollHeight: { configurable: true, get: () => scrollHeight },
      clientHeight: { configurable: true, value: 500 },
    });
    scrollContainer!.scrollTop = 500;
    scrollContainer!.dispatchEvent(new Event("scroll"));

    // Simulate a tool-output block (nested overflow-y-auto element)
    const inner = document.createElement("div");
    inner.className = "overflow-y-auto";
    scrollContainer!.appendChild(inner);

    await act(async () => {
      inner.dispatchEvent(
        new WheelEvent("wheel", { bubbles: true, deltaY: -20 }),
      );
    });

    // Streaming continues — follow must survive (container never scrolled)
    scrollHeight = 1010;
    await act(async () => {
      useAppStore.setState((state) => ({
        sessionStates: {
          ...state.sessionStates,
          s1: {
            ...state.sessionStates.s1!,
            partialMessage: "next token",
          },
        },
      }));
    });

    expect(scrollContainer!.scrollTop).toBe(1010);
  });

  it("scroll-to-bottom button restores follow after a wheel-up kill", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    await act(async () => root.render(React.createElement(ChatView)));

    const scrollContainer =
      container.querySelector<HTMLDivElement>(".overflow-y-auto");
    expect(scrollContainer).not.toBeNull();

    const scrollHeight = 1000;
    Object.defineProperties(scrollContainer!, {
      scrollHeight: { configurable: true, get: () => scrollHeight },
      clientHeight: { configurable: true, value: 500 },
    });
    scrollContainer!.scrollTop = 500;
    scrollContainer!.dispatchEvent(new Event("scroll"));

    // New assistant message arrives (non-own: pins directly under the new
    // single-source follow state).
    await act(async () => {
      useAppStore.setState((state) => ({
        sessionStates: {
          ...state.sessionStates,
          s1: {
            ...state.sessionStates.s1!,
            messages: [
              ...state.sessionStates.s1!.messages,
              makeMessage("a2", "assistant"),
            ],
            partialMessage: "",
          },
        },
      }));
    });

    // User scrolls up while the smooth scroll settles (follow off)
    await act(async () => {
      scrollContainer!.dispatchEvent(
        new WheelEvent("wheel", { bubbles: true, deltaY: -20 }),
      );
      scrollContainer!.scrollTop = 400;
      scrollContainer!.dispatchEvent(new Event("scroll"));
    });

    // Click the button within the 300ms window — must still work
    const btn = container.querySelector<HTMLButtonElement>(
      "button[aria-label='Scroll to bottom']",
    );
    expect(btn).not.toBeNull();
    await act(async () => {
      btn!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(scrollContainer!.scrollTop).toBe(500);
  });

  it("treats line-mode wheel deltas as intentional (bypass jitter filter)", async () => {
    await act(async () => root.render(React.createElement(ChatView)));

    const scrollContainer =
      container.querySelector<HTMLDivElement>(".overflow-y-auto");
    expect(scrollContainer).not.toBeNull();

    let scrollHeight = 1000;
    Object.defineProperties(scrollContainer!, {
      scrollHeight: { configurable: true, get: () => scrollHeight },
      clientHeight: { configurable: true, value: 500 },
    });
    scrollContainer!.scrollTop = 500;
    scrollContainer!.dispatchEvent(new Event("scroll"));

    // Notch-mode wheel (deltaMode=LINE): 1 notch upward is intentional, so
    // the sub-4px jitter filter must NOT apply — follow gets killed.
    await act(async () => {
      scrollContainer!.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          deltaY: -1,
          deltaMode: WheelEvent.DOM_DELTA_LINE,
        }),
      );
    });

    // Streaming continues — follow must stay OFF (killed by the notch)
    scrollHeight = 1010;
    await act(async () => {
      useAppStore.setState((state) => ({
        sessionStates: {
          ...state.sessionStates,
          s1: {
            ...state.sessionStates.s1!,
            partialMessage: "next token",
          },
        },
      }));
    });

    expect(scrollContainer!.scrollTop).toBe(500);
  });

  it("keeps following when a scroll event fires mid-growth without reaching the bottom", async () => {
    await act(async () => root.render(React.createElement(ChatView)));

    const scrollContainer =
      container.querySelector<HTMLDivElement>(".overflow-y-auto");
    expect(scrollContainer).not.toBeNull();

    let scrollHeight = 1000;
    Object.defineProperties(scrollContainer!, {
      scrollHeight: { configurable: true, get: () => scrollHeight },
      clientHeight: { configurable: true, value: 500 },
    });
    scrollContainer!.scrollTop = 500;
    scrollContainer!.dispatchEvent(new Event("scroll"));

    // Content grows via the RO-only path (tool result streaming); the
    // viewport has not been pinned yet. A scroll event fires while the user
    // is still at the bottom position — e.g. the tail of a programmatic
    // smooth scroll, or a tiny downward nudge. This must NOT kill follow.
    scrollHeight = 1500;
    await act(async () => {
      scrollContainer!.scrollTop = 600; // mid-state, not at the new bottom
      scrollContainer!.dispatchEvent(new Event("scroll"));
    });

    // More growth: follow must still pin. Direct scrollTop assignment in
    // jsdom is not clamped, so assert distance (real-browser semantics).
    scrollHeight = 1600;
    const messagesContainer = scrollContainer!.firstElementChild!;
    await act(async () => {
      resizeCallbacks.get(messagesContainer)?.([], {} as ResizeObserver);
    });

    const distanceToBottom = scrollHeight - scrollContainer!.scrollTop - 500;
    expect(distanceToBottom).toBeLessThanOrEqual(1);
  });

  it("resumes following the moment the user reaches the physical bottom mid-stream", async () => {
    await act(async () => root.render(React.createElement(ChatView)));

    const scrollContainer =
      container.querySelector<HTMLDivElement>(".overflow-y-auto");
    expect(scrollContainer).not.toBeNull();

    let scrollHeight = 1000;
    Object.defineProperties(scrollContainer!, {
      scrollHeight: { configurable: true, get: () => scrollHeight },
      clientHeight: { configurable: true, value: 500 },
    });
    scrollContainer!.scrollTop = 500;
    scrollContainer!.dispatchEvent(new Event("scroll"));

    // Scroll up to read history (follow killed)
    await act(async () => {
      scrollContainer!.dispatchEvent(
        new WheelEvent("wheel", { bubbles: true, deltaY: -20 }),
      );
      scrollContainer!.scrollTop = 300;
      scrollContainer!.dispatchEvent(new Event("scroll"));
    });

    // Streaming continues; content grows
    scrollHeight = 1500;
    await act(async () => {
      useAppStore.setState((state) => ({
        sessionStates: {
          ...state.sessionStates,
          s1: {
            ...state.sessionStates.s1!,
            partialMessage: "t1",
          },
        },
      }));
    });
    expect(scrollContainer!.scrollTop).toBe(300);

    // User scrolls back down; the browser clamps scrollTop to the CURRENT
    // physical max at the moment of the scroll event. Content has NOT grown
    // since the last token, so the physical max is still 1000 — reaching it
    // must resume follow. (Growth simulation happens AFTER the revive.)
    await act(async () => {
      scrollContainer!.dispatchEvent(
        new WheelEvent("wheel", { bubbles: true, deltaY: 700 }),
      );
      scrollContainer!.scrollTop = 1000;
      scrollContainer!.dispatchEvent(new Event("scroll"));
    });

    // Next growth must pin to the new bottom. Direct scrollTop assignment
    // in jsdom is not clamped, so assert distance (real-browser semantics).
    scrollHeight = 1700;
    await act(async () => {
      useAppStore.setState((state) => ({
        sessionStates: {
          ...state.sessionStates,
          s1: {
            ...state.sessionStates.s1!,
            partialMessage: "t2x",
          },
        },
      }));
    });

    const distanceToBottom = scrollHeight - scrollContainer!.scrollTop - 500;
    expect(distanceToBottom).toBeLessThanOrEqual(1);
  });

  it("does not drag a history-reading user down when tool output grows", async () => {
    await act(async () => root.render(React.createElement(ChatView)));

    const scrollContainer =
      container.querySelector<HTMLDivElement>(".overflow-y-auto");
    expect(scrollContainer).not.toBeNull();

    let scrollHeight = 1000;
    Object.defineProperties(scrollContainer!, {
      scrollHeight: { configurable: true, get: () => scrollHeight },
      clientHeight: { configurable: true, value: 500 },
    });
    scrollContainer!.scrollTop = 500;
    scrollContainer!.dispatchEvent(new Event("scroll"));

    // User scrolls up to read history (follow killed)
    await act(async () => {
      scrollContainer!.dispatchEvent(
        new WheelEvent("wheel", { bubbles: true, deltaY: -20 }),
      );
      scrollContainer!.scrollTop = 300;
      scrollContainer!.dispatchEvent(new Event("scroll"));
    });

    // Tool output grows (RO path, follow OFF) — must NOT pin. Guards the
    // ResizeObserver branch with follow off (regression lock).
    scrollHeight = 1500;
    const messagesContainer = scrollContainer!.firstElementChild!;
    await act(async () => {
      resizeCallbacks.get(messagesContainer)?.([], {} as ResizeObserver);
    });

    expect(scrollContainer!.scrollTop).toBe(300);
  });

  it("does not force-follow when an auto-generated user message lands while reading history", async () => {
    await act(async () => root.render(React.createElement(ChatView)));

    const scrollContainer =
      container.querySelector<HTMLDivElement>(".overflow-y-auto");
    expect(scrollContainer).not.toBeNull();

    let scrollHeight = 1000;
    Object.defineProperties(scrollContainer!, {
      scrollHeight: { configurable: true, get: () => scrollHeight },
      clientHeight: { configurable: true, value: 500 },
    });
    scrollContainer!.scrollTop = 500;
    scrollContainer!.dispatchEvent(new Event("scroll"));

    // User scrolls up to read history (follow killed)
    await act(async () => {
      scrollContainer!.dispatchEvent(
        new WheelEvent("wheel", { bubbles: true, deltaY: -20 }),
      );
      scrollContainer!.scrollTop = 300;
      scrollContainer!.dispatchEvent(new Event("scroll"));
    });

    // An auto-generated user message lands (goal runs append these; they are
    // hidden from display) — must NOT be treated as an explicit send.
    await act(async () => {
      useAppStore.setState((state) => ({
        sessionStates: {
          ...state.sessionStates,
          s1: {
            ...state.sessionStates.s1!,
            messages: [
              ...state.sessionStates.s1!.messages,
              { ...makeMessage("auto1", "user"), autoGenerated: true },
            ],
          },
        },
      }));
    });

    // Streaming continues — follow must stay OFF
    scrollHeight = 1200;
    await act(async () => {
      useAppStore.setState((state) => ({
        sessionStates: {
          ...state.sessionStates,
          s1: {
            ...state.sessionStates.s1!,
            partialMessage: "next token",
          },
        },
      }));
    });

    expect(scrollContainer!.scrollTop).toBe(300);
  });

  it("keeps the final assistant message pinned when the active turn clears", async () => {
    useAppStore.setState((state) => ({
      sessionStates: {
        ...state.sessionStates,
        s1: {
          ...state.sessionStates.s1!,
          messages: [
            {
              ...makeMessage("u1", "user"),
              turnId: "turn-1",
            },
          ],
          activeTurn: {
            turnId: "turn-1",
            userMessageId: "u1",
            startedAt: Date.now(),
          },
          partialMessage: "streaming answer",
        },
      },
    }));

    await act(async () => root.render(React.createElement(ChatView)));

    const scrollContainer =
      container.querySelector<HTMLDivElement>(".overflow-y-auto");
    expect(scrollContainer).not.toBeNull();

    let scrollHeight = 1000;
    Object.defineProperties(scrollContainer!, {
      scrollHeight: { configurable: true, get: () => scrollHeight },
      clientHeight: { configurable: true, value: 500 },
    });
    scrollContainer!.scrollTop = 500;
    scrollContainer!.dispatchEvent(new Event("scroll"));

    expect(container.textContent).toContain("streaming answer");

    await act(async () => {
      useAppStore.getState().addMessage("s1", {
        ...makeMessage("final-a1", "assistant"),
        turnId: "turn-1",
        content: [{ type: "text", text: "final assistant answer" }],
      });
    });

    scrollHeight = 1120;
    await act(async () => {
      useAppStore.getState().clearActiveTurn("s1");
    });

    expect(container.textContent).toContain("final assistant answer");
    expect(useAppStore.getState().sessionStates.s1!.activeTurn).toBeNull();
    expect(scrollContainer!.scrollTop).toBe(1120);
  });

  it("pins the final reply after a long conversation's streaming card expands beyond the render window", async () => {
    // No real layout in jsdom: keep auto-fill from mistaking it for an
    // empty viewport, and model the tail reply's extra rendered height.
    vi.stubGlobal("requestAnimationFrame", () => 1);
    const history = Array.from({ length: 500 }, (_, i) =>
      makeMessage(`history-${i}`, i % 2 === 0 ? "user" : "assistant"),
    );
    const replies = Array.from({ length: 3 }, (_, i) => ({
      ...makeMessage(`reply-${i}`, "assistant"),
      turnId: "turn-1",
      content: [{ type: "text" as const, text: `answer-${i}` }],
    }));
    useAppStore.setState((state) => ({
      sessionStates: {
        ...state.sessionStates,
        s1: {
          ...state.sessionStates.s1!,
          messages: [...history, makeMessage("u1", "user"), ...replies],
          activeTurn: {
            turnId: "turn-1",
            userMessageId: "u1",
            startedAt: Date.now(),
          },
          partialMessage: "streaming tail",
        },
      },
    }));
    await act(async () => root.render(React.createElement(ChatView)));
    const scroller =
      container.querySelector<HTMLDivElement>(".overflow-y-auto")!;
    let scrollTop = 500;
    Object.defineProperties(scroller, {
      scrollHeight: {
        configurable: true,
        get: () =>
          scroller.querySelector('[data-message-id="reply-2"]') ? 1500 : 1000,
      },
      clientHeight: { configurable: true, value: 500 },
      scrollTop: {
        configurable: true,
        get: () => scrollTop,
        set: (top: number) => {
          scrollTop = Math.min(Math.max(0, top), scroller.scrollHeight - 500);
        },
      },
    });
    await act(async () => scroller.dispatchEvent(new Event("scroll")));
    expect(scroller.textContent).toContain("streaming tail");

    await act(async () => useAppStore.getState().clearActiveTurn("s1"));

    expect(
      scroller.querySelector('[data-message-id="reply-2"]'),
    ).not.toBeNull();
    expect(scroller.scrollTop).toBe(1000);
  });

  it("retains the completed turn without follow", async () => {
    vi.stubGlobal("requestAnimationFrame", () => 1);
    const history = Array.from({ length: 500 }, (_, i) =>
      makeMessage(`history-${i}`, i % 2 === 0 ? "user" : "assistant"),
    );
    const replies = Array.from({ length: 35 }, (_, i) => ({
      ...makeMessage(`reply-${i}`, "assistant"),
      turnId: "turn-1",
      content: [{ type: "text" as const, text: `answer-${i}` }],
    }));
    useAppStore.setState((state) => ({
      sessionStates: {
        ...state.sessionStates,
        s1: {
          ...state.sessionStates.s1!,
          messages: [...history, makeMessage("u1", "user"), ...replies],
          activeTurn: {
            turnId: "turn-1",
            userMessageId: "u1",
            startedAt: Date.now(),
          },
          partialMessage: "streaming tail",
        },
      },
    }));
    await act(async () => root.render(React.createElement(ChatView)));
    const scroller =
      container.querySelector<HTMLDivElement>(".overflow-y-auto")!;
    let scrollTop = 500;
    Object.defineProperties(scroller, {
      scrollHeight: {
        configurable: true,
        get: () =>
          scroller.querySelector('[data-message-id="reply-34"]') ? 1500 : 1000,
      },
      clientHeight: { configurable: true, value: 500 },
      scrollTop: {
        configurable: true,
        get: () => scrollTop,
        set: (top: number) => {
          scrollTop = Math.min(Math.max(0, top), scroller.scrollHeight - 500);
        },
      },
    });
    await act(async () => scroller.dispatchEvent(new Event("scroll")));
    expect(scroller.textContent).toContain("answer-34");
    const historyNodes = Array.from(
      scroller.querySelectorAll<HTMLElement>('[data-message-id^="history-"]'),
    );
    const historyIds = historyNodes.map((node) => node.dataset.messageId);
    expect(historyIds[0]).toBe("history-102");
    expect(historyIds).toHaveLength(398);

    await act(async () => {
      scroller.dispatchEvent(
        new WheelEvent("wheel", { bubbles: true, deltaY: -4 }),
      );
    });
    const beforeTop = scroller.scrollTop;
    await act(async () => useAppStore.getState().clearActiveTurn("s1"));

    expect(
      scroller.querySelector('[data-message-id="reply-34"]'),
    ).not.toBeNull();
    expect(
      scroller.querySelectorAll('[data-message-id^="reply-"]'),
    ).toHaveLength(35);
    expect(scroller.scrollTop).toBe(beforeTop);
    expect(scroller.querySelector('[data-message-id="history-102"]')).toBe(
      historyNodes[0],
    );
    expect(
      Array.from(
        scroller.querySelectorAll<HTMLElement>('[data-message-id^="history-"]'),
      ).map((node) => node.dataset.messageId),
    ).toEqual(historyIds);
  });

  it("preserves the history window when completion happens while reading history", async () => {
    const scroller = await renderStreamingWindow();
    await stopFollowing(scroller);
    await act(async () => {
      scroller.scrollTop = 300;
      scroller.dispatchEvent(new Event("scroll"));
    });
    const firstHistoryNode = scroller.querySelector(
      '[data-message-id="history-102"]',
    );
    const historyIds = renderedIds(scroller, "history-");
    expect(firstHistoryNode).not.toBeNull();
    expect(historyIds).toHaveLength(398);

    await act(async () => useAppStore.getState().clearActiveTurn("s1"));

    expect(
      scroller.querySelector('[data-message-id="reply-34"]'),
    ).not.toBeNull();
    expect(scroller.scrollTop).toBe(300);
    expect(scroller.querySelector('[data-message-id="history-102"]')).toBe(
      firstHistoryNode,
    );
    expect(renderedIds(scroller, "history-")).toEqual(historyIds);
  });

  it("gives an older-window scroll priority over completion in the same batch", async () => {
    const scroller = await renderStreamingWindow();
    await stopFollowing(scroller);

    await act(async () => {
      scroller.scrollTop = 100;
      scroller.dispatchEvent(new Event("scroll"));
      useAppStore.getState().clearActiveTurn("s1");
    });

    expect(renderedIds(scroller)).toEqual(
      Array.from({ length: 400 }, (_, i) => `history-${i}`),
    );
    expect(scroller.querySelector('[data-message-id="reply-34"]')).toBeNull();
    expect(scroller.scrollTop).toBeLessThan(
      scroller.scrollHeight - scroller.clientHeight,
    );
  });

  it("gives a dock window jump priority over completion in the same batch", async () => {
    const scroller = await renderStreamingWindow();
    const firstTick = container.querySelector<HTMLElement>(
      '.absolute.top-0.bottom-0.z-10 [role="button"]',
    )!;

    await act(async () => {
      firstTick.click();
      useAppStore.getState().clearActiveTurn("s1");
    });

    expect(renderedIds(scroller)).toEqual(
      Array.from({ length: 400 }, (_, i) => `history-${i}`),
    );
    expect(scroller.querySelector('[data-message-id="reply-34"]')).toBeNull();
  });

  it("does not expand for a streaming card outside the history window", async () => {
    const scroller = await renderStreamingWindow();
    await stopFollowing(scroller);
    await act(async () => {
      scroller.scrollTop = 100;
      scroller.dispatchEvent(new Event("scroll"));
    });
    expect(
      scroller.querySelector('[data-message-id="partial-s1-turn-1"]'),
    ).toBeNull();
    const firstHistoryNode = scroller.querySelector(
      '[data-message-id="history-0"]',
    );
    const historyIds = renderedIds(scroller, "history-");
    const beforeTop = scroller.scrollTop;

    await act(async () => useAppStore.getState().clearActiveTurn("s1"));

    expect(scroller.querySelector('[data-message-id="reply-34"]')).toBeNull();
    expect(scroller.querySelector('[data-message-id="history-0"]')).toBe(
      firstHistoryNode,
    );
    expect(renderedIds(scroller, "history-")).toEqual(historyIds);
    expect(scroller.scrollTop).toBe(beforeTop);
  });

  it("keeps same-turn late replies visible without another scroll", async () => {
    const scroller = await renderStreamingWindow(500, 34);
    await stopFollowing(scroller);
    const historyIds = renderedIds(scroller, "history-");
    const beforeTop = scroller.scrollTop;

    await act(async () => useAppStore.getState().clearActiveTurn("s1"));
    await act(async () =>
      useAppStore.getState().addMessage("s1", makeReplies(35)[34]),
    );

    expect(
      scroller.querySelector('[data-message-id="reply-34"]'),
    ).not.toBeNull();
    expect(renderedIds(scroller, "reply-")).toHaveLength(35);
    expect(renderedIds(scroller, "history-")).toEqual(historyIds);
    expect(scroller.scrollTop).toBe(beforeTop);
  });

  it("does not accumulate coverage for a new turn outside the retained window", async () => {
    const scroller = await renderStreamingWindow();
    await stopFollowing(scroller);
    await act(async () => useAppStore.getState().clearActiveTurn("s1"));
    await act(async () => {
      useAppStore.setState((state) => ({
        sessionStates: {
          ...state.sessionStates,
          s1: {
            ...state.sessionStates.s1!,
            messages: [
              ...state.sessionStates.s1!.messages,
              { ...makeMessage("auto-u2", "user"), autoGenerated: true },
              ...makeReplies(35, "turn-2").map((message, i) => ({
                ...message,
                id: `next-reply-${i}`,
              })),
            ],
            activeTurn: {
              turnId: "turn-2",
              userMessageId: "auto-u2",
              startedAt: Date.now(),
            },
            partialMessage: "new streaming tail",
          },
        },
      }));
    });
    expect(
      scroller.querySelector('[data-message-id="partial-s1-turn-2"]'),
    ).toBeNull();
    const beforeTop = scroller.scrollTop;

    await act(async () => useAppStore.getState().clearActiveTurn("s1"));

    expect(
      scroller.querySelector('[data-message-id="next-reply-34"]'),
    ).toBeNull();
    expect(renderedIds(scroller).length).toBeLessThanOrEqual(434);
    expect(scroller.scrollTop).toBe(beforeTop);
  });

  it("discards old coverage on a session switch even when turn IDs repeat", async () => {
    const scroller = await renderStreamingWindow();
    await stopFollowing(scroller);
    await act(async () => useAppStore.getState().clearActiveTurn("s1"));
    await act(async () => {
      useAppStore.getState().addSession({ ...makeSession(), id: "s2" });
      useAppStore.getState().setMessagesTail(
        "s2",
        Array.from({ length: 600 }, (_, i) => ({
          ...makeMessage(
            `other-history-${i}`,
            i % 2 === 0 ? "user" : "assistant",
          ),
          sessionId: "s2",
        })),
        false,
      );
      useAppStore.getState().setActiveSession("s2");
    });
    await act(async () => {
      scroller.scrollTop = scroller.scrollHeight - scroller.clientHeight;
      scroller.dispatchEvent(new Event("scroll"));
    });
    await stopFollowing(scroller);
    await act(async () => {
      scroller.scrollTop = 100;
      scroller.dispatchEvent(new Event("scroll"));
    });
    const historyIds = renderedIds(scroller);
    expect(historyIds[0]).toBe("other-history-0");
    expect(historyIds).toHaveLength(400);

    await act(async () => {
      useAppStore.getState().addMessage("s2", {
        ...makeMessage("other-late-reply", "assistant"),
        sessionId: "s2",
        turnId: "turn-1",
      });
    });

    expect(
      scroller.querySelector('[data-message-id="other-late-reply"]'),
    ).toBeNull();
    expect(renderedIds(scroller)).toEqual(historyIds);
    expect(scroller.querySelector('[data-message-id="reply-34"]')).toBeNull();
  });

  it.each([false, true])(
    "keeps a visible history anchor when prepend removes an uneven expanded tail (late reply: %s)",
    async (addLateReply) => {
      const scroller = await renderStreamingWindow();
      const heightFor = (id: string) => {
        if (id.startsWith("history-"))
          return Number(id.slice(8)) < 102 ? 15 : 10;
        return id.startsWith("reply-")
          ? 30
          : id.startsWith("partial-")
            ? 350
            : 10;
      };
      installMessageHeights(scroller, heightFor);
      installMessageRects(scroller, heightFor);
      await stopFollowing(scroller);
      await act(async () => useAppStore.getState().clearActiveTurn("s1"));
      expect(
        scroller.querySelector('[data-message-id="reply-34"]'),
      ).not.toBeNull();

      scroller.scrollTop = 100;
      const historyNode = scroller.querySelector<HTMLElement>(
        '[data-message-id="history-114"]',
      )!;
      const beforeOffset = historyNode.getBoundingClientRect().top;
      expect(beforeOffset).toBe(20);
      await act(async () => {
        scroller.dispatchEvent(new Event("scroll"));
        if (addLateReply) {
          useAppStore.getState().addMessage("s1", {
            ...makeMessage("late-reply", "assistant"),
            turnId: "turn-1",
          });
        }
      });

      expect(scroller.querySelector('[data-message-id="history-114"]')).toBe(
        historyNode,
      );
      expect(historyNode.getBoundingClientRect().top).toBe(beforeOffset);
      expect(renderedIds(scroller)).toEqual(
        Array.from({ length: 400 }, (_, i) => `history-${i}`),
      );
      expect(scroller.querySelector('[data-message-id="reply-34"]')).toBeNull();
    },
  );

  it("keeps an expanded-window anchor when a short fetched page leaves the start at zero", async () => {
    const scroller = await renderStreamingWindow(398);
    const heightFor = (id: string) =>
      id.startsWith("older-")
        ? 15
        : id.startsWith("reply-")
          ? 30
          : id.startsWith("partial-")
            ? 350
            : 10;
    installMessageHeights(scroller, heightFor);
    installMessageRects(scroller, heightFor);
    await act(async () => {
      useAppStore.setState((state) => ({
        sessionStates: {
          ...state.sessionStates,
          s1: {
            ...state.sessionStates.s1!,
            hasMoreOlder: true,
            oldestMessageId: "history-0",
          },
        },
      }));
    });
    getSessionMessagesPageMock.mockResolvedValue({
      messages: Array.from({ length: 100 }, (_, i) =>
        makeMessage(`older-${i}`, i % 2 === 0 ? "user" : "assistant"),
      ),
      hasMore: false,
    });
    await stopFollowing(scroller);
    await act(async () => useAppStore.getState().clearActiveTurn("s1"));
    expect(
      scroller.querySelector('[data-message-id="reply-34"]'),
    ).not.toBeNull();
    scroller.scrollTop = 100;
    const historyNode = scroller.querySelector<HTMLElement>(
      '[data-message-id="history-12"]',
    )!;
    const beforeOffset = historyNode.getBoundingClientRect().top;
    expect(beforeOffset).toBe(20);

    await act(async () => scroller.dispatchEvent(new Event("scroll")));

    expect(scroller.querySelector('[data-message-id="history-12"]')).toBe(
      historyNode,
    );
    expect(historyNode.getBoundingClientRect().top).toBe(beforeOffset);
    expect(renderedIds(scroller)).toEqual([
      ...Array.from({ length: 100 }, (_, i) => `older-${i}`),
      ...Array.from({ length: 300 }, (_, i) => `history-${i}`),
    ]);
    expect(scroller.querySelector('[data-message-id="reply-34"]')).toBeNull();
    expect(
      container.querySelector(".pointer-events-none.absolute.inset-x-0.top-3"),
    ).toBeNull();
  });

  it("restores the latest tail when an input-expansion frame runs after completion", async () => {
    const scroller = await renderStreamingWindow();
    await stopFollowing(scroller);
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="test.expandInput"]',
        )!
        .click();
    });
    await act(async () => useAppStore.getState().clearActiveTurn("s1"));
    expect(
      scroller.querySelector('[data-message-id="reply-34"]'),
    ).not.toBeNull();

    await act(async () => {
      for (const callback of frames.splice(0)) callback(0);
    });

    expect(
      scroller.querySelector('[data-message-id="reply-34"]'),
    ).not.toBeNull();
    expect(renderedIds(scroller)).toHaveLength(400);
    expect(renderedIds(scroller)[0]).toBe("history-136");
    expect(
      scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop,
    ).toBeLessThanOrEqual(1);
  });

  it.each(["button", "scroll", "wheel"] as const)(
    "restores the tail immediately through %s when the old start is zero",
    async (entry) => {
      // 398 history + user + synthetic card = exactly 400 displayed messages.
      const scroller = await renderStreamingWindow(398);
      expect(renderedIds(scroller)).toHaveLength(400);
      expect(renderedIds(scroller)[0]).toBe("history-0");
      await stopFollowing(scroller);
      await act(async () => useAppStore.getState().clearActiveTurn("s1"));

      // Do not assert completion coverage here: isolate recovery from retention.
      // This is also a valid recovery gesture against the old fixed-size window.
      await act(async () => {
        if (entry === "button") {
          container
            .querySelector<HTMLButtonElement>(
              'button[aria-label="Scroll to bottom"]',
            )!
            .click();
        } else if (entry === "scroll") {
          scroller.scrollTop = 300;
          scroller.dispatchEvent(new Event("scroll"));
          scroller.scrollTop = scroller.scrollHeight - scroller.clientHeight;
          scroller.dispatchEvent(new Event("scroll"));
        } else {
          scroller.scrollTop = scroller.scrollHeight - scroller.clientHeight;
          scroller.dispatchEvent(
            new WheelEvent("wheel", { bubbles: true, deltaY: 4 }),
          );
        }
      });

      expect(
        scroller.querySelector('[data-message-id="reply-34"]'),
      ).not.toBeNull();
      expect(renderedIds(scroller)).toHaveLength(400);
      expect(renderedIds(scroller)[0]).toBe("history-34");
      expect(
        scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop,
      ).toBeLessThanOrEqual(1);

      await act(async () =>
        useAppStore.getState().addMessage("s1", {
          ...makeMessage("reply-35", "assistant"),
          turnId: "turn-1",
        }),
      );

      expect(
        scroller.querySelector('[data-message-id="reply-35"]'),
      ).not.toBeNull();
      expect(renderedIds(scroller)).toHaveLength(400);
      expect(renderedIds(scroller)[0]).toBe("history-35");
      expect(
        scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop,
      ).toBeLessThanOrEqual(1);
    },
  );

  it("does not pin the final assistant message after the user scrolls up", async () => {
    useAppStore.setState((state) => ({
      sessionStates: {
        ...state.sessionStates,
        s1: {
          ...state.sessionStates.s1!,
          messages: [
            {
              ...makeMessage("u1", "user"),
              turnId: "turn-1",
            },
          ],
          activeTurn: {
            turnId: "turn-1",
            userMessageId: "u1",
            startedAt: Date.now(),
          },
          partialMessage: "streaming answer",
        },
      },
    }));

    await act(async () => root.render(React.createElement(ChatView)));

    const scrollContainer =
      container.querySelector<HTMLDivElement>(".overflow-y-auto");
    expect(scrollContainer).not.toBeNull();

    let scrollHeight = 1000;
    Object.defineProperties(scrollContainer!, {
      scrollHeight: { configurable: true, get: () => scrollHeight },
      clientHeight: { configurable: true, value: 500 },
    });
    scrollContainer!.scrollTop = 500;
    scrollContainer!.dispatchEvent(new Event("scroll"));

    await act(async () => {
      scrollContainer!.dispatchEvent(
        new WheelEvent("wheel", { bubbles: true, deltaY: -20 }),
      );
      scrollContainer!.scrollTop = 300;
      scrollContainer!.dispatchEvent(new Event("scroll"));
    });

    await act(async () => {
      useAppStore.getState().addMessage("s1", {
        ...makeMessage("final-a1", "assistant"),
        turnId: "turn-1",
        content: [{ type: "text", text: "final assistant answer" }],
      });
    });

    scrollHeight = 1120;
    await act(async () => {
      useAppStore.getState().clearActiveTurn("s1");
    });

    expect(container.textContent).toContain("final assistant answer");
    expect(scrollContainer!.scrollTop).toBe(300);
  });
});
