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
        inputQueue: [],
        steerRecords: [],
        partialToolResults: {},
        backgroundAgents: [],
      },
    },
  });
}

describe("ChatView auto-follow", () => {
  let container: HTMLDivElement;
  let root: Root;
  let resizeCallbacks: Map<Element, ResizeObserverCallback>;
  let scrollToDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    useAppStore.setState(useAppStore.getInitialState());
    setInitialState();

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

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
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
  });

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
