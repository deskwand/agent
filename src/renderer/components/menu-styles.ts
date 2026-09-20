/**
 * 弹出菜单共用样式 token。
 *
 * 只管「长什么样」：面板外壳、菜单行、分组标题、分隔线。
 * 不管「出现在哪」—— 定位（absolute/fixed + 弹出方向）、宽度、max-height、
 * z-index 由各自锚点决定，留在各菜单里。
 */

/** 面板外壳。不含内边距：SlashMenu 内部自带 tab 栏与滚动区，套 p-1 会破版。 */
export const MENU_PANEL_CLASS =
  "rounded-xl border border-border-subtle bg-background shadow-elevated";

/** 面板外壳 + 简单列表用的内边距（绝大多数菜单用这个） */
export const MENU_PANEL_PADDED_CLASS = `${MENU_PANEL_CLASS} p-1`;

/**
 * 单行菜单项：只放结构与排版，**不放颜色与 hover 底色**。
 *
 * 颜色由四个互斥状态类补齐，调用方按 `disabled → danger → selected → default`
 * 的顺序四选一。若把 text-text-primary 或 hover:bg-surface-hover 放进这里，
 * 状态类就必须覆盖它们，而 Tailwind 同名属性的输出顺序由主题里的颜色定义顺序决定、
 * 不由 className 书写顺序决定 —— 覆盖结果不可判定。
 */
export const MENU_ITEM_CLASS =
  "flex h-7 w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm transition-colors";

/** 普通态 */
export const MENU_ITEM_DEFAULT_CLASS =
  "text-text-primary hover:bg-surface-hover";

/** 选中态（已选值）：底色 + 行尾 Check 图标（图标由使用方渲染） */
export const MENU_ITEM_SELECTED_CLASS = "text-text-primary bg-surface-hover";

/** 危险操作（删除、丢弃） */
export const MENU_ITEM_DANGER_CLASS = "text-error hover:bg-error/10";

/** 禁用态 */
export const MENU_ITEM_DISABLED_CLASS =
  "cursor-not-allowed text-text-muted opacity-50";

/** 分组标题 */
export const MENU_LABEL_CLASS = "px-2.5 py-1 text-xs text-text-muted";

/** 分隔线 */
export const MENU_SEPARATOR_CLASS = "mx-2 my-1 border-t border-border-subtle";

/**
 * 菜单徽章：中性灰字，不带上色、不带给色底、不带图标。
 *
 * 四类徽章（内置命令「内置」/ 扩展「插件」/ 提示词模板「自定义」/ 技能类型
 * builtin·mcp·custom·agent）必须是同一个元素形态：只有文字。来源分类由同一行的
 * 行图标承载（`zap` / `package` / `file-text` / `sparkles`）；技能类型只由这段文字承载。
 * 徽章里再塞一个类型图标会让各类徽章结构不一致 —— 那是上一次改动漏掉的另一半。
 *
 * 10px 字号下多色相的 `/10` 底在浅色主题里几乎不可辨，且 `warning`/`accent`
 * 在本项目别处另有「警告 / 主色」语义，继续上色会让同一个颜色表示两件事。
 * 用 `text-text-secondary` 而不是 `text-text-muted`：后者在本仓 14 套主题变量下
 * 实测对比度只有 2.45–4.59:1，10px 小字达不到 AA 4.5:1；secondary 是 6.19–8.33:1。
 */
export const MENU_BADGE_CLASS =
  "inline-flex items-center text-[10px] text-text-secondary px-1.5";
