// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VoiceModeOverlay } from "../../renderer/components/VoiceModeOverlay";
import { cssFlat } from "./theme-css-helpers";

// 浮层一挂载就会开麦、起朗读。这里只测 UI 行为，把整条语音链路挡掉。
// 用可变对象而不是字面量：每个用例要摆不同的状态。
const mocks = vi.hoisted(() => ({
  view: {
    state: "listening",
    level: 0.2,
    transcript: "",
    answer: "",
    error: null as string | null,
  },
}));

vi.mock("../../renderer/hooks/useVoiceMode", () => ({
  useVoiceMode: () => mocks.view,
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  mocks.view.state = "listening";
  mocks.view.level = 0.2;
  mocks.view.transcript = "";
  mocks.view.answer = "";
  mocks.view.error = null;
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
});

function render(ui: React.ReactElement) {
  act(() => {
    root = createRoot(container);
    root.render(ui);
  });
}

function renderOverlay() {
  render(
    <VoiceModeOverlay
      sessionId="s1"
      onClose={vi.fn()}
      isCompacting={false}
      onSendQuestion={vi.fn()}
    />,
  );
}

function captionRegion(): HTMLElement {
  const el = container.querySelector<HTMLElement>(
    '[data-testid="voice-caption-text"]',
  );
  if (!el) throw new Error("文字区没渲染出来");
  return el;
}

describe("VoiceModeOverlay", () => {
  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(
      <VoiceModeOverlay
        sessionId="s1"
        onClose={onClose}
        isCompacting={false}
        onSendQuestion={vi.fn()}
      />,
    );
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes from the corner button", () => {
    const onClose = vi.fn();
    render(
      <VoiceModeOverlay
        sessionId="s1"
        onClose={onClose}
        isCompacting={false}
        onSendQuestion={vi.fn()}
      />,
    );
    const button = container.querySelector('[data-testid="voice-close"]');
    expect(button).not.toBeNull();
    act(() => {
      (button as HTMLButtonElement).click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("关闭按钮不在标题栏拖窗区里（否则点不动）", () => {
    // 按钮上边距 16px、高 36px，跨在标题栏 40px 高的拖窗区里。拖窗命中是矩形、
    // 不看 z-index，没有 no-drag 的话落在拖窗区那几像素会被当成拖窗吞掉 ——
    // jsdom 里点得到、真窗口里点不到，所以这条只能锁类名。
    renderOverlay();
    const button = container.querySelector('[data-testid="voice-close"]');
    expect(button).not.toBeNull();
    expect(button?.className).toContain("titlebar-no-drag");
  });

  it("titlebar-no-drag 这个工具类还在声明 no-drag", () => {
    // 上一条只锁住 JSX 那一半：类名被改名或删掉时它照样绿，按钮却重新变死。
    // 只查声明，不查任何提及 —— globals.css 注释多，子串匹配会假红。
    expect(cssFlat).toMatch(
      /\.titlebar-no-drag \{[^}]*;\s*app-region:\s*no-drag\s*;/,
    );
  });

  it("没有文字时文字区仍然占位", () => {
    renderOverlay();
    expect(captionRegion().textContent).toBe("");
  });

  it("识别中显示转写并居中", () => {
    mocks.view.state = "capturing";
    mocks.view.transcript = "杭州两天怎么玩";
    renderOverlay();
    const region = captionRegion();
    expect(region.textContent).toBe("杭州两天怎么玩");
    expect(region.className).toContain("text-center");
  });

  it("回答为空时回落到转写（兜底，当前链路到不了）", () => {
    // onQuestion 先清空 transcript，状态才变 thinking —— 所以 thinking 期字幕本来就是空的。
    // 这条只锁代码里的兜底分支，别当成生产行为。
    mocks.view.state = "speaking";
    mocks.view.transcript = "杭州两天怎么玩";
    renderOverlay();
    expect(captionRegion().textContent).toBe("杭州两天怎么玩");
  });

  it("回答非空时显示回答、去掉标记、左对齐", () => {
    mocks.view.state = "speaking";
    mocks.view.answer = "**第一天**\n- 断桥\n- 苏堤";
    renderOverlay();
    const region = captionRegion();
    expect(region.textContent).toBe("第一天\n- 断桥\n- 苏堤");
    expect(region.className).toContain("text-left");
  });

  // 评审指出：用 state="listening" 测不出行为变化（旧代码在那个状态也显示 answer）。
  // 真正变的是 thinking：旧代码在这里显示转写，新代码显示回答。
  it("回答一开始生成就上屏，不等状态变成 speaking", () => {
    mocks.view.state = "thinking";
    mocks.view.transcript = "杭州两天怎么玩";
    mocks.view.answer = "```\nconst a = 1;\n```";
    renderOverlay();
    const region = captionRegion();
    expect(region.textContent).toContain("const a = 1;");
    expect(region.className).toContain("text-left");
  });

  it("文字区定高且可滚动", () => {
    renderOverlay();
    const region = captionRegion();
    expect(region.className).toContain("overflow-y-auto");
    expect(region.parentElement?.className).toContain(
      "h-[clamp(6rem,22vh,12rem)]",
    );
  });
});
