import * as React from "react";

import { Progress } from "./ui/progress";

/**
 * 应用侧的 Progress —— 与 `app-button.tsx` / `app-tooltip.tsx` 同一策略：vendored
 * 文件保持与上游一致，应用侧差异集中在这一层（spec §10：不改写 vendored 文件）。
 *
 * ⚠️ 这一层不是可选的，下面两条都是**实测**出来的（2026-10-10）：
 *
 * **① vendored 的 `Progress` 不把 `value` 转给 Root** ✗
 * `ui/progress.tsx` 把 `value` 解构出来**只**用于算 Indicator 的
 * `translateX(-${100 - value}%)`，`Root` 只收到剩下的 props ⇒ Root 的 `value` 是
 * `null` ⇒ Radix 认定这是 indeterminate：
 *   · `aria-valuenow` **根本不渲染**（读屏与 e2e 读的就是它）
 *   · `data-state="indeterminate"`、`data-value` 缺失
 * 实测 markup（「2 项里完成 1 项」渲染出来的样子）：
 *   `<div aria-valuemax="2" aria-valuemin="0" aria-valuenow="1" role="progressbar"
 *         data-state="indeterminate" data-max="100" …>` ← 前三个 aria 是本层写的
 * ⇒ **区间语义必须由本层显式写回**。`data-state` / `data-value` / `data-max` 就留在
 * Radix 的默认值上：它们是 Radix 自己的 CSS 钩子，本仓没有任何选择器读它们
 *（颜色与尺寸都走 className），所以只是惰性标记，不对用户构成错误陈述。
 *
 * **② vendored 的位移只认 0–100 的百分比** ✗
 * 直接把领域值当 `value` 传（如 2/9 传 2）⇒ 位移算成 `100 - 2 = 98%` ✗ —— 视觉会反过来。
 * ⇒ 调用方传**领域语义**（`value` / `max`），百分比在本层换算。
 */
export interface AppProgressProps extends Omit<
  React.ComponentPropsWithoutRef<typeof Progress>,
  "value" | "max"
> {
  /** 已完成的量（领域语义，如「2 项」）。 */
  value: number;
  /** 总量（领域语义，如「9 项」）。 */
  max: number;
}

export const AppProgress = React.forwardRef<
  React.ElementRef<typeof Progress>,
  AppProgressProps
>(function AppProgress({ value, max, ...props }, ref) {
  // `max <= 0` 按 0% 处理：本层是公共层，不把除零与 NaN 留给上游。今天的调用方
  // （chip：`hasPlan` ⇒ `todos.length > 0`）都保证 `max > 0`，属于兜底而非现状。
  const hasRange = max > 0;
  const percent = hasRange
    ? Math.min(100, Math.max(0, (value / max) * 100))
    : 0;
  // 语义跟着锅（理由见文件头 ③）：区间无意义时不输出这两个属性 —— 传 `undefined`
  // 会把 Radix 自己写的默认值一并抹掉 ⇒ 回到它自己的 indeterminate，不报非法区间。
  const clamped = hasRange ? Math.min(max, Math.max(0, value)) : undefined;

  return (
    <Progress
      ref={ref}
      value={percent}
      aria-valuemin={0}
      aria-valuemax={hasRange ? max : undefined}
      aria-valuenow={clamped}
      {...props}
    />
  );
});
