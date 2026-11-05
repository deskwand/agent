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
    expect(glyph?.getAttribute("stroke-width")).toBe("0");
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
  });
});
