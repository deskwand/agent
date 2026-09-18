// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { Titlebar } from "../../renderer/components/Titlebar";
import { useAppStore } from "../../renderer/store";

// 用真实挂载而不是 renderToStaticMarkup：zustand v5 的 useSyncExternalStore 在
// SSR 下用的是 getInitialState() 作为 server snapshot，setState 对 SSR 结果无效，
// 而本测试需要设置 activeSessionId / isArtifactPanelOpen 才能覆盖到对应分支。
let container: HTMLDivElement;
let root: Root;

async function mountTitlebar(): Promise<HTMLDivElement> {
  await act(async () => {
    root.render(React.createElement(Titlebar));
  });
  return container;
}

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState());
  window.electronAPI = {
    window: { onFullScreenChanged: () => () => {} },
  } as unknown as typeof window.electronAPI;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("标题栏操作按钮", () => {
  beforeEach(() => {
    // showSessionHeader = Boolean(activeSessionId) && !showSettings
    useAppStore.setState({ activeSessionId: "s1" });
  });

  it("整个标题栏不输出任何原生 title 属性", async () => {
    const el = await mountTitlebar();
    const titled = [...el.querySelectorAll("[title]")].map((n) => n.tagName);
    expect(titled).toEqual([]);
  });

  it("5 个操作按钮都有 aria-label", async () => {
    const el = await mountTitlebar();
    // store 初始值下的实际文案 key：
    //   sidebarCollapsed=false    → context.collapsePanel
    //   rightPanelMode=null       → titlebar.fileBrowser / titlebar.builtInBrowser
    //   rightPanelMode!=="review"        → reviewPanel.title
    //   isArtifactPanelOpen=false → artifactPanel.toggle
    for (const key of [
      "artifactPanel.toggle",
      "titlebar.fileBrowser",
      "titlebar.builtInBrowser",
      "reviewPanel.title",
      "context.collapsePanel",
    ]) {
      expect(el.querySelector(`[aria-label="${key}"]`), key).not.toBeNull();
    }
  });

  it("每个按钮都包在 .tt-anchor 里（没有漏包的）", async () => {
    const el = await mountTitlebar();
    const buttons = [...el.querySelectorAll("button")];
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) {
      expect(
        b.closest(".tt-anchor"),
        b.textContent || b.tagName,
      ).not.toBeNull();
    }
    // 气泡是 hover 时按需挂到 body 的，初始 DOM 里不该有
    expect(el.querySelector('[role="tooltip"]')).toBeNull();
  });

  it("未开启的按钮用 hover 叠层，开启的按钮用 on 叠层", async () => {
    const el = await mountTitlebar();
    const browser = el.querySelector<HTMLElement>(
      '[aria-label="titlebar.builtInBrowser"]',
    )!;
    expect(browser.className).toContain("hover:bg-overlay-hover");
    expect(browser.className).not.toContain("bg-overlay-on");
  });

  it("面板开启时该按钮切到 on 叠层", async () => {
    useAppStore.setState({ isArtifactPanelOpen: true });
    const el = await mountTitlebar();
    const artifact = el.querySelector<HTMLElement>(
      '[aria-label="artifactPanel.toggle"]',
    )!;
    expect(artifact.className).toContain("bg-overlay-on");
    expect(artifact.className).not.toContain("hover:bg-overlay-hover");
  });
});
