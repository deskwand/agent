// @vitest-environment jsdom

vi.hoisted(() => {
  (globalThis as unknown as { window: Window }).window.electronAPI = {
    platform: "darwin",
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

describe("macOS 上不渲染窗口控制按钮（用系统红绿灯）", () => {
  beforeEach(() => {
    useAppStore.setState(useAppStore.getInitialState());
  });

  it("三个控件都不出现", async () => {
    const el = await mount();
    // 先证明渲染确实发生了（否则空容器上的 toBeNull 会恒真，测试假通过）
    expect(el.querySelectorAll("[aria-label]").length).toBeGreaterThan(0);
    for (const key of ["window.minimize", "window.maximize", "window.close"]) {
      expect(el.querySelector(`[aria-label="${key}"]`), key).toBeNull();
    }
  });
});
