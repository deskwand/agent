import * as React from "react";

import {
  Tooltip as BaseTooltip,
  TooltipContent,
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
 * ⚠️ `TooltipTrigger` / `TooltipContent` **原样转发** ✓（它们是 `asChild` 语义的载体 ✓，
 * 不能包一层 ✗ —— 那会让 `asChild` 的 Slot 克隆到包装组件上而不是真正的子元素 ✓）。
 */
export function Tooltip(props: React.ComponentProps<typeof BaseTooltip>) {
  return (
    <TooltipProvider delayDuration={200}>
      <BaseTooltip {...props} />
    </TooltipProvider>
  );
}

export { TooltipContent, TooltipTrigger };
