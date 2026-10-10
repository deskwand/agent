// @vitest-environment jsdom
/**
 * @module tests/renderer/star-orb-bounded
 *
 * 有边界的球（`brush.ball`）的绘制序列。jsdom 没有 2d 上下文，所以这里给 canvas 造一个
 * 记录式的假上下文：**顺序就是规格** —— 底色必须在 clip 之前、hairline 必须在 restore
 * 之后、球体与 hairline 必须共用同一个 R。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GLOW_BALL_DARK,
  GLOW_BALL_LIGHT,
  GLOW_BRUSH,
  StarOrb,
  type OrbBrush,
} from "../../renderer/components/voice-mode/star-orb";

/** 记录式假上下文：只记我们关心的那些调用（drawImage 每帧 5200 次，剔掉）。 */
function recordingContext(log: string[]): CanvasRenderingContext2D {
  const gradient = {
    addColorStop: (stop: number, color: string) =>
      log.push(`stop:${stop}:${color}`),
  };
  const silent = new Set(["drawImage", "clearRect", "setTransform"]);
  return new Proxy(
    {},
    {
      get: (_target, prop: string) => {
        if (prop === "createRadialGradient" || prop === "createLinearGradient")
          return () => gradient;
        if (prop === "createPattern") return () => null;
        return (...args: unknown[]) =>
          log.push(silent.has(prop) ? prop : `${prop}(${args.join(",")})`);
      },
      set: (_target, prop: string, value: unknown) => {
        log.push(`${prop}=${String(value)}`);
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
}

let container: HTMLDivElement;
let root: Root;
let log: string[];
/** 组件只在 rAF 里画第一帧，所以把回调攒起来手动跑一次。 */
let frames: Map<number, (now: number) => void>;
let nextFrameId: number;
/** 球区的 CSS 尺寸 —— R = min(W,H) * 0.335 就是按它算的。 */
let box: { width: number; height: number };

beforeEach(() => {
  log = [];
  frames = new Map();
  nextFrameId = 1;
  box = { width: 620, height: 620 };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() =>
    recordingContext(
      log,
    )) as unknown as typeof HTMLCanvasElement.prototype.getContext);
  vi.spyOn(
    HTMLCanvasElement.prototype,
    "getBoundingClientRect",
  ).mockImplementation(
    () =>
      ({
        ...box,
        top: 0,
        left: 0,
        right: box.width,
        bottom: box.height,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect,
  );
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(((
    cb: (now: number) => void,
  ) => {
    const id = nextFrameId++;
    frames.set(id, cb);
    return id;
  }) as unknown as typeof window.requestAnimationFrame);
  // 假 rAF 也要吃取消：画笔一变 effect 重跑，上一支画笔排下的那一帧必须真被取消
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(((id: number) => {
    frames.delete(id);
  }) as unknown as typeof window.cancelAnimationFrame);
  motion(false);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

/** 让媒体查询按需回答「系统要求减少动态」。 */
function motion(reduce: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: reduce && query.includes("prefers-reduced-motion"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

function render(
  brush: OrbBrush,
  state: "listening" | "blocked" = "listening",
): void {
  act(() => root.render(<StarOrb brush={brush} state={state} level={0} />));
  drainFrames();
}

/** 跑掉攒下的 rAF 回调（`frame` 会再排一帧，不理会）。 */
function drainFrames(): void {
  const pending = [...frames.values()];
  frames.clear();
  act(() => {
    for (const cb of pending) cb(16);
  });
}

/** 取某个调用第 n 个参数（都当数字用）。 */
function arg(call: string, index: number): number {
  return Number(call.slice(call.indexOf("(") + 1, -1).split(",")[index]);
}

describe("有边界的球", () => {
  it("顺序即规格：落影 → 球体底色 → clip → … → hairline 在 restore 之后", () => {
    render(GLOW_BALL_LIGHT);

    // 落影是一条渐变：颜色在色标里，不在 fillStyle（fillStyle 拿到的是那个渐变对象）
    const shadowFill = log.indexOf("stop:0:rgba(28,36,84,0.18)");
    const bodyFill = log.indexOf("fillStyle=#050507");
    const saveAt = log.indexOf("save()");
    const clipAt = log.findIndex((c) => c.startsWith("clip("));
    const restoreAt = log.indexOf("restore()");
    const hairlineAt = log.findIndex(
      (c, i) => c === "stroke()" && i > restoreAt,
    );

    expect(shadowFill).toBeGreaterThanOrEqual(0);
    expect(bodyFill).toBeGreaterThan(shadowFill);
    expect(saveAt).toBeGreaterThan(bodyFill);
    expect(clipAt).toBeGreaterThan(saveAt);
    expect(restoreAt).toBeGreaterThan(clipAt);
    expect(hairlineAt).toBeGreaterThan(restoreAt);

    // 深色那支没有 shadow：同一个序列里不该出现落影那一笔
    log.length = 0;
    render(GLOW_BALL_DARK);
    expect(log.some((c) => c.includes("28,36,84"))).toBe(false);
    expect(log).toContain("fillStyle=#050507"); // 球体底色照画
  });

  it("所有弧半径只允许落在 R / 1.12R / 1.22R 三个值上（谁都不许自己算）", () => {
    // 球区不是正方形时最见真章：620×400 下 R 只能取 400 的 0.335
    box = { width: 620, height: 400 };
    render(GLOW_BALL_LIGHT, "blocked");
    const R = Math.min(box.width, box.height) * 0.335;
    const allow = [R, R * 1.12, R * 1.22];

    const arcs = log.filter((c) => c.startsWith("arc("));
    const radii = arcs.map((c) => arg(c, 2));

    // R 上恰好三条：球体底色、clip 的路径、球界 hairline。
    // 「恰好」而不是「至少」：hairline 飘到 0.8R 那种事必须红。
    expect(radii.filter((r) => Math.abs(r - R) < 1e-6).length).toBe(3);
    expect(radii.filter((r) => Math.abs(r - R * 1.12) < 1e-6).length).toBe(1);
    // 落影的圆心下移 0.04R
    const shadowArc = arcs.find((c) => Math.abs(arg(c, 2) - R * 1.22) < 1e-6);
    expect(shadowArc).toBeDefined();
    expect(arg(shadowArc!, 1)).toBeCloseTo(200 + R * 0.04, 6);

    // 剩下的只许是白热核心，且必须落在球内（level=0 时 ≈ 0.78R；见 orbCoreRadiusFactor）
    const rest = radii.filter(
      (r) => !allow.some((a) => Math.abs(r - a) < 1e-6),
    );
    expect(rest.length).toBe(1);
    expect(rest[0]).toBeLessThan(R * 0.8);
  });

  it("裁剪区间里不许出现球外的弧；blocked 弧必须在 restore 之后才画", () => {
    // 这一条是评审找出来的真 bug 的钉子：弧画在 clip 里 = 被裁成零像素，
    // blocked 态于是与 listening 像素一样（深色主题也跟着退化）。顺序就是可见性。
    box = { width: 620, height: 400 };
    render(GLOW_BALL_LIGHT, "blocked");
    const R = Math.min(box.width, box.height) * 0.335;

    const clipAt = log.findIndex((c) => c.startsWith("clip("));
    const restoreAt = log.indexOf("restore()", clipAt);
    expect(clipAt).toBeGreaterThanOrEqual(0);
    expect(restoreAt).toBeGreaterThan(clipAt);

    // 裁剪装着的这一段里，任何弧都不许越过球界（越过去的就是被裁掉的像素）
    const clipped = log.slice(clipAt, restoreAt);
    for (const arc of clipped.filter((c) => c.startsWith("arc("))) {
      expect(arg(arc, 2)).toBeLessThanOrEqual(R + 1e-6);
    }

    // blocked 弧的颜色落在 restore 之后，且后面真的跟了一笔 stroke()
    const ringAt = log.findIndex(
      (c) => c === "strokeStyle=rgba(58,78,178,0.85)",
    );
    expect(ringAt).toBeGreaterThan(restoreAt);
    expect(
      log.findIndex((c, i) => c === "stroke()" && i > ringAt),
    ).toBeGreaterThan(ringAt);
    // restore() 同时把合成模式退回 source-over —— 否则浅色那条弧会被 lighter 叠成纯白。
    // 假上下文不记状态，所以只能钉顺序：合成模式是绘制球内那几样时设的，在 restore 之前。
    expect(
      log
        .slice(0, restoreAt)
        .filter((c) => c === "globalCompositeOperation=lighter").length,
    ).toBeGreaterThan(0);
  });

  it("不给 ball 的画笔：调用序列里没有 clip（今天的满屏画法不动）", () => {
    render(GLOW_BRUSH);
    expect(log.some((c) => c.startsWith("clip("))).toBe(false);
    expect(log.some((c) => c.startsWith("fillStyle=#050507"))).toBe(false);
    expect(log.some((c) => c.startsWith("strokeStyle=rgba(15,20,45"))).toBe(
      false,
    );
  });

  it("reduced-motion 下换画笔：静态那一帧用新画笔重画", () => {
    motion(true);
    render(GLOW_BALL_LIGHT);
    log.length = 0;

    // 依赖是 [brush, still] —— 画笔换了就重跑 effect，resize() 会直接画一帧
    render(GLOW_BALL_DARK);
    expect(log).toContain("strokeStyle=rgba(190,212,255,0.10)");
  });
});
