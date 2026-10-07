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
    // 居中不在这里锁：转写与回答共用同一个 span，几何契约统一由下面那条
    // 「定高一行、可横向滚、不折行」守。
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

  it("文字区：定宽、折行、居中、定高、纵向可滚", () => {
    renderOverlay();
    const region = captionRegion();
    const cls = region.className;
    const style = region.getAttribute("style") ?? "";

    expect(cls).toContain("max-w-[34rem]"); // 不限宽就是一行铺满整个窗口
    expect(cls).toContain("mx-auto");
    expect(cls).toContain("whitespace-pre-wrap");
    expect(cls).toContain("break-words"); // 长 URL 不横向溢出：横滚条是藏着的
    expect(cls).toContain("text-center");
    expect(cls).toContain("h-12"); // 定高：浮层是 justify-center 的列，高度一变球就跳
    expect(cls).toContain("leading-6"); // 且 24×2=48 整除，否则第三条线会被切出字头
    expect(cls).toContain("overflow-y-auto");

    // 定宽与不折行**不能共存**：nowrap 让超长文本从盒子左沿往右溢出，于是放得下也不居中
    // （真机实测 1560px 窗口里 975px 那行左 509 / 右 78，偏 431px）。
    // 守卫必须**同时看类名与内联样式**：只看类名时，`max-w-[34rem]` 配内联
    // `white-space: nowrap` 正好复现旧缺陷却会放行（实测过）。
    expect(/\bmax-w-(?!full\b|none\b)/.test(cls)).toBe(true); // 限宽在
    expect(/nowrap/.test(`${cls} ${style}`)).toBe(false); // 不折行不在
    // 类名按 token 判而不是正则：`max-w-[34rem]` 自身也含 "w-"，正则会误伤它。
    expect(
      cls
        .split(/\s+/)
        .filter((c) => c.startsWith("w-") && c !== "w-full" && c !== "w-auto"),
    ).toEqual([]);
  });

  it("换单元时滚动位置复位到顶", () => {
    // 靠 `key={text}` 重挂载而不是 ref + effect：换单元就是新节点，scrollTop 自然是 0。
    renderOverlay({ state: "speaking", spoken: "第一段" });
    const first = captionRegion();
    act(() => {
      first.scrollTop = 120;
    });
    act(() => {
      root.render(
        <VoiceModeOverlay
          view={{ ...VIEW, state: "speaking", spoken: "第二段" }}
          onClose={vi.fn()}
          onMinimize={vi.fn()}
        />,
      );
    });
    const second = captionRegion();
    expect(second).not.toBe(first); // 换了 key 就是新节点
    expect(second.scrollTop).toBe(0);
  });

  it("浮层不读主题：挂载时永远用发光画笔", () => {
    // 浮层是纯展示也不订阅 store —— 切主题不会让它重渲染，它自己硬编码 GLOW_BRUSH。
    // 所以这里只钉「渲染过、且每次都是 GLOW_BRUSH」；“小球要避开发光画笔”由宿主测试守。
    renderOverlay();
    expect(orb.brushes.length).toBeGreaterThan(0);
    for (const brush of orb.brushes) expect(brush).toBe(GLOW_BRUSH);
  });
});
