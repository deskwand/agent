/**
 * 图标栏内按钮的共用几何样式。
 *
 * 栏内按钮分处两个文件（AppRail 的导航项、HelpMenu 的 ? 按钮），必须同形；
 * 常量放这里是为了避免 AppRail 与 HelpMenu 互相 import 成环，也避免两处各写一份。
 */
export const RAIL_BUTTON_CLASS =
  "w-8 h-8 rounded-control grid place-items-center transition-[background-color,color,transform] duration-150";
