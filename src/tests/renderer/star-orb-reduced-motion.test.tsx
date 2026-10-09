// @vitest-environment jsdom
/**
 * @module tests/renderer/star-orb-reduced-motion
 *
 * reduced-motion 下 `StarOrb` 只画一帧、不起循环。
 *
 * 这条**必须有测试**：2026-10-09 的评审发现 `frame` 的尾部还有第二次无条件自调度
 * （只守住 `resize()` 之后的启动那一处的话，球画的这一帧会自己再排一帧，循环照跑），
 * 而那时承诺只写在注释里 —— 单测看不见，因为它只验了 `prefersReducedMotion()` 本身。
 * 常规做法也测不到：jsdom 没有 2d 上下文，组件会从一开始就 `return`。
 *
 * 这里的办法是给 canvas 造一个最小的假 2d 上下文，并把 `requestAnimationFrame`
 * 换成计数器 —— 「循环有没有起」于是变成一个数得出来的数。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  StarOrb,
  STARS_BRUSH_ICON_LIGHT,
} from "../../renderer/components/voice-mode/star-orb";

/**
 * 任何方法都当空调用；只有少数几个必须返回对象（渐变 / 图案 / 像素数据）。
 * 属性赋值（`fillStyle = …`）走 set 陷阱，一律吞下。
 */
function fakeContext(): CanvasRenderingContext2D {
  const noop = () => undefined;
  const gradient = { addColorStop: noop };
  return new Proxy(
    {},
    {
      get: (_target, prop: string) => {
        if (prop === "createRadialGradient" || prop === "createLinearGradient")
          return () => gradient;
        if (prop === "createPattern") return () => null;
        if (prop === "getImageData")
          return () => ({ data: new Uint8ClampedArray(4) });
        return noop;
      },
      set: () => true,
    },
  ) as unknown as CanvasRenderingContext2D;
}

/** 让媒体查询按需回答「系统要求减少动态」。 */
function reducedMotion(matches: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: matches && query.includes("prefers-reduced-motion"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

let container: HTMLDivElement;
let root: Root;
let framesScheduled = 0;
let framesCancelled = 0;

beforeEach(() => {
  framesScheduled = 0;
  framesCancelled = 0;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => {
    framesScheduled += 1;
    return 1;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {
    framesCancelled += 1;
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() =>
    fakeContext()) as unknown as typeof HTMLCanvasElement.prototype.getContext);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function mount(): void {
  act(() =>
    root.render(
      <StarOrb brush={STARS_BRUSH_ICON_LIGHT} state="listening" level={0} />,
    ),
  );
}

describe("StarOrb 与「减少动态」", () => {
  it("系统要求减少动态时：一帧都不排（球是静止的一幅画）", () => {
    reducedMotion(true);
    mount();
    expect(framesScheduled).toBe(0);
  });

  it("没这个偏好时：照常起循环（对照组，证明上面的 0 不是因为压根没画）", () => {
    reducedMotion(false);
    mount();
    expect(framesScheduled).toBe(1);
  });

  it("系统设置在会话中途改动：循环立刻停，不用等重挂载", () => {
    // CSS 的媒体查询是瞬间重算的，canvas 得自己订阅 —— 否则两边行为不一致：
    // 用户刚在系统设置里打开「减少动态」，顶栏那颗球却还在转。
    const listeners: Array<() => void> = [];
    let reduce = false;
    window.matchMedia = ((query: string) => ({
      get matches() {
        return reduce && query.includes("prefers-reduced-motion");
      },
      media: query,
      addEventListener: (_: string, fn: () => void) => listeners.push(fn),
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;

    mount();
    expect(framesScheduled).toBe(1);

    reduce = true;
    act(() => {
      for (const notify of listeners) notify();
    });

    expect(framesCancelled).toBeGreaterThanOrEqual(1);
    // 没有新帧排进来：resize() 那一帧只画不排
    expect(framesScheduled).toBe(1);
  });
});
