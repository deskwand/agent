import { resolvePathAgainstWorkspace } from "../../shared/workspace-path";
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

/**
 * 把一个文件**引用**解析成真实路径。
 *
 * 消息里常见"正文写了目录、表格里只给裸名"，此时按工作区拼出的路径并不存在；
 * 主进程会再按文件名在工作区里找一次（见 design 文档 §1、§5）。
 * 拿到正确路径后再进 `resolveOpenAction` 分支，下游就不必知道兜底的存在。
 */
export async function resolveFileReferencePath(
  token: string,
  workingDir: string | null | undefined,
): Promise<string> {
  try {
    const resolveReference = window.electronAPI?.file?.resolveReference;
    if (resolveReference) {
      const resolved = await resolveReference(token, workingDir ?? undefined);
      if (resolved) return resolved;
    }
  } catch {
    // 落到本地解析；生产不会走到（preload 一定在），这是为了 helper 可单测
  }
  return resolvePathAgainstWorkspace(token, workingDir);
}
