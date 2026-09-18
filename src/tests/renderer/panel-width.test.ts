import { describe, expect, it } from "vitest";
import {
  availablePanelWidth,
  clampPreviewWidth,
  initialPreviewWidth,
  previewWidthBounds,
  resolvePanelWidth,
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
    expect(resolvePanelWidth("preview", 288, 700, 1600)).toBe(700);
    expect(resolvePanelWidth("preview", 288, null, 1600)).toBe(288);
    expect(resolvePanelWidth("files", 288, 700, 1600)).toBe(288);
    expect(resolvePanelWidth("browser", 288, 700, 1600)).toBe(288);
  });

  it("narrows a too-wide preview without losing the preferred width", () => {
    // 1600px 窗口下拖到 960，缩到 1000px 窗口时读出值收敛
    expect(resolvePanelWidth("preview", 288, 960, 1000)).toBe(700);
    // 原始意图值仍是 960，窗口放大后能恢复
    expect(resolvePanelWidth("preview", 288, 960, 1600)).toBe(960);
  });
});
