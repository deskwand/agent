// @vitest-environment jsdom
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatInputBottomBar } from "../../renderer/components/ChatInputBottomBar";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string): string => key,
  }),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function renderBar(
  overrides: Partial<React.ComponentProps<typeof ChatInputBottomBar>> = {},
) {
  const props: React.ComponentProps<typeof ChatInputBottomBar> = {
    canStop: false,
    onStop: () => {},
    isSubmitting: false,
    hasInputContent: true,
    voice: { status: "idle", onToggle: () => {} },
    ...overrides,
  };
  act(() => {
    root.render(<ChatInputBottomBar {...props} />);
  });
  return props;
}

function primaryButton() {
  return container.querySelector<HTMLButtonElement>(
    'button[aria-label="chat.stop"], button[aria-label="chat.sendMessage"]',
  );
}

describe("ChatInputBottomBar 停止键", () => {
  it("停止态是一枚实心方块，不套实心圆底", () => {
    renderBar({ canStop: true });
    const button = primaryButton();

    expect(button).not.toBeNull();
    expect(button!.getAttribute("aria-label")).toBe("chat.stop");
    // 参考图的停止键没有底色：整张卡里最亮的元素不该是它。
    expect(button!.className).not.toContain("bg-primary");
    expect(button!.className).not.toContain("text-background");

    const glyph = button!.querySelector("svg");
    expect(glyph?.getAttribute("fill")).toBe("currentColor");
    // 手画的 rect 带自己的圆角：lucide Square 的 rx 盖不掉，12px 下看着是直角块。
    expect(glyph?.querySelector("rect")?.getAttribute("rx")).toBe("6");
    // 尺寸只能写在这一行：svg 自己写的 `w-3`（0,1,0）赢不过 Button base 的
    // `[&_svg]:size-4`（`.cls svg` = 0,1,1），会静默地顶回 16px ——
    // 那正是这个方块比旁边麦克风大一圈的真因。
    expect(button!.className).toContain("[&_svg]:size-3");
    // 两档同时存在时胜负取决于产物 CSS 的顺序，等于没修 —— base 那档必须已经被 cn
    // 合掉。这条比上面那条更能拦住「特异性陷阱又回来了」。
    expect(button!.className).not.toContain("[&_svg]:size-4");
  });

  it("停止态点击触发 onStop，且不是提交按钮", () => {
    const onStop = vi.fn();
    renderBar({ canStop: true, onStop });
    const button = primaryButton()!;

    expect(button.type).toBe("button");
    act(() => button.click());
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("发送态仍是描边返回箭头，空草稿时隐去", () => {
    renderBar({ canStop: false, hasInputContent: false });
    const button = primaryButton()!;

    expect(button.getAttribute("aria-label")).toBe("chat.sendMessage");
    expect(button.type).toBe("submit");
    expect(button.className).toContain("invisible");
    expect(button.querySelector("svg")?.getAttribute("fill")).not.toBe(
      "currentColor",
    );
    // 12px 只属于停止那颗方块：发送态的返回箭头仍沿用 base 的 16px。
    expect(button.className).not.toContain("[&_svg]:size-3");
  });
});
