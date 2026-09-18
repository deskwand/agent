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

export const REVIEW_MIN_WIDTH = 420;
export const REVIEW_MAX_WIDTH = 1400;
/** review 默认占比：3/4 可用宽 */
const REVIEW_DEFAULT_RATIO = 0.75;
/** review 上限占比：不超过可用宽度的 85% */
const REVIEW_MAX_RATIO = 0.85;

/** review 面板的拖拽边界。 */
export function reviewWidthBounds(available: number): {
  min: number;
  max: number;
} {
  return {
    min: REVIEW_MIN_WIDTH,
    max: Math.min(REVIEW_MAX_WIDTH, Math.round(available * REVIEW_MAX_RATIO)),
  };
}

export function clampReviewWidth(width: number, available: number): number {
  const { min, max } = reviewWidthBounds(available);
  return Math.max(min, Math.min(max, Math.round(width)));
}

/** 首次打开 review 时的默认宽度。 */
export function initialReviewWidth(
  windowWidth: number,
  sidebarCollapsed: boolean,
  sidebarWidth: number,
): number {
  const available = availablePanelWidth(
    windowWidth,
    sidebarCollapsed,
    sidebarWidth,
  );
  return clampReviewWidth(available * REVIEW_DEFAULT_RATIO, available);
}

export interface PanelWidths {
  contextPanelWidth: number;
  previewWidth: number | null;
  reviewWidth: number | null;
}

/** 槽位实际宽度：每块面板用自己的宽度（读出时收敛到窗口能给的范围内，
 *  这样窗口放大后用户原来拖的宽度会回来），其余模式仍用共用的 contextPanelWidth。 */
export function resolvePanelWidth(
  mode: RightPanelMode,
  widths: PanelWidths,
  available: number,
): number {
  if (mode === "preview" && widths.previewWidth !== null) {
    return clampPreviewWidth(widths.previewWidth, available);
  }
  if (mode === "review" && widths.reviewWidth !== null) {
    return clampReviewWidth(widths.reviewWidth, available);
  }
  return widths.contextPanelWidth;
}
