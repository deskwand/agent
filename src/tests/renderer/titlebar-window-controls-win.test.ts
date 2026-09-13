// @vitest-environment jsdom

// Titlebar.tsx 的 isMac 是模块级 const，在 import 时求值。vi.hoisted 的回调先于
// 静态 import 执行，所以平台桩能生效；用两个文件而不是 vi.resetModules()，
// 是因为 resetModules 会把 react 一起重新求值，导致渲染树里有两个 React 实例。
vi.hoisted(() => {
  (globalThis as unknown as { window: Window }).window.electronAPI = {
    platform: "win32",
    window: { onFullScreenChanged: () => () => {} },
  } as unknown as typeof window.electronAPI;
});

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { Titlebar } from "../../renderer/components/Titlebar";
import { useAppStore } from "../../renderer/store";

const mountedRoots: ReturnType<typeof createRoot>[] = [];

/** 注意：不要在这里 unmount —— 容器一旦卸载就被清空，断言会全部退化成假通过。 */
async function mount(): Promise<HTMLDivElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(Titlebar));
  });
  mountedRoots.push(root);
  return container;
}

afterEach(async () => {
  for (const root of mountedRoots.splice(0)) {
    await act(async () => root.unmount());
  }
  document.body.innerHTML = "";
});

describe("Win/Linux 窗口控制按钮（非 darwin）", () => {
  beforeEach(() => {
    useAppStore.setState(useAppStore.getInitialState());
  });

  it("渲染三个控件且各有 aria-label", async () => {
    const el = await mount();
    for (const key of ["window.minimize", "window.maximize", "window.close"]) {
      expect(el.querySelector(`[aria-label="${key}"]`), key).not.toBeNull();
    }
  });

  it("三个控件也都包在 .tt-anchor 里", async () => {
    const el = await mount();
    for (const key of ["window.minimize", "window.maximize", "window.close"]) {
      const btn = el.querySelector(`[aria-label="${key}"]`)!;
      expect(btn.closest(".tt-anchor"), key).not.toBeNull();
    }
  });

  it("关闭键用 window-close-hover，不用 red-500", async () => {
    const el = await mount();
    const close = el.querySelector<HTMLElement>('[aria-label="window.close"]')!;
    expect(close.className).toContain("hover:bg-window-close-hover");
    expect(close.className).not.toContain("red-500");
  });

  it("不再用满高 h-full（包裹层是不定高的 inline-flex，百分比高度会退化成 auto）", async () => {
    const el = await mount();
    for (const key of ["window.minimize", "window.maximize", "window.close"]) {
      const btn = el.querySelector<HTMLElement>(`[aria-label="${key}"]`)!;
      expect(btn.className, key).not.toContain("h-full");
      expect(btn.className, key).toContain("h-8");
    }
  });
});
