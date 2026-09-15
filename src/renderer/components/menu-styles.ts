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
  "flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm transition-colors";

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
