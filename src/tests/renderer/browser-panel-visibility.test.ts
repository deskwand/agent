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

const VISIBLE_STATE: BrowserState = {
  ...HIDDEN_STATE,
  visible: true,
  url: "http://localhost:5173/",
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
  const getStatus = vi.fn(async () => HIDDEN_STATE);
  const pickerGetState = vi.fn(async () => ({ active: false }));
  const pickerStart = vi.fn(async () => ({ ok: true }) as const);
  const pickerStop = vi.fn(async () => undefined);

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    globalThis.ResizeObserver =
      ResizeObserverMock as unknown as typeof ResizeObserver;
    useAppStore.setState(useAppStore.getInitialState());
    setBounds.mockReset();
    getStatus.mockReset();
    getStatus.mockImplementation(async () => HIDDEN_STATE);
    pickerGetState.mockReset();
    pickerGetState.mockImplementation(async () => ({ active: false }));
    pickerStart.mockReset();
    pickerStart.mockImplementation(async () => ({ ok: true }) as const);
    pickerStop.mockReset();
    stateListener = undefined;

    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: {
        browser: {
          onStateChanged: (listener: (state: BrowserState) => void) => {
            stateListener = listener;
            return () => undefined;
          },
          getStatus,
          setBounds,
          setTheme: vi.fn(),
          picker: {
            getState: pickerGetState,
            start: pickerStart,
            stop: pickerStop,
            onStateChanged: vi.fn(() => () => undefined),
          },
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

  it("挂载时以主进程的真实状态为准（错过的状态变化能自愈）", async () => {
    getStatus.mockImplementation(async () => VISIBLE_STATE);
    pickerGetState.mockImplementation(async () => ({ active: true }));
    act(() => {
      root.render(React.createElement(BrowserPanel, { width: 420 }));
    });
    await flush();

    const toggle = container.querySelector<HTMLButtonElement>(
      "button[aria-pressed]",
    );
    // 按钮必须与主进程一致：不允许"按钮显示关、页面其实还开着"
    expect(toggle).not.toBeNull();
    expect(toggle?.getAttribute("aria-pressed")).toBe("true");
  });

  it("点按钮关闭后，按钮状态以主进程返回值为准", async () => {
    getStatus.mockImplementation(async () => VISIBLE_STATE);
    pickerGetState.mockImplementation(async () => ({ active: true }));
    act(() => {
      root.render(React.createElement(BrowserPanel, { width: 420 }));
    });
    await flush();

    // 关掉之后主进程说 inactive
    pickerGetState.mockImplementation(async () => ({ active: false }));
    const toggle = container.querySelector<HTMLButtonElement>(
      "button[aria-pressed]",
    );
    expect(toggle?.getAttribute("aria-pressed")).toBe("true");
    await act(async () => {
      toggle?.click();
    });
    await flush();

    expect(pickerStop).toHaveBeenCalledTimes(1);
    expect(
      container
        .querySelector("button[aria-pressed]")
        ?.getAttribute("aria-pressed"),
    ).toBe("false");
  });
  it("导航键是 28×28 的 iconSm，不再被缺省档内边距撑成 32 宽", async () => {
    // 2026-10-10 实测：不传 size + 手写 w-7 h-7 ⇒ cn 合并成 "px-4 py-2 w-7 h-7"
    // ⇒ 盒宽被内边距之和撑到 32（28 → 32，左右各多 2px）；走 iconSm 后 28×28、内边距 0 ✓。
    await act(async () => {
      root.render(React.createElement(BrowserPanel, { width: 420 }));
    });
    await flush();
    const keys = [
      ...container.querySelectorAll<HTMLButtonElement>("button"),
    ].filter((b) => b.className.split(/\s+/).includes("w-7"));
    expect(keys, "面板头部应有 7 颗 28×28 的导航键").toHaveLength(7);
    for (const key of keys) {
      const tokens = key.className.split(/\s+/);
      expect(tokens).toContain("h-7");
      for (const slab of ["h-9", "px-4", "py-2"]) {
        expect(tokens, `缺省档的 ${slab} 不该在场`).not.toContain(slab);
      }
    }
  });
});
