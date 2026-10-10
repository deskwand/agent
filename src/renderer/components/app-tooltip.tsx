import * as React from "react";

import { cn } from "@renderer/utils/cn";
import {
  Tooltip as BaseTooltip,
  TooltipContent as BaseTooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";

/**
 * 应用侧的 Tooltip —— **把 vendored 的 `ui/tooltip.tsx` 包进它要求的 Provider** ✓。
 *
 * ⚠️ 为什么不能直接用 `ui/tooltip.tsx` 的 `Tooltip` ✗（2026-10-09 实测 ✓）：
 * Radix 的 `Tooltip.Root` **必须在 `TooltipProvider` 之内** ✓，否则**直接抛错**：
 * ```
 * Error: `Tooltip` must be used within `TooltipProvider`
 * ```
 * 那个文件里 `TooltipProvider` **只被 export、从没被使用** ✗ ⇒ 任何调用点都会抛 ✓。
 *
 * ⚠️ 为什么**不在 `App.tsx` 包一层就够** ✗：那些组件的测试是**直接渲染组件**的（不经过 `App` ✗）
 * ⇒ 根 Provider 救不了测试 ✓。这一层让**每个 Tooltip 自带 Provider** ✓，于是应用、测试、
 * 任何渲染方式都成立 ✓✓。
 *
 * ⚠️ **文件名不能叫 `Tooltip.tsx`** ✗✗：同目录已有**老组件** `Tooltip.tsx`（大写 T ✓，
 * 保留给 `AppRail` ✓）。macOS/Windows 的**大小写不敏感**文件系统上会**覆盖它** ✗；
 * Linux 上又会变成两个文件 ✗ ⇒ 跨平台不一致 ✓。
 *
 * ⚠️ `TooltipTrigger` **原样转发** ✓（它是 `asChild` 语义的载体 ✓，不能包一层 ✗ ——
 * 那会让 `asChild` 的 Slot 克隆到包装组件上而不是真正的子元素 ✓）。
 *
 * ⚠️ `TooltipContent` 反过来**必须**包一层 ✓（2026-10-10）：气泡的皮肤是**应用侧差异** ✓，
 * 而 vendored 的默认是 `bg-primary` / `text-primary-foreground` ✗ —— `--primary` 在深色
 * 主题下是近白（`oklch(0.922)`，离页面底色 **15.7:1**）⇒ 气泡会成为屏幕上最亮的东西 ✗
 *（“太打扰”）。应用侧改用 `--secondary` 一对（见 `APP_TOOLTIP_SKIN`）。
 * 包装用 `forwardRef` 转发 ref/props ✓；`cn` 做冲突合并 ⇒ 后传的 `bg-secondary`
 * **真的把 vendored 的 `bg-primary` 挤掉** ✓（已实测：`cn("...bg-primary...", "bg-secondary")`
 * 的输出里只剩 `bg-secondary` ✓）。这不是「改 vendored 文件」✗，与 `app-button.tsx` 同一策略 ✓。
 */
export function Tooltip(props: React.ComponentProps<typeof BaseTooltip>) {
  return (
    <TooltipProvider delayDuration={200}>
      <BaseTooltip {...props} />
    </TooltipProvider>
  );
}

/**
 * 气泡皮肤 —— 应用侧对 vendored 默认值的**唯一**覆写。
 *
 * `--secondary` / `--secondary-foreground` 的实测（全 14 主题，逐块算过）：
 * · 文字对比 **13.79–16.42**（AA 下限 4.5 ✓，可读性不比 `--primary` 差）
 * · 气泡离页面底色 **1.09（浅）/ 1.31–1.37（深）** —— 而 `--primary` 是 17.9 / 15.7 ✗
 * ⇒ 选它是因为**不打扰**：靠色调差分离，而不是靠高对比。
 *
 * ⚠️ `shadow-elevated` **不是可选的装饰，是浅色下唯一的分隔** ✓（已实测 ✗→✓）：
 * 气泡离 `--background` 只 1.09，而 AppRail 的气泡落在 `--sidebar` 上时只有 **1.04** ⇒
 * 无阴影时浅色主题看到的是「几行游离的深色文字盖在侧栏上」，容器不可辨 ✗。
 * 它取自 `--shadow-elevated`（`0 4px 12px rgba(0,0,0,.12)`）—— 与人类审皮肤时看的
 * `design-docs/2026-10-10-tooltip-skin-preview.html` 里那个 `--raise` **同值** ✓。
 * ⇒ **被挑战时别先删它**；要改先重算上面那两个数。
 *
 * 这条判断由 `src/tests/renderer/tooltip-palette.test.ts`（颜色，token 名从本常量**反推** ✓）
 * 与 `app-tooltip-skin.test.tsx`（覆写真的生效 + 阴影在 ✓）一起守着。
 */
const APP_TOOLTIP_SKIN =
  "bg-secondary text-secondary-foreground shadow-elevated";

export const TooltipContent = React.forwardRef<
  React.ElementRef<typeof BaseTooltipContent>,
  React.ComponentPropsWithoutRef<typeof BaseTooltipContent>
>(({ className, ...props }, ref) => (
  <BaseTooltipContent
    ref={ref}
    className={cn(APP_TOOLTIP_SKIN, className)}
    {...props}
  />
));
TooltipContent.displayName = "TooltipContent";

export { TooltipTrigger };
