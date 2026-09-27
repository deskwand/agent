// @vitest-environment jsdom
//
// macOS 全屏时没有红绿灯，左簇不该再留 80px 空位（否则窗口左上角一片空白）。
// isMac 是模块加载时求值的，所以必须在 import 之前把 platform 塞进去
// （同 titlebar-window-controls-darwin.test.ts 的做法）。

vi.hoisted(() => {
  const store = globalThis as unknown as {
    __fsCallbacks: ((value: boolean) => void)[];
  };
  store.__fsCallbacks = [];
  (globalThis as unknown as { window: Window }).window.electronAPI = {
    platform: "darwin",
    window: {
      onFullScreenChanged: (callback: (value: boolean) => void) => {
        store.__fsCallbacks.push(callback);
        return () => {};
      },
    },
  } as unknown as typeof window.electronAPI;
});

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { Titlebar } from "../../renderer/components/Titlebar";
import { useAppStore } from "../../renderer/store";

let container: HTMLDivElement;
let root: Root;

/** 给红绿灯让位的那 80px 留白 */
function spacer(): Element | null {
  return container.querySelector("div.w-20");
}

function toggleButton(): HTMLButtonElement | null {
  return container.querySelector('button[aria-label="context.collapsePanel"]');
}

async function mount(): Promise<void> {
  await act(async () => {
    root.render(React.createElement(Titlebar));
  });
}

beforeEach(() => {
  // 回调数组是模块级的：不清空的话会拿到上一个用例里已卸载实例的回调，
  // 调它不会影响当前 DOM（这个测试第一版就踩了这个坑）
  (globalThis as unknown as { __fsCallbacks: unknown[] }).__fsCallbacks.length =
    0;
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState({ activeView: "chat", sidebarCollapsed: false });
  container = document.createElement("div");
  document.body.innerHTML = "";
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("macOS 左留白跟随全屏状态", () => {
  it("窗口态：留 80px 给红绿灯", async () => {
    await mount();
    expect(spacer()).not.toBeNull();
  });

  it("全屏态：留白消失，但左簇按钮还在；退出全屏又回来", async () => {
    await mount();
    const callbacks = (
      globalThis as unknown as {
        __fsCallbacks: ((value: boolean) => void)[];
      }
    ).__fsCallbacks;
    const notify = callbacks[callbacks.length - 1];
    expect(
      callbacks.length,
      "Titlebar 必须订阅 onFullScreenChanged",
    ).toBeGreaterThan(0);
    expect(notify).toBeTruthy();

    await act(async () => notify?.(true));
    expect(spacer()).toBeNull();
    expect(
      toggleButton(),
      "全屏时只是去掉留白，按钮不该跟着消失",
    ).not.toBeNull();

    await act(async () => notify?.(false));
    expect(spacer()).not.toBeNull();
  });
});
