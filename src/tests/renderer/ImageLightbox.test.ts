import { describe, it, expect } from "vitest";
import {
  clampZoom,
  stepZoom,
  zoomPercent,
  toContentLocalAnchor,
} from "../../renderer/components/ImageLightbox";

describe("ImageLightbox utilities", () => {
  // ── clampZoom ──
  it("clampZoom returns value within bounds", () => {
    expect(clampZoom(0.5)).toBe(0.5);
    expect(clampZoom(5.0)).toBe(5.0);
    expect(clampZoom(1.0)).toBe(1.0);
  });

  it("clampZoom floors values below min", () => {
    expect(clampZoom(0)).toBe(0.5);
    expect(clampZoom(-1)).toBe(0.5);
    expect(clampZoom(0.25)).toBe(0.5);
  });

  it("clampZoom caps values above max", () => {
    expect(clampZoom(6)).toBe(5.0);
    expect(clampZoom(5.5)).toBe(5.0);
    expect(clampZoom(10)).toBe(5.0);
  });

  // ── stepZoom ──
  it("stepZoom increases by step", () => {
    expect(stepZoom(1, 0.25)).toBe(1.25);
    expect(stepZoom(2, 0.25)).toBe(2.25);
  });

  it("stepZoom decreases by step", () => {
    expect(stepZoom(2, -0.25)).toBe(1.75);
    expect(stepZoom(1, -0.5)).toBe(0.5);
  });

  it("stepZoom stays within bounds on increment", () => {
    expect(stepZoom(5.0, 0.25)).toBe(5.0);
    expect(stepZoom(4.75, 0.5)).toBe(5.0);
  });

  it("stepZoom stays within bounds on decrement", () => {
    expect(stepZoom(0.5, -0.25)).toBe(0.5);
    expect(stepZoom(0.75, -0.5)).toBe(0.5);
  });

  // ── zoomPercent ──
  it("zoomPercent rounds correctly", () => {
    expect(zoomPercent(1)).toBe(100);
    expect(zoomPercent(0.5)).toBe(50);
    expect(zoomPercent(2.0)).toBe(200);
    expect(zoomPercent(0.333)).toBe(33);
    expect(zoomPercent(5.0)).toBe(500);
  });
});

// 工具条锚点必须在**弹层局部坐标**里量（预览页面右上角的按钮都不见了，2026-10-10）。
// 数字全部取自 Chromium 里的实测：视口 1568×819、图片 1024×700。
describe("toContentLocalAnchor", () => {
  const CONTENT_LAYOUT_WIDTH = 1568;
  // 图片未变换时的布局盒（= 工具条该锚到的位置）
  const imageBox = { left: 304.28125, top: 81.90625, right: 1262.71875 };
  // 弹层打开动画进行中的视觉几何：整体 translate(-50%, -48%) ∘ scale(0.95)
  const animatedContent = {
    left: -744.3248125,
    top: -372.6449375,
    width: 1489.6,
  };
  const animatedBox = {
    right: 455.258, // = 1262.71875 × 0.95 + (-744.3248125)
    top: -294.834,
  };

  it("动画进行中也要还原成弹层局部坐标（否则变换会被算两次）", () => {
    const anchor = toContentLocalAnchor(
      animatedBox,
      animatedContent,
      CONTENT_LAYOUT_WIDTH,
    );
    expect(anchor.left).toBeCloseTo(imageBox.right, 3);
    expect(anchor.top).toBeCloseTo(imageBox.top, 3);
    // 直接写视口坐标就是这次的 bug：工具条落到 y ≈ -344.8，视口外。
    expect(anchor.top).toBeGreaterThan(0);
  });

  it("没有变换时与视口坐标一致", () => {
    const anchor = toContentLocalAnchor(
      { right: imageBox.right, top: imageBox.top },
      { left: 0, top: 0, width: CONTENT_LAYOUT_WIDTH },
      CONTENT_LAYOUT_WIDTH,
    );
    expect(anchor).toEqual({ left: imageBox.right, top: imageBox.top });
  });

  it("抵掉动画的平移（只有位移、不缩放）", () => {
    const anchor = toContentLocalAnchor(
      { right: 455.258, top: -294.834 },
      { left: -744.3248125, top: -372.6449375, width: CONTENT_LAYOUT_WIDTH },
      CONTENT_LAYOUT_WIDTH,
    );
    expect(anchor.left).toBeCloseTo(1199.5828125, 3);
    expect(anchor.top).toBeCloseTo(77.8109375, 3);
  });

  it("量不到布局宽度（jsdom）时缩放退回 1，不产出 NaN", () => {
    const anchor = toContentLocalAnchor(
      { right: 100, top: 50 },
      { left: 10, top: 20, width: 0 },
      0,
    );
    expect(anchor).toEqual({ left: 90, top: 30 });
    expect(Number.isFinite(anchor.left)).toBe(true);
  });
});
