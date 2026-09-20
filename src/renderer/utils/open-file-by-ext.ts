import {
  isBrowserOpenableExt,
  isOfficePreviewExt,
  isPreviewableExt,
} from "./file-preview";

/**
 * 点击一个文件应该走哪条路。
 *
 * 四个入口（文件树 / 筛选结果 / 产物面板 / 消息附件）原先各写了一遍同样的三岔口
 * 判断。判断条件一致但**兜底动作不同**（多数是"用系统程序打开"，消息附件是
 * "在文件夹中显示"），所以这里只统一"是哪一类"，各入口自己决定 fallback 做什么。
 */
export type OpenAction = "browser" | "preview" | "office" | "fallback";

/** 取小写扩展名（含前导点）。无扩展名时返回空串。 */
export function extOf(nameOrPath: string): string {
  const dot = nameOrPath.lastIndexOf(".");
  if (dot <= 0) return "";
  return nameOrPath.slice(dot).toLowerCase();
}

/**
 * 判定顺序有讲究：office 放在两个既有判定**之后**，这样将来某个扩展名若被同时
 * 加进两张表，既有行为也不会改变。
 */
export function resolveOpenAction(ext: string): OpenAction {
  if (isBrowserOpenableExt(ext)) return "browser";
  if (isPreviewableExt(ext)) return "preview";
  if (isOfficePreviewExt(ext)) return "office";
  return "fallback";
}
