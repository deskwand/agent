import * as fs from "fs";
import { basename } from "path";
import { resolvePathAgainstWorkspace } from "../../shared/workspace-path";
import { findFileByName } from "../utils/find-file-by-name";

export type ResolveVia = "direct" | "by-name" | "unresolved";

/**
 * 把一个**文件引用**（消息文本 / 工具参数里的路径）解析成真实路径。
 *
 * 为什么需要兜底：模型经常在正文里写目录、却在表格里只填裸文件名
 * （见 design-docs/2026-09-20-message-file-reference-resolution-design.md §1），
 * 于是"裸名 + 工作区根"拼出来的路径并不存在。此时按 basename 在工作区里找一个。
 *
 * 注意 `via` 只在主进程内部用于记日志，**不穿过 IPC**。
 */
export function resolveFileReference(
  token: string,
  workingDir: string | null | undefined,
  roots: string[],
): { path: string; via: ResolveVia } {
  if (!token) {
    return { path: "", via: "unresolved" };
  }

  const direct = resolvePathAgainstWorkspace(token, workingDir ?? undefined);

  if (direct && fs.existsSync(direct)) {
    return { path: direct, via: "direct" };
  }

  const found = findFileByName(basename(direct), roots);
  if (found) {
    return { path: found, via: "by-name" };
  }

  // 找不到就原样返回按工作区拼出的路径 —— 让各调用方保持改动前的失败行为，
  // 不要把"找不到"变成另一种错误。
  return { path: direct, via: "unresolved" };
}
