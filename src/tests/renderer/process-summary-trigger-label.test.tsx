// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProcessSummaryBlock } from "../../renderer/components/message/ProcessSummaryBlock";
import { useAppStore } from "../../renderer/store";
import type { Message } from "../../renderer/types";
import { buildProcessSummaryDisplayBlock } from "../../renderer/utils/tool-display-blocks";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options?.count === undefined ? key : `${key}:${options.count}`,
    i18n: { language: "en" },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const SESSION_ID = "trigger-label-session";
const NO_MESSAGES: Message[] = [];

const BLOCK = buildProcessSummaryDisplayBlock([
  { type: "tool_use", id: "b1", name: "bash", input: { command: "rg foo" } },
  { type: "tool_use", id: "b2", name: "bash", input: { command: "ls" } },
]);

describe("process summary trigger label", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    useAppStore.setState({
      sessionStates: { [SESSION_ID]: { messages: NO_MESSAGES } },
    } as never);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(triggerLabel?: { text: string; mono: boolean }): void {
    act(() => {
      root.render(
        createElement(ProcessSummaryBlock, { block: BLOCK, triggerLabel }),
      );
    });
  }

  it("不传 triggerLabel 时仍是聚合片段（转录侧零变化）", () => {
    render();
    expect(container.textContent).toContain("tool.grouped.executedCommands");
    expect(
      container.querySelector('[data-testid="summary-trigger-label"]'),
    ).toBeNull();
  });

  it("传了 triggerLabel 就替代聚合片段，只有一个文案节点", () => {
    render({ text: "查看目录内容", mono: false });
    expect(container.textContent).toContain("查看目录内容");
    expect(container.textContent).not.toContain(
      "tool.grouped.executedCommands",
    );
    expect(
      container.querySelectorAll('[data-testid="summary-trigger-label"]'),
    ).toHaveLength(1);
  });

  it("文案是唯一可收缩项：单行省略，且不参与固定宽度", () => {
    render({ text: "curl -s https://x.dev", mono: true });
    const node = container.querySelector<HTMLElement>(
      '[data-testid="summary-trigger-label"]',
    );
    expect(node?.className).toContain("font-mono");
    expect(node?.className).toContain("min-w-0");
    expect(node?.className).toContain("overflow-hidden");
    expect(node?.className).toContain("text-ellipsis");
    expect(node?.className).toContain("whitespace-nowrap");
    expect(node?.className).not.toContain("flex-shrink-0");
    expect(node?.className).not.toContain("flex-none");
  });
  describe("label spring", () => {
    const originalOffsetWidthDescriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "offsetWidth",
    );
    const originalAnimateDescriptor = Object.getOwnPropertyDescriptor(
      Element.prototype,
      "animate",
    );
    const originalMatchMediaDescriptor = Object.getOwnPropertyDescriptor(
      window,
      "matchMedia",
    );

    type AnimationCall = {
      keyframes: Keyframe[];
      options: KeyframeAnimationOptions;
      animation: {
        playState: AnimationPlayState;
        cancel: ReturnType<typeof vi.fn>;
      };
    };

    let calls: AnimationCall[] = [];
    /** 模拟"动画中途的可见宽度"：**只覆盖下一次读数**（读一次就清空）——
     *  真实世界里动画一 cancel 就回到自然宽，所以第二次读到的必须是自然宽。 */
    let liveWidth: number | null = null;

    beforeEach(() => {
      calls = [];
      liveWidth = null;
      // 宽度按文案长度推算：14px/字（只用来产生稳定差值，不模拟真实字体）。
      // 用 offsetWidth 而不是 getBoundingClientRect —— 实现量的就是它（不受
      // transform 影响），stub 必须挡住同一层。
      Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
        configurable: true,
        get(this: HTMLElement) {
          if (liveWidth !== null) {
            const width = liveWidth;
            liveWidth = null;
            return width;
          }
          return (this.textContent ?? "").length * 14;
        },
      });
      Object.defineProperty(Element.prototype, "animate", {
        configurable: true,
        value: function (
          keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
          options?: number | KeyframeAnimationOptions,
        ) {
          const animation = {
            playState: "running" as AnimationPlayState,
            onfinish: null,
            cancel: vi.fn(() => {
              animation.playState = "idle";
            }),
          };
          calls.push({
            keyframes: Array.isArray(keyframes) ? keyframes : [],
            options:
              typeof options === "number"
                ? { duration: options }
                : (options ?? {}),
            animation,
          });
          return animation as unknown as Animation;
        },
      });
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        value: vi.fn(() => ({
          matches: false,
          media: "(prefers-reduced-motion: reduce)",
          onchange: null,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          addListener: vi.fn(),
          removeListener: vi.fn(),
          dispatchEvent: vi.fn(),
        })),
      });
    });

    afterEach(() => {
      if (originalOffsetWidthDescriptor) {
        Object.defineProperty(
          HTMLElement.prototype,
          "offsetWidth",
          originalOffsetWidthDescriptor,
        );
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, "offsetWidth");
      }
      if (originalAnimateDescriptor) {
        Object.defineProperty(
          Element.prototype,
          "animate",
          originalAnimateDescriptor,
        );
      } else {
        Reflect.deleteProperty(Element.prototype, "animate");
      }
      if (originalMatchMediaDescriptor) {
        Object.defineProperty(
          window,
          "matchMedia",
          originalMatchMediaDescriptor,
        );
      } else {
        Reflect.deleteProperty(window, "matchMedia");
      }
    });

    function labelNode(): HTMLElement {
      const node = container.querySelector<HTMLElement>(
        '[data-testid="summary-trigger-label"]',
      );
      if (!node) throw new Error("trigger label missing");
      return node;
    }

    function rerenderLabel(text: string): void {
      act(() => {
        root.render(
          createElement(ProcessSummaryBlock, {
            block: BLOCK,
            triggerLabel: { text, mono: false },
          }),
        );
      });
    }

    it("首次出现不弹（首帧没有起点宽度）", () => {
      render({ text: "1234567890", mono: false });
      expect(calls).toHaveLength(0);
    });

    it("文案变短：宽度从旧值弹到新值，缓动带过冲", () => {
      render({ text: "1234567890", mono: false }); // 10 字 = 140px
      calls = [];
      rerenderLabel("12345"); // 5 字 = 70px
      // 只断言第一条（宽度那条）；Task 2 会再加一条拉伸动画
      expect(calls[0]?.keyframes).toEqual([
        { width: "140px" },
        { width: "70px" },
      ]);
      expect(calls[0]?.options).toEqual({
        duration: 320,
        easing: "cubic-bezier(.34, 1.56, .64, 1)",
      });
    });

    it("文案变长：方向相反，参数同构", () => {
      render({ text: "12345", mono: false });
      calls = [];
      rerenderLabel("1234567890");
      expect(calls[0]?.keyframes).toEqual([
        { width: "70px" },
        { width: "140px" },
      ]);
      expect(calls[0]?.options).toEqual({
        duration: 320,
        easing: "cubic-bezier(.34, 1.56, .64, 1)",
      });
    });

    it("同宽切换不弹（换字但宽度没变）", () => {
      render({ text: "12345", mono: false });
      calls = [];
      rerenderLabel("54321");
      expect(calls).toHaveLength(0);
    });

    it("prefers-reduced-motion 时完全不弹", () => {
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        value: vi.fn(() => ({ matches: true })),
      });
      render({ text: "1234567890", mono: false });
      calls = [];
      rerenderLabel("12345");
      expect(calls).toHaveLength(0);
    });

    it("没有 WAAPI 时不崩、也不弹", () => {
      Reflect.deleteProperty(Element.prototype, "animate");
      render({ text: "1234567890", mono: false });
      expect(() => rerenderLabel("12345")).not.toThrow();
      expect(calls).toHaveLength(0);
    });

    it("同一次切换再叠一条文字拉伸（不同曲线、只动 transform）", () => {
      render({ text: "1234567890", mono: false });
      calls = [];
      rerenderLabel("12345");

      expect(calls).toHaveLength(2);
      expect(calls[1]?.keyframes).toEqual([
        { transform: "scaleX(.965) scaleY(1.03)" },
        { transform: "scaleX(1.015) scaleY(.99)", offset: 0.55 },
        { transform: "scaleX(1) scaleY(1)" },
      ]);
      expect(calls[1]?.options).toEqual({
        duration: 300,
        easing: "cubic-bezier(.34, 1.4, .64, 1)",
      });
    });

    it("拉伸从文字左缘长出来（transform-origin 钉在左侧）", () => {
      render({ text: "1234567890", mono: false });
      expect(labelNode().className).toContain("origin-left");
    });

    it("卸载时取消动画", () => {
      render({ text: "1234567890", mono: false });
      rerenderLabel("12345");
      expect(calls).toHaveLength(2); // 宽度 + 拉伸
      act(() => root.unmount());
      expect(calls[0]?.animation.cancel).toHaveBeenCalled();
      expect(calls[1]?.animation.cancel).toHaveBeenCalled();
    });

    it("连续快切：第三条从当前可见宽度接上，并取消上一条", () => {
      render({ text: "1234567890", mono: false });
      rerenderLabel("12345");
      const first = calls[0];
      // 动画中途：用户眼前看到的是 100px，不是上一句的终点 70px
      liveWidth = 100;
      rerenderLabel("123");

      // calls[2] = 第三次切换的宽度动画：起点必须是 100px
      expect(calls[2]?.keyframes).toEqual([
        { width: "100px" },
        { width: "42px" },
      ]);
      expect(first?.animation.cancel).toHaveBeenCalled();
      // 拉伸还在跑就让它跑完，不重开（重开会把 1.015 硬拽回 .965）
      expect(
        calls.filter((call) =>
          call.keyframes.some((keyframe) => keyframe.transform !== undefined),
        ),
      ).toHaveLength(1);
    });

    it("同一文案重复渲染不弹（坞 500ms 心跳也不该触发）", () => {
      render({ text: "1234567890", mono: false });
      rerenderLabel("12345");
      calls = [];
      rerenderLabel("12345");
      expect(calls).toHaveLength(0);
    });

    it("标签重新挂载不从上一段的宽度弹", () => {
      render({ text: "1234567890", mono: false });
      // 坞头回落成动作态：triggerLabel 消失，标签 span 卸载
      act(() => {
        root.render(createElement(ProcessSummaryBlock, { block: BLOCK }));
      });
      calls = [];
      // 新步骤出现：这是全新元素，没有可信起点
      render({ text: "123", mono: false });
      expect(calls).toHaveLength(0);
    });
  });
});
