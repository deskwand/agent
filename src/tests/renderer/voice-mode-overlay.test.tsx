// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VoiceModeOverlay } from "../../renderer/components/VoiceModeOverlay";
import { cssFlat } from "./theme-css-helpers";
import type { VoiceModeView } from "../../renderer/hooks/useVoiceMode";
import { GLOW_BRUSH } from "../../renderer/components/voice-mode/star-orb";

// 球是 canvas，jsdom 里画不了 —— 这里只关心全屏拿到的是哪支画笔。
const orb = vi.hoisted(() => ({ brushes: [] as unknown[] }));
vi.mock("../../renderer/components/voice-mode/star-orb", () => ({
  GLOW_BRUSH: { kind: "glow" },
  STARS_BRUSH_LIGHT: { kind: "stars", tag: "light" },
  STARS_BRUSH_DARK: { kind: "stars", tag: "dark" },
  StarOrb: ({ brush }: { brush: unknown }) => {
    orb.brushes.push(brush);
    return <canvas />;
  },
}));

// 浮层是纯展示：运行时在 VoiceModeHost 里。这里只摆状态、看它画什么。
const VIEW: VoiceModeView = {
  state: "listening",
  level: 0.2,
  transcript: "",
  answer: "",
  spoken: "",
  error: null,
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  orb.brushes.length = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
});

function renderOverlay(
  view: Partial<VoiceModeView> = {},
  handlers: { onClose?: () => void; onMinimize?: () => void } = {},
) {
  const onClose = handlers.onClose ?? vi.fn();
  const onMinimize = handlers.onMinimize ?? vi.fn();
  act(() => {
    root = createRoot(container);
    root.render(
      <VoiceModeOverlay
        view={{ ...VIEW, ...view }}
        onClose={onClose}
        onMinimize={onMinimize}
      />,
    );
  });
  return { onClose, onMinimize };
}

function captionRegion(): HTMLElement {
  const el = container.querySelector<HTMLElement>(
    '[data-testid="voice-caption-text"]',
  );
  if (!el) throw new Error("文字区没渲染出来");
  return el;
}

/** 文字本身在里层的 span 上（外层只管横滚）。 */
function captionSpan(): HTMLElement {
  const el = captionRegion().querySelector<HTMLElement>("span");
  if (!el) throw new Error("文字行没渲染出来");
  return el;
}

describe("VoiceModeOverlay", () => {
  it("closes on Escape", () => {
    const { onClose } = renderOverlay();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes from the corner button", () => {
    const { onClose } = renderOverlay();
    const button = container.querySelector('[data-testid="voice-close"]');
    expect(button).not.toBeNull();
    act(() => {
      (button as HTMLButtonElement).click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("minimizes instead of closing", () => {
    const { onClose, onMinimize } = renderOverlay();
    act(() => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="voice-minimize"]')!
        .click();
    });
    expect(onMinimize).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("顶部两个按钮都在标题栏拖窗区外", () => {
    // 拖窗命中不看 z-index：没有 no-drag 的话 jsdom 里点得到、真窗口里点不到，
    // 所以这条只锁类名。
    renderOverlay();
    const buttons = container.querySelectorAll(
      '[data-testid="voice-close"], [data-testid="voice-minimize"]',
    );
    expect(buttons.length).toBe(2);
    for (const button of buttons)
      expect(button.className).toContain("titlebar-no-drag");
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

  it("识别中显示转写", () => {
    renderOverlay({ state: "capturing", transcript: "杭州两天怎么玩" });
    expect(captionRegion().textContent).toBe("杭州两天怎么玩");
    expect(captionSpan().className).toContain("text-center");
  });

  it("回答为空时回落到转写（兜底，当前链路到不了）", () => {
    // onQuestion 先清空 transcript，状态才变 thinking —— 所以 thinking 期字幕本来就是空的。
    // 这条只锁代码里的兜底分支，别当成生产行为。
    renderOverlay({ state: "speaking", transcript: "杭州两天怎么玩" });
    expect(captionRegion().textContent).toBe("杭州两天怎么玩");
  });

  it("回答非空时显示回答、去掉标记", () => {
    renderOverlay({
      state: "speaking",
      answer: "**第一天**\n- 断桥\n- 苏堤",
    });
    expect(captionRegion().textContent).toBe("第一天\n- 断桥\n- 苏堤");
  });

  it("正在念的那个合成单元优先于整段回答", () => {
    renderOverlay({
      state: "speaking",
      answer: "第一句。第二句。",
      spoken: "第二句。",
    });
    expect(captionRegion().textContent).toBe("第二句。");
  });

  // 评审指出：用 state="listening" 测不出行为变化（旧代码在那个状态也显示 answer）。
  // 真正变的是 thinking：旧代码在这里显示转写，新代码显示回答。
  it("回答一开始生成就上屏，不等状态变成 speaking", () => {
    renderOverlay({
      state: "thinking",
      transcript: "杭州两天怎么玩",
      answer: "```\nconst a = 1;\n```",
    });
    expect(captionRegion().textContent).toContain("const a = 1;");
  });

  it("文字区定高一行、可横向滚、不折行", () => {
    renderOverlay();
    const region = captionRegion();
    expect(region.className).toContain("overflow-x-auto");
    expect(region.className).toContain("overflow-y-hidden");
    expect(region.parentElement?.className).toContain("h-10");
    expect(captionSpan().className).toContain("whitespace-nowrap");
  });

  it("纵向滚轮映射成横向滚动", () => {
    // 只能横滚的一行上，鼠标用户不该滚不动。
    renderOverlay({ state: "speaking", spoken: "一句很长的话" });
    const region = captionRegion();
    act(() => {
      region.dispatchEvent(
        new WheelEvent("wheel", { deltaY: 40, bubbles: true }),
      );
    });
    expect(region.scrollLeft).toBe(40);
  });

  it("斜向手势按主轴走，不把纵向分量丢掉", () => {
    // 触控板斜向手势两个轴同时非零。只判 `deltaX !== 0` 会把大半个纵向分量丢掉。
    renderOverlay({ state: "speaking", spoken: "一段很长的话" });
    const region = captionRegion();
    act(() => {
      region.dispatchEvent(
        new WheelEvent("wheel", { deltaX: 30, deltaY: 120, bubbles: true }),
      );
    });
    expect(region.scrollLeft).toBe(120);
  });

  it("横向为主的触控板手势交给浏览器", () => {
    renderOverlay({ state: "speaking", spoken: "一段很长的话" });
    const region = captionRegion();
    act(() => {
      region.dispatchEvent(
        new WheelEvent("wheel", { deltaX: 120, deltaY: 30, bubbles: true }),
      );
    });
    expect(region.scrollLeft).toBe(0);
  });

  it("换句时横向位置复位到句首", () => {
    renderOverlay({ state: "speaking", spoken: "第一句" });
    const region = captionRegion();
    act(() => {
      region.scrollLeft = 120;
    });
    renderOverlay({ state: "speaking", spoken: "第二句" });
    expect(captionRegion().scrollLeft).toBe(0);
  });

  it("浮层不读主题：挂载时永远用发光画笔", () => {
    // 浮层是纯展示也不订阅 store —— 切主题不会让它重渲染，它自己硬编码 GLOW_BRUSH。
    // 所以这里只钉「渲染过、且每次都是 GLOW_BRUSH」；“小球要避开发光画笔”由宿主测试守。
    renderOverlay();
    expect(orb.brushes.length).toBeGreaterThan(0);
    for (const brush of orb.brushes) expect(brush).toBe(GLOW_BRUSH);
  });
});
