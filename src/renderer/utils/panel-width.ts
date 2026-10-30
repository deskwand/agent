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
  /** 浏览器独占的一格；null = 用户没拖过，按半屏算 */
  browserWidth: number | null;
}

/** 槽位实际宽度：每块面板用自己的宽度（读出时收敛到窗口能给的范围内，
 *  这样窗口放大后用户原来拖的宽度会回来）。浏览器靠 browserWidth 独占（null 即半屏），
 *  文件浏览器 / 概览仍共用 contextPanelWidth —— 它们不会自己改这个值。 */
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
  if (mode === "browser") {
    return widths.browserWidth === null
      ? initialBrowserWidth(available)
      : clampBrowserWidth(widths.browserWidth, available);
  }
  return clampContextWidth(widths.contextPanelWidth, available);
}

/**
 * 面板宽度的过渡类名。拖动分隔条期间必须返回空串：这条过渡会把每一帧的宽度变化
 * 再延迟 300ms，让面板永远追不上光标 —— 折叠/展开仍然要靠它，所以只按拖动状态
 * 开关，不删过渡本身。
 *
 * 唯一声明处：Sidebar 与 App 的右侧面板共用，避免同一个时序字面量在多处各自漂移
 * （AGENTS.md「动效时序只有一个来源」）。
 */
export function panelWidthTransitionClass(dragging: boolean): string {
  return dragging ? "" : "transition-[width] duration-300 ease-in-out";
}

/**
 * 浏览器面板：默认半屏，用户拖过之后用自己的宽度。
 *
 * 这两条以前写在 App 的 effect 里（开面板 / 窗口 resize 时把半屏写进共用的
 * contextPanelWidth），于是「开过浏览器之后打开概览」会继承浏览器的半屏宽度 ——
 * 共用的那一格被别的面板改写了。现在改成读出时按可用宽度现算，
 * 浏览器不再在 store 里留一个会腐坏别人宽度的中间值。
 */
export const BROWSER_MIN_WIDTH = 350;
/** 浏览器默认占比：半屏 */
const BROWSER_DEFAULT_RATIO = 0.5;

export function browserWidthBounds(available: number): {
  min: number;
  max: number;
} {
  // 窗口比下限还窄时，下限让位给窗口：面板不能宽过可用宽度
  const min = Math.min(BROWSER_MIN_WIDTH, available);
  return { min, max: Math.max(min, available) };
}

export function clampBrowserWidth(width: number, available: number): number {
  const { min, max } = browserWidthBounds(available);
  return Math.max(min, Math.min(max, Math.round(width)));
}

/** 浏览器面板的默认宽度：可用宽度的半屏。 */
export function initialBrowserWidth(available: number): number {
  return clampBrowserWidth(available * BROWSER_DEFAULT_RATIO, available);
}

/** 文件浏览器 / 概览共用的上下文宽度：拖拽边界。 */
export const CONTEXT_MIN_WIDTH = 280;
export const CONTEXT_MAX_WIDTH = 480;
/** 共用上下文宽度的默认值（双击分隔条回到这里，也是 store 的初始值）。 */
export const CONTEXT_DEFAULT_WIDTH = 288;

export function contextWidthBounds(available: number): {
  min: number;
  max: number;
} {
  return {
    min: CONTEXT_MIN_WIDTH,
    max: Math.max(CONTEXT_MIN_WIDTH, Math.min(CONTEXT_MAX_WIDTH, available)),
  };
}

export function clampContextWidth(width: number, available: number): number {
  const { min, max } = contextWidthBounds(available);
  return Math.max(min, Math.min(max, Math.round(width)));
}
