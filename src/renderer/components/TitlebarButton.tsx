/**
 * @module renderer/components/TitlebarButton
 *
 * 顶栏里的那颗小按钮：28×28、圆角、hover / 已开启两套互斥的类组合。
 *
 * 从 `Titlebar.tsx` 原样抽出并导出 —— header 里的两个播放控件
 * （`voice-mode/VoiceMiniButton`、`FeedListenButton`）要用同一套按钮语言，
 * 不能各写一份「长得差不多」的按钮。
 */
import type { ReactNode } from "react";
import { Tooltip } from "./Tooltip";

export interface TitlebarButtonProps {
  /** 气泡文案，同时用作 aria-label。调用方负责 i18n。 */
  label: string;
  /** 面板已开启。注意与 CSS :active 伪类（物理按下）不是一回事。 */
  isOn?: boolean;
  /** 静止时的图标色。仅未开启时生效。 */
  tone?: "muted" | "secondary";
  /**
   * 不挂 Tooltip。header 里那两个播放控件用 —— 它们悬停时会弹出自己的卡片，
   * 而 Tooltip 的气泡（向下 6px、约 22px 高、z-60）必然压住卡片第一行；
   * 可访问名仍由 `aria-label` 承担。
   */
  hideTooltip?: boolean;
  onClick?: () => void;
  children: ReactNode;
}

export function TitlebarButton({
  label,
  isOn = false,
  tone = "muted",
  hideTooltip = false,
  onClick,
  children,
}: TitlebarButtonProps) {
  // 已开启与未开启是两套互斥的 class 组合，不是靠 CSS 优先级叠加：
  // Tailwind 输出的 hover: 变体晚于无前缀的 bg-overlay-on，同时存在时会把
  // 已开启背景盖掉。
  const stateClasses = isOn
    ? "bg-overlay-on text-accent active:scale-[0.96] active:duration-75"
    : `hover:bg-overlay-hover hover:text-text-primary active:bg-overlay-press active:scale-[0.96] active:duration-75 ${
        tone === "secondary" ? "text-text-secondary" : "text-text-muted"
      }`;

  const button = (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`w-7 h-7 rounded-control grid place-items-center transition-[background-color,color,transform] duration-150 ${stateClasses}`}
    >
      {children}
    </button>
  );

  if (hideTooltip) return button;
  return <Tooltip label={label}>{button}</Tooltip>;
}
