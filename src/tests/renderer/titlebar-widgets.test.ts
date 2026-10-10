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

  it("语音图标那颗按钮走 iconSm：28×28、缺省档内边距不在场（“图标没居中”的根因）", async () => {
    // ⚠️ 2026-10-10 用户报障「右上角语音模式图标没有居中」：当时那颗按钮就地写 `w-7 h-7`，
    //   而 `cn` 只删同族冲突 ⇒ 缺省档的 `px-4 py-2` 原样留下 ⇒ 内边距(32) 比 `w-7`(28) 还宽：
    //   盒宽被撑成 **32×28**（线上实测 ✓），`grid place-items-center` 的内容盒只剩 **0×12** ⇒
    //   单行在 `align-content: normal` 下落回顶部 ⇒ 24px 的星球球心比按钮中心低 **6px** ✗✗。
    //   改走 `iconSm` 后整档替换 ⇒ 内边距不进场 ⇒ 28×28、球心偏移 0（真 Chromium 实测 ✓）。
    openVoiceSession();
    await mount();
    const orb = widgets().querySelector(
      '[data-testid="voice-mini-orb"]',
    ) as HTMLElement;
    const button = orb.closest("button") as HTMLButtonElement;
    const tokens = button.className.split(/\s+/);
    for (const needed of ["h-7", "w-7", "grid", "place-items-center"]) {
      expect(tokens, `按钮应该是 28×28 的网格居中布局：缺 ${needed}`).toContain(
        needed,
      );
    }
    for (const slab of ["h-9", "px-4", "py-2", "h-auto"]) {
      expect(
        tokens,
        `缺省档的 ${slab} 一旦在场，盒宽就被撑成 32、球会下偏 6px`,
      ).not.toContain(slab);
    }
    // 球自己是占满 24px 槽位的画布（`h-full w-full`），槽位尺寸就是球界半径的输入 ✓。
    expect(orb.className.split(/\s+/)).toEqual(
      expect.arrayContaining(["block", "h-6", "w-6"]),
    );
  });

  it("语音卡片里的两颗控件也走 iconSm：28×28，不再被缺省档撑成 32", async () => {
    // 2026-10-10 实测：类名来自常量 CARD_CONTROL_CLASS ⇒ 合并串含 "px-4 py-2 h-7 w-7"
    // ⇒ 盒 32×28（内边距之和 32 > w-7 的 28）；源扫描守卫看不见这一形状 ⇒ 靠这条 DOM 断言守 ✓。
    openVoiceSession();
    await mount();
    for (const testid of ["voice-mini-mute", "voice-mini-end"]) {
      const key = widgets().querySelector(
        `[data-testid="${testid}"]`,
      ) as HTMLButtonElement;
      const tokens = key.className.split(/\s+/);
      expect(tokens, testid).toContain("h-7");
      for (const slab of ["h-9", "px-4", "py-2"]) {
        expect(tokens, `${testid} 不该带缺省档的 ${slab}`).not.toContain(slab);
      }
    }
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
