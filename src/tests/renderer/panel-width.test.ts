import { describe, expect, it } from "vitest";
import {
  availablePanelWidth,
  clampPreviewWidth,
  clampReviewWidth,
  initialPreviewWidth,
  initialReviewWidth,
  previewWidthBounds,
  resolvePanelWidth,
  reviewWidthBounds,
} from "../../renderer/utils/panel-width";

describe("panel width", () => {
  it("subtracts the sidebar when it is expanded", () => {
    expect(availablePanelWidth(1024, false, 280)).toBe(744);
    expect(availablePanelWidth(1024, true, 280)).toBe(1024);
  });

  it("caps the preview at 70% of the available width or 960px", () => {
    expect(previewWidthBounds(744)).toEqual({ min: 320, max: 521 });
    expect(previewWidthBounds(2400)).toEqual({ min: 320, max: 960 });
  });

  it("clamps a dragged preview width into bounds", () => {
    expect(clampPreviewWidth(2000, 1600)).toBe(960);
    expect(clampPreviewWidth(100, 1600)).toBe(320);
    expect(clampPreviewWidth(700, 1600)).toBe(700);
  });

  it("defaults to half of the available width", () => {
    expect(initialPreviewWidth(1024, false, 280)).toBe(372);
    expect(initialPreviewWidth(2400, false, 280)).toBe(960);
    // 窗口很窄时半屏低于下限，收敛到 320
    expect(initialPreviewWidth(800, false, 280)).toBe(320);
  });

  it("resolves the slot width per mode", () => {
    const widths = {
      contextPanelWidth: 288,
      previewWidth: 700,
      reviewWidth: 1100,
    };
    expect(resolvePanelWidth("preview", widths, 1600)).toBe(700);
    expect(resolvePanelWidth("review", widths, 1600)).toBe(1100);
    expect(resolvePanelWidth("files", widths, 1600)).toBe(288);
    expect(resolvePanelWidth("browser", widths, 1600)).toBe(288);
    expect(
      resolvePanelWidth("preview", { ...widths, previewWidth: null }, 1600),
    ).toBe(288);
  });

  it("narrows a too-wide preview without losing the preferred width", () => {
    const widths = {
      contextPanelWidth: 288,
      previewWidth: 960,
      reviewWidth: null,
    };
    // 1600px 窗口下拖到 960，缩到 1000px 窗口时读出值收敛
    expect(resolvePanelWidth("preview", widths, 1000)).toBe(700);
    // 原始意图值仍是 960，窗口放大后能恢复
    expect(resolvePanelWidth("preview", widths, 1600)).toBe(960);
  });

  it("caps the review at 85% of the available width or 1400px", () => {
    expect(reviewWidthBounds(1435)).toEqual({ min: 420, max: 1220 });
    expect(reviewWidthBounds(2400)).toEqual({ min: 420, max: 1400 });
    expect(clampReviewWidth(200, 1435)).toBe(420);
    expect(clampReviewWidth(2000, 1435)).toBe(1220);
  });

  it("defaults the review to three quarters of the available width", () => {
    expect(initialReviewWidth(1435, true, 280)).toBe(1076);
    // 窄窗口下 0.75 与 0.85 两个比例都要收敛
    expect(initialReviewWidth(600, true, 280)).toBe(450);
  });
});
