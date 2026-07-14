// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../renderer/i18n/config";
import { BrowserPanel } from "../../renderer/components/BrowserPanel";
import { useAppStore } from "../../renderer/store";

interface BrowserState {
  visible: boolean;
  url: string;
  title: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

const HIDDEN_STATE: BrowserState = {
  visible: false,
  url: "about:blank",
  title: "",
  isLoading: false,
  canGoBack: false,
  canGoForward: false,
};

class ResizeObserverMock {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("BrowserPanel visibility", () => {
  let container: HTMLDivElement;
  let root: Root;
  let stateListener: ((state: BrowserState) => void) | undefined;
  const setBounds = vi.fn();

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    globalThis.ResizeObserver =
      ResizeObserverMock as unknown as typeof ResizeObserver;
    useAppStore.setState(useAppStore.getInitialState());
    setBounds.mockReset();
    stateListener = undefined;

    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: {
        browser: {
          onStateChanged: (listener: (state: BrowserState) => void) => {
            stateListener = listener;
            return () => undefined;
          },
          getStatus: vi.fn().mockResolvedValue(HIDDEN_STATE),
          setBounds,
          setTheme: vi.fn(),
        },
      } as unknown as typeof window.electronAPI,
    });

    container = document.createElement("div");
    document.body.innerHTML = "";
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
  });

  it("re-syncs native view bounds when the browser becomes visible", async () => {
    await act(async () => {
      root.render(React.createElement(BrowserPanel, { width: 400 }));
    });
    await flush();

    expect(stateListener).toBeDefined();
    const callsBeforeRestore = setBounds.mock.calls.length;

    await act(async () => {
      stateListener?.({ ...HIDDEN_STATE, visible: true });
    });

    expect(setBounds.mock.calls.length).toBeGreaterThan(callsBeforeRestore);
  });
});
