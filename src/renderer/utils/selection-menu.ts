/**
 * @module renderer/utils/selection-menu
 *
 * 划词菜单的纯逻辑：把一次 DOM 选区解析成菜单要的上下文。
 *
 * 为什么与宿主分开：宿主里全是事件监听与 rect 测量，而 jsdom 的
 * `Range.getBoundingClientRect()` 恒为零矩形 —— 拆开后解析可以被穷举测
 * （矩形由 `rectOf` 注入）。
 */
import type { LucideIcon } from "lucide-react";

/**
 * 内容面白名单。**必须与 globals.css 里那条 allowlist 逐项相等**，
 * 由 src/tests/renderer/text-selection-guard.test.ts 双向钉住。
 */
export const SELECTION_ALLOW =
  'pre, code, [role="dialog"], [role="alertdialog"], .prose-chat, .message-user-text, .selectable';

/**
 * 要拒绝的面。与上面那份相加正好等于 CSS 的 allowlist。
 * 编辑器（`[contenteditable]`）已有 slash 菜单，且划词偏移靠 `window.getSelection()`
 * 算，不在这里叠第二层。
 */
export const SELECTION_SUPPRESS = "input, textarea, [contenteditable]";

export interface SelectionContext {
  /** `selection.toString()` 原样：复制、引用、记一笔用它，缩进与换行都在。 */
  rawText: string;
  /** 折叠空白并 trim：朗读用它（缩进会被念成停顿），也用它判空。 */
  text: string;
  /** 按下松开那一刻的快照。点菜单时活选区已经塌陷，只能靠它。 */
  range: Range;
  rect: DOMRect;
  /** 选区是否落在弹层里。Radix Popover 的 Content 也是 role="dialog"。 */
  inDialog: boolean;
}

export interface SelectionRuntime {
  /** 划词朗读正在出声（preparing | playing）。`error` 不算 —— 那是「可以重试」。 */
  speaking: boolean;
  /** 语音会话在跑：此时不给朗读。 */
  voiceModeOpen: boolean;
}

export interface SelectionAction {
  id: string;
  labelKey: string;
  icon: LucideIcon;
  /** 弹层内是否出现。缺省 false —— 只有「复制」为 true。 */
  visibleInDialog?: boolean;
  /** 运行时改标签（播放中 → 停止朗读）；返回 undefined 用 labelKey。 */
  labelKeyWhen?(
    ctx: SelectionContext,
    runtime: SelectionRuntime,
  ): string | undefined;
  /** 临时不可用（语音会话占用）→ 置灰但保留，避免菜单长度跳动。 */
  enabledWhen?(ctx: SelectionContext, runtime: SelectionRuntime): boolean;
  run(ctx: SelectionContext): void | Promise<void>;
}

/** 只收真正用到的那几个成员：真实 `Selection` 与测试假对象都能满足。 */
export interface SelectionLike {
  isCollapsed: boolean;
  rangeCount: number;
  anchorNode: Node | null;
  toString(): string;
  getRangeAt(index: number): Range;
}

export interface ResolveSelectionOptions {
  /** 只为测试注入：真实调用走 `range.getBoundingClientRect()`。 */
  rectOf?: (range: Range) => DOMRect;
}

/**
 * jsdom 的 `Range` 压根没有这个方法（不是返回零矩形，是未实现），而渲染层
 * 要能在 jsdom 里跑 —— 所以给一个零矩形兜底。真实浏览器（Chromium）一定有。
 */
function defaultRectOf(range: Range): DOMRect {
  if (typeof range.getBoundingClientRect !== "function") {
    return {
      top: 0,
      bottom: 0,
      left: 0,
      right: 0,
      width: 0,
      height: 0,
    } as DOMRect;
  }
  return range.getBoundingClientRect();
}

export function resolveSelectionContext(
  selection: SelectionLike | null,
  options: ResolveSelectionOptions = {},
): SelectionContext | null {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return null;
  }
  const rawText = selection.toString();
  if (rawText.trim() === "") return null;

  const anchor = selection.anchorNode;
  if (!anchor) return null;
  const element =
    anchor.nodeType === 1 ? (anchor as Element) : anchor.parentElement;
  if (!element || typeof element.closest !== "function") return null;
  if (element.closest(SELECTION_SUPPRESS)) return null;
  if (!element.closest(SELECTION_ALLOW)) return null;

  const range = selection.getRangeAt(0).cloneRange();
  return {
    rawText,
    text: rawText.replace(/\s+/g, " ").trim(),
    range,
    rect: (options.rectOf ?? defaultRectOf)(range),
    inDialog: Boolean(element.closest('[role="dialog"], [role="alertdialog"]')),
  };
}
