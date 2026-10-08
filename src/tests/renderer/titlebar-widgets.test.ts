// @vitest-environment jsdom
//
// 用真实 store 挂载真实 Titlebar：两个播放图标的位置与「点得动」都是渲染级行为，
// 源码字符串断言抓不住。手法照 titlebar-left-cluster.test.ts。

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { Titlebar } from "../../renderer/components/Titlebar";
import { useAppStore } from "../../renderer/store";
import type { Session } from "../../renderer/types";

let container: HTMLDivElement;
let root: Root;

async function mount(): Promise<void> {
  await act(async () => {
    root.render(React.createElement(Titlebar));
  });
}

function voiceSession(id = "V"): Session {
  return {
    id,
    kind: "voice",
    title: id,
    status: "idle",
    mountedPaths: [],
    allowedTools: [],
    memoryEnabled: false,
    isProjectMode: false,
    createdAt: 1,
    updatedAt: 1,
  };
}

function openVoiceSession(id = "V"): void {
  useAppStore.getState().addSession(voiceSession(id));
  useAppStore.getState().openVoiceMode(id);
  useAppStore.getState().setVoiceMiniCaption("我在说第二段");
}

function widgets(): HTMLElement {
  return container.querySelector(
    '[data-testid="titlebar-widgets"]',
  ) as HTMLElement;
}

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true);
  // 这里不关心全屏：订阅逻辑由 titlebar-macos-fullscreen.test.ts 覆盖
  window.electronAPI = {} as unknown as typeof window.electronAPI;
  container = document.createElement("div");
  document.body.innerHTML = "";
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("顶栏播放控件", () => {
  it("语音会话在场时，图标在 no-drag 的右簇里，且在面板按钮左侧", async () => {
    openVoiceSession();
    await mount();
    expect(widgets().className).toContain("titlebar-no-drag");
    expect(
      widgets().querySelector('[data-testid="voice-mini-orb"]'),
    ).not.toBeNull();

    // 顺序：播放控件在前、四个面板按钮在后（图中如此）。
    // 只断言「它是第一个子元素」不够 —— 面板簇被删掉时那样也会绿，
    // 所以顺手断言同一容器里确实还有产物面板按钮。
    const cluster = widgets().parentElement as HTMLElement;
    const panelButton = cluster.querySelector(
      'button[aria-label="artifactPanel.toggle"]',
    );
    expect(panelButton).not.toBeNull();
    expect(
      widgets().compareDocumentPosition(panelButton as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("切到别的会话后图标仍在，点它能把浮层叫回来", async () => {
    openVoiceSession();
    useAppStore.getState().setActiveSession("O");
    // 宿主不在这个测试里，所以「切走就自动最小化」那段 effect 不会跑 ——
    // 那条语义由 voice-mode-host.test.tsx 守；这里手动置成「已收进小球」。
    useAppStore.getState().setVoiceModeMinimized(true);
    await mount();
    const orb = widgets().querySelector(
      '[data-testid="voice-mini-orb"]',
    ) as HTMLButtonElement;
    expect(orb).not.toBeNull();

    await act(async () => orb.click());
    expect(useAppStore.getState().voiceModeMinimized).toBe(false);
  });

  it("全屏浮层打开时图标不渲染（卡片就不会浮在沉浸式浮层之上）", async () => {
    openVoiceSession();
    // 人正停在这个语音会话上 → 浮层是打开的
    useAppStore.getState().setActiveSession("V");
    await mount();
    expect(
      container.querySelector('[data-testid="voice-mini-orb"]'),
    ).toBeNull();

    // 收进小球后立刻回来
    await act(async () => {
      useAppStore.getState().setVoiceModeMinimized(true);
    });
    expect(
      container.querySelector('[data-testid="voice-mini-orb"]'),
    ).not.toBeNull();
  });

  it("没有语音会话时簇里是空的", async () => {
    await mount();
    expect(widgets().children.length).toBe(0);
  });

  it("titlebar-no-drag 这个工具类还在声明 no-drag", () => {
    // 上一条只锁住 JSX 那一半：类名被改名或删掉时它照样绿，按钮却重新变死。
    // 只查声明，不查任何提及 —— globals.css 注释多，子串匹配会假红。
    const css = readFileSync(
      join(import.meta.dirname, "../../renderer/styles/globals.css"),
      "utf8",
    );
    expect(css).toMatch(
      /\.titlebar-no-drag \{[^}]*;\s*app-region:\s*no-drag\s*;/,
    );
  });
});
