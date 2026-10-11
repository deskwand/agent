import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";

import { cn } from "@renderer/utils/cn";

// shadcn new-york 的官方 checkbox（Radix 底座）。与本仓 vendored 组件同一口径：
// `forwardRef` 转发、`cn` 合并类名、颜色全部走语义 token（--primary / --ring /
// --primary-foreground），不硬编码色值。图标用 lucide 的 `Check` —— 见根目录
// components.json 的 `"iconLibrary": "lucide"`。
//
// 语义由 Radix 提供：role=checkbox、aria-checked（含 indeterminate → mixed）、
// 键盘 Space、焦点环。调用点只需要 `checked` + `onCheckedChange`；父级如果还有
// 行级点击，必须在 Checkbox 自己的 onClick 里 stopPropagation（见 SettingsArchived），
// 否则行与控件会各切一次。
const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      "peer size-4 shrink-0 rounded-sm border border-primary shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator
      className={cn("flex items-center justify-center text-current")}
    >
      <Check className="size-4" />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };
