"use client";

import * as React from "react";
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { Circle } from "lucide-react";

import { cn } from "@renderer/utils/cn";

/**
 * vendored `ui/radio-group.tsx` —— 上游官方（new-york）版本的落地，结构、类名、
 * Indicator 与 `h-4/shadow/focus-visible:ring-1` 那套都照抄，只改了 import 别名：
 * 上游的 `@/lib/utils` → 本仓 `@renderer/utils/cn`（与 `ui/switch.tsx` 同一约定）。
 * 颜色全部走语义 Token（border-primary / text-primary / ring-ring），无硬编码色值。
 *
 * 本仓的差异只有**格式**：同目录其余 vendored 文件保留 registry 原始的无分号写法，
 * 而这两条 prettier 门禁只查「本次改动的文件」，新文件必须自己过
 * `npx prettier --check`，所以按 Prettier 默认格式化，不连累任何既有文件。
 *
 * ⚠️ 使用方不要给 Root 传 `orientation`：Radix 的 RovingFocus 在
 * `orientation="vertical"` 下会忽略 ArrowLeft/ArrowRight，而 radiogroup 的
 * 可访问性契约（见 `AskUserCard`）要求右/下两条方向键都能移动并选中。
 */
const RadioGroup = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>
>(({ className, ...props }, ref) => {
  return (
    <RadioGroupPrimitive.Root
      className={cn("grid gap-2", className)}
      {...props}
      ref={ref}
    />
  );
});
RadioGroup.displayName = RadioGroupPrimitive.Root.displayName;

const RadioGroupItem = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>
>(({ className, ...props }, ref) => {
  return (
    <RadioGroupPrimitive.Item
      ref={ref}
      className={cn(
        "aspect-square h-4 w-4 rounded-full border border-primary text-primary shadow focus:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator className="flex items-center justify-center">
        <Circle className="h-3.5 w-3.5 fill-primary" />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  );
});
RadioGroupItem.displayName = RadioGroupPrimitive.Item.displayName;

export { RadioGroup, RadioGroupItem };
