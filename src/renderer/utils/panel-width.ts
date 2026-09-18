import type { RightPanelMode } from "./browser-visibility";

export const PREVIEW_MIN_WIDTH = 320;
export const PREVIEW_MAX_WIDTH = 960;
/** 预览默认占比：半屏 */
const PREVIEW_DEFAULT_RATIO = 0.5;
/** 预览上限占比：不超过可用宽度的 70% */
const PREVIEW_MAX_RATIO = 0.7;

/** 右侧面板的可用宽度（窗口宽度减去展开的侧栏）。 */
export function availablePanelWidth(
  windowWidth: number,
  sidebarCollapsed: boolean,
  sidebarWidth: number,
): number {
  return sidebarCollapsed ? windowWidth : windowWidth - sidebarWidth;
}

/** 预览面板的拖拽边界。 */
export function previewWidthBounds(available: number): {
  min: number;
  max: number;
} {
  return {
    min: PREVIEW_MIN_WIDTH,
    max: Math.min(PREVIEW_MAX_WIDTH, Math.round(available * PREVIEW_MAX_RATIO)),
  };
}

export function clampPreviewWidth(width: number, available: number): number {
  const { min, max } = previewWidthBounds(available);
  return Math.max(min, Math.min(max, Math.round(width)));
}

/** 首次打开预览时的默认宽度。 */
export function initialPreviewWidth(
  windowWidth: number,
  sidebarCollapsed: boolean,
  sidebarWidth: number,
): number {
  const available = availablePanelWidth(
    windowWidth,
    sidebarCollapsed,
    sidebarWidth,
  );
  return clampPreviewWidth(available * PREVIEW_DEFAULT_RATIO, available);
}

/** 槽位实际宽度：预览用自己的宽度（读出时收敛到窗口能给的范围内，
 *  这样窗口放大后用户原来拖的宽度会回来），其余模式仍用共用的 contextPanelWidth。 */
export function resolvePanelWidth(
  mode: RightPanelMode,
  contextPanelWidth: number,
  previewWidth: number | null,
  available: number,
): number {
  if (mode === "preview" && previewWidth !== null) {
    return clampPreviewWidth(previewWidth, available);
  }
  return contextPanelWidth;
}
