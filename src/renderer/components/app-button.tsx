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
 * `--accent-foreground` 在**部分主题里是白色** ✗（`globals.css` 有 `#ffffff` ✓）。
 * 本仓的按钮**自带 hover 底色**（多为浅灰 `hover:bg-accent` ✓）而**不带 hover 文字色** ✗
 * ⇒ 变体那一条会**替它把文字刷成白色** ⇒ **白字压浅灰，hover/聚焦时整行看不见** ✗✗
 *（用户截图：输入框的模型芯片、消息区的工具摘要行 ✓）。
 * ⇒ 本表的 `ghost` **不带任何 `hover:text-*`** ✓：hover 时文字**保持自己的颜色** ✓
 *（== 迁移前原生 `<button>` 的行为 ✓✓）。
 *
 * **② `justify-center` 必须能被调用方关掉** ✗
 * vendored 的 base 含 `justify-center` ✓，而原生 `<button className="flex …">` 的 flex
 * 默认是 **`flex-start`（居左）** ✓ ⇒ 凡「满宽/弹性宽 + 一行内容」的按钮（设置页菜单项 ✓、
 * 消息区工具摘要行 ✓）迁过来后**全部居中** ✗✓。
 * ⇒ 本层**默认追加 `justify-start`** ✓，并靠 `cn`（`@renderer/utils/cn`，即 `cn` 包 0.4.0 ✓ —— **包名不是**
 * `tailwind-merge`，但语义兼容：它会合并同族冲突类 ✓，不是只去重 ✗）按调用顺序定胜负：
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
        //（唯一调用方 `SettingsGlobalAgentsMd` 自己写了 `hover:text-foreground`，在 `cn` 里赢 ✓），
        // 但下一个「outline + 自定义浅色 hover 底」的调用方会**复现同一 bug** ✗ ⇒ 用之前先想清楚 ✓。
        outline:
          "border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80",
        // ⚠️ 与 vendored 的差异①：**没有** `hover:text-accent-foreground` ✓（见文件头说明）。
        ghost: "hover:bg-accent",
        link: "text-primary-text underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
        icon: "h-9 w-9",
        // ⚠️ 与 vendored 相比的**又一处有意差异**：**只有 app 层有**的紧凑两档 ✓✓ —— 2026-10-10
        // 用户报障「元数据行那个框太大」的收口处 ✓（登记：`app-button.test.tsx` 的紧凑档用例 ✓）。
        //
        // 为什么非要开档位：缺省档是 `h-9 px-4 py-2` ✓，而**只写 `h-auto` 只能顶掉高度** ✗
        // ⇒ 那几处合并后仍是 `px-4 py-2 h-auto`，16px 图标被 16/8 的内边距撑成 **48×32 的方块** ✓
        //（2026-10-10 用 `dist` 里的真 CSS 在 Chromium 量过 ✓：旧写法 48×32 / `iconSm` 28×28 ✓）。
        // ⚠️ 「调用点自己写 `h-7 w-7` 也能达到 28×28」是**错的** ✗✗（下一条给了实测与宽度下限口径）；
        // 更糟的是 `grid` 布局：内容盒只剩 0×12 ⇒ 单行落回顶部 ⇒ 子元素下偏
        //（24px 球低 6px、16px 图标低 2px ✗✗，即 `TitlebarButton` 「语音模式图标没居中」✓）。
        // ⇒ 收干净只有两条路：**传档位**（整档替换 ⇒ 内边距根本不进场 ✓✓）或调用点补 `p-0`/`px-0` ✓。
        //
        // ⚠️ `iconSm` 的 28×28 就是仓库图标键的那一档 —— `BrowserPanel`（7 个）、`TitlebarButton`、
        // `ReviewPanel`（2 个）、顶栏的语音/feed 卡片控件，2026-10-10 起**都传这张档**（原先就地写
        // `w-7 h-7`，实测是 32×28 ✗）且装 16px 图标（`[&_svg]:size-4` ✓）
        // ⇒ 这个档位只是给那个约定一个名字，**不是新尺寸** ✓。
        //
        // ⇒ 凡「按钮看着比内容大一圈」的一律用这两档 ✓。两档都**不用**写 `p-0` ✓ —— 理由是 cva 的
        // `size` 是**整组替换**：写了 size 档，缺省档的 `px-4 py-2` 根本不会进场 ✓。
        // ⚠️ 反过来说，**只写 `h-7 w-7` 而不给 size 档**的调用点会把 `px-4 py-2` 留下 ✗ ——
        // `cn` **不会**把 `px-4 py-2` 当成 `h-7 w-7` 的冲突类删掉（2026-10-10 实测：
        // `cn("h-9 px-4 py-2", "h-7 w-7")` 仍带 `px-4 py-2` ✓），而 border-box 的宽度下限是
        // 内边距之和 ⇒ 盒子实测 32px 宽 ✗（`w-6` / `w-7` 都撞在这个下限上，`w-8` 及以上不受影响）。
        // 「slash 菜单图标没有对齐」就是这一类 ⇒ 手写 `w-*` 的图标按钮请改用档位 ✓。
        // ⚠️ `xs` 带 `text-xs` ⇒ 会顶掉缺省档的 `text-sm`；想保留 14px 就在调用点写 `text-sm`
        //（调用点排在最后、**后来者胜** ✓，`SubagentSettings` 就是这么干的 ✓）。
        xs: "h-6 rounded-md px-1.5 text-xs",
        iconSm: "h-7 w-7 rounded-md",
        // ⚠️ 24² 档（菜单行首的星标槽专用）。**不能**在调用点只写 `w-6 h-6` ✗ —— 那走的是**默认档**，
        // 默认档的 `px-4 py-2` 会跟着来，而 border-box 的宽度下限是内边距之和 ✓
        // ⇒ 实测星标槽撑成 **32px**：星标右移 4px、行名右移 8px（2026-10-10 用户报障
        // 「slash 菜单图标没有对齐」的根因 ✓；`cn(base, "h-6 w-6")` 不会删掉 `px-4 py-2` ✗）。
        // 档位是整组替换默认档 ⇒ 这里不需要也不该再写 `p-0` ✓。
        iconXs: "h-6 w-6 rounded-md",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
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
    (tk) =>
      tk === "flex" ||
      tk === "inline-flex" ||
      /^(?:[a-z-]+:)*(?:inline-)?flex$/.test(tk),
  );
  // ⚠️ 只写 `w-full text-left`、没有 flex 的按钮，**原生也是居左的** ✓（`text-align:left` 有效 ✓）；
  // 而迁移后 base 的 `inline-flex` 让 `text-align` 失效 ✗ ⇒ 实测左内缩从 16px 变 230px（居中 ✗）。
  // ⇒ `text-left` / `text-start` 是「原生居左」的诚实信号 ✓，一并注入 ✓。
  const wantsLeft =
    tokens.includes("text-left") || tokens.includes("text-start");
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
