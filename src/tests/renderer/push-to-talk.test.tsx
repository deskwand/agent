// @vitest-environment jsdom
/**
 * 按住说话。
 *
 * 为什么之前没有：Task 9 的 agent 撞了轮次上限，只写了实现。而这段代码有 5 处
 * 真逻辑 —— 键位映射、holding 状态机、`handlersRef`、失焦兜底、`event.repeat` 防抖 ——
 * 全是「出 bug 就是按了没反应或停不下来」那一类，且没有任何静态检查能发现。
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { usePushToTalk } from "../../renderer/hooks/usePushToTalk";

let container: HTMLDivElement;
let root: Root;
let onStart: Mock<() => void>;
let onStop: Mock<() => void>;

/** 渲染一个只挂载 hook 的探针；shortcut / enabled 可改以便测重渲染。 */
function Probe({ shortcut = "AltRight", enabled = true }) {
  usePushToTalk(shortcut, { onStart, onStop }, enabled);
  return null;
}

async function mount(props: Partial<React.ComponentProps<typeof Probe>> = {}) {
  await act(async () => {
    root.render(React.createElement(Probe, props));
  });
}

/** 派发一个键盘事件到 window（hook 就监听在那里）。 */
async function key(
  type: "keydown" | "keyup",
  init: KeyboardEventInit & { repeat?: boolean } = {},
) {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent(type, { bubbles: true, ...init }));
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  onStart = vi.fn();
  onStop = vi.fn();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("usePushToTalk", () => {
  it("按住右 Option 开始，松开结束", async () => {
    await mount();

    await key("keydown", { code: "AltRight", altKey: true });
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStop).not.toHaveBeenCalled();

    await key("keyup", { code: "AltRight", altKey: false });
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("别的键不触发", async () => {
    await mount();

    await key("keydown", { code: "AltLeft", altKey: true });
    await key("keydown", { code: "Space", altKey: false });

    expect(onStart).not.toHaveBeenCalled();
  });

  it("没按下就开始的 keyup 不会结束（否则一次误触会把别处的录音停掉）", async () => {
    await mount();

    await key("keyup", { code: "AltRight" });

    expect(onStop).not.toHaveBeenCalled();
  });

  it("长按的自动重复不再重复触发开始", async () => {
    await mount();

    await key("keydown", { code: "AltRight" });
    await key("keydown", { code: "AltRight", repeat: true });
    await key("keydown", { code: "AltRight", repeat: true });

    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("失焦时当作松开（否则切走窗口后状态会卡住）", async () => {
    await mount();

    await key("keydown", { code: "AltRight" });
    await act(async () => {
      window.dispatchEvent(new Event("blur"));
    });

    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("快捷键配成 disabled 时完全不监听", async () => {
    await mount({ shortcut: "disabled" });

    await key("keydown", { code: "AltRight" });
    await key("keyup", { code: "AltRight" });

    expect(onStart).not.toHaveBeenCalled();
    expect(onStop).not.toHaveBeenCalled();
  });

  it("未启用时完全不监听", async () => {
    await mount({ enabled: false });

    await key("keydown", { code: "AltRight" });

    expect(onStart).not.toHaveBeenCalled();
  });

  it("⌥ + 空格需要 alt 修饰键", async () => {
    await mount({ shortcut: "AltSpace" });

    await key("keydown", { code: "Space", altKey: false });
    expect(onStart).not.toHaveBeenCalled();

    await key("keydown", { code: "Space", altKey: true });
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("重渲染后松手仍然能停下 —— 回调用 ref 而不是闭包", async () => {
    // 回归测试：宿主传的是行内对象，每次渲染都是新引用。如果把它放进 effect 的 deps，
    // 每次渲染都会重订阅，而重订阅会把 holding 清回 false —— 表现就是
    // 「按下去就停不下来」。这里用旧的 onStop 被替换来验它取的是最新的那个。
    await mount();

    await key("keydown", { code: "AltRight" });
    expect(onStart).toHaveBeenCalledTimes(1);

    // 换一套回调再渲染（宿主每渲染一次就会这样做）
    const freshStop = vi.fn();
    onStop = freshStop;
    await act(async () => {
      root.render(React.createElement(Probe, {}));
    });

    await key("keyup", { code: "AltRight" });

    expect(freshStop).toHaveBeenCalledTimes(1);
  });
});
