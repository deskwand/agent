import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@renderer/utils/cn";

/**
 * 应用侧的 Button 变体表 —— **与 vendored `ui/button.tsx` 的两处差异是有意的** ✓✓。
 *
 * ⚠️ 为什么要这一层（2026-10-09 实测 ✓，两次用户报障的根因 ✓）：
 *
 * **① `ghost` 不能带 `hover:text-accent-foreground`** ✗
 * vendored 的 `ghost` 是 `"hover:bg-accent hover:text-accent-foreground"` ✓，而
 * `--color-accent-foreground` 在**部分主题里是白色** ✗（`globals.css` 有 `#ffffff` ✓）。
 * 本仓的按钮**自带 hover 底色**（多为浅灰 `hover:bg-surface-hover` ✓）而**不带 hover 文字色** ✗
 * ⇒ 变体那一条会**替它把文字刷成白色** ⇒ **白字压浅灰，hover/聚焦时整行看不见** ✗✗
 *（用户截图：输入框的模型芯片、消息区的工具摘要行 ✓）。
 * ⇒ 本表的 `ghost` **不带任何 `hover:text-*`** ✓：hover 时文字**保持自己的颜色** ✓
 *（== 迁移前原生 `<button>` 的行为 ✓✓）。
 *
 * **② `justify-center` 必须能被调用方关掉** ✗
 * vendored 的 base 含 `justify-center` ✓，而原生 `<button className="flex …">` 的 flex
 * 默认是 **`flex-start`（居左）** ✓ ⇒ 凡「满宽/弹性宽 + 一行内容」的按钮（设置页菜单项 ✓、
 * 消息区工具摘要行 ✓）迁过来后**全部居中** ✗✓。
 * ⇒ 本层**默认追加 `justify-start`** ✓，并靠 `cn`（`@renderer/utils/cn`，即 `cn` 包 0.4.0 ✓，**不是** tailwind-merge ✗）去重：
 * 调用方若显式写了 `justify-center`，**它排在后面、会赢** ✓（无需改调用点 ✓✓）。
 *
 * ⚠️ 这一层**不 vendor 进 `ui/`** ✗ —— 与 `app-tooltip.tsx` 同一策略：
 * vendored 文件保持与上游一致、不手改（spec §10 ✓），应用侧差异集中在这一处 ✓✓。
 */
const appButtonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
        // ⚠️ 审查 Minor 5：`outline` **仍保留** `hover:text-accent-foreground` ✗ —— 今天无害
        //（唯一调用方 `SettingsGlobalAgentsMd` 自己写了 `hover:text-text-primary`，在 `cn` 里赢 ✓），
        // 但下一个「outline + 自定义浅色 hover 底」的调用方会**复现同一 bug** ✗ ⇒ 用之前先想清楚 ✓。
        outline:
          "border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80",
        // ⚠️ 与 vendored 的差异①：**没有** `hover:text-accent-foreground` ✓（见文件头说明）。
        ghost: "hover:bg-accent",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof appButtonVariants> {
  /**
   * ⚠️ 审查 Minor 6：**当前全仓零处使用** ✗（`<Button asChild>` 没有调用点），且它是个**雷**：
   * `shouldLeftAlign` 看的是**插槽子元素的** className ✓，而 `Slot` 会把 base 的 `inline-flex
   * justify-center` 合并到那个子元素上 ⇒ `<a className="flex">` 反而会**居中** ✗。
   * ⇒ 要用它之前先处理这条 ✓。
   */
  asChild?: boolean;
}

/**
 * 该调用方是否需要 `justify-start`（**导出以便单测** ✓ —— 视觉差异只能靠锁机制来守 ✓✓）。
 *
 * 判据全部来自**实测**（2026-10-09 代码审查的浏览器量测 ✓）：
 * · 原生 `<button className="flex …">` 的 flex 默认是 **flex-start**（居左 ✓）
 *   ⇒ 只有**真正的 flex 容器**才需要补 ✓。
 * · ⚠️ 判定必须**按 token**，不能用 `\b` ✗ —— `\b` 把 `-` 当边界，`flex-1` / `flex-shrink-0` /
 *   `flex-none` 都会误命中 ✗（它们只是 **flex 子项**），会把原本居中的弹窗按钮推左（实测 −118px ✗）。
 * · 只写 `w-full text-left`、**没有 flex** 的按钮**原生也是居左的** ✓（`text-align:left` 生效 ✓），
 *   而迁移后 base 的 `inline-flex` 让 `text-align` 失效 ✗（实测左内缩 16px → 230px ✗）
 *   ⇒ `text-left` / `text-start` 是「原生居左」的诚实信号 ✓，一并注入 ✓。
 * · 调用方自己写了 `justify-*`（**含写在三元里的** ✓）就由它赢 ✓ —— `cn` 去重后就只剩它 ✓。
 */
export function shouldLeftAlign(className: string | undefined): boolean {
// ⚠️ 判定必须**按 token**，不能用 `\b` ✗ —— 审查员实测：
// `\b` 把 `-` 当边界，于是 `flex-1` / `flex-shrink-0` / `flex-none` 都会命中 ✗，
// 而它们只是 **flex 子项**、不是调用方要的 flex **容器** ⇒ 会把原本居中的
// 弹窗按钮 / 分段控件推左（实测偏移 −118px ✓）。
const tokens = (className ?? "").split(/\s+/).filter(Boolean);
const isFlexContainer = tokens.some(
  (tk) => tk === "flex" || tk === "inline-flex" || /^(?:[a-z-]+:)*(?:inline-)?flex$/.test(tk),
);
// ⚠️ 只写 `w-full text-left`、没有 flex 的按钮，**原生也是居左的** ✓（`text-align:left` 有效 ✓）；
// 而迁移后 base 的 `inline-flex` 让 `text-align` 失效 ✗ ⇒ 实测左内缩从 16px 变 230px（居中 ✗）。
// ⇒ `text-left` / `text-start` 是「原生居左」的诚实信号 ✓，一并注入 ✓。
const wantsLeft = tokens.includes("text-left") || tokens.includes("text-start");
const hasOwnJustify = tokens.some((tk) => /(?:^|:)justify-/.test(tk));
  return (isFlexContainer || wantsLeft) && !hasOwnJustify;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";



    return (
      <Comp
        className={cn(
          appButtonVariants({ variant, size }),
          // ⚠️ 差异②：**只在调用方本来就是 flex 布局时**默认居左 ✓ —— 判据来自实测：
          // 原生 `<button className="flex …">` 的 flex 默认是 `flex-start`（居左 ✓），
          // 而**不带 flex** 的 `<button>` 是 **text-align: center**（居中 ✓）。
          // ⇒ 带 flex 且没写 justify-* 的，才补 `justify-start` ✓（写了就由它赢 ✓，tailwind-merge 去重 ✓）。
          // ⇒ 不带 flex 的**不动** ✓ —— 保持 base 的 `justify-center`（== 原生居中 ✓✓）。
          shouldLeftAlign(className) ? "justify-start" : "",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, appButtonVariants };
