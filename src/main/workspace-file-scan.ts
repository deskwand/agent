import * as path from "path";
import { readdir, stat } from "fs/promises";

/** 扫描文件数上限：够了就停，UI 用 truncated 提示用户改用搜索。 */
export const WORKSPACE_SCAN_FILE_CAP = 2000;

/** 进入的目录数上限：只防病态目录树（成千上万个空目录），正常仓库远达不到。 */
const WORKSPACE_SCAN_DIR_CAP = 5000;

/** 不进入的目录：依赖、版本控制，以及会话附件目录。 */
const IGNORED_DIRS = new Set(["node_modules", ".git", ".tmp"]);

export interface WorkspaceFileEntry {
  /** 相对 rootDir 的路径，统一 `/` 分隔 */
  relPath: string;
  size: number;
}

export interface WorkspaceScanResult {
  files: WorkspaceFileEntry[];
  /** 因达到 WORKSPACE_SCAN_FILE_CAP 而停止时为 true */
  truncated: boolean;
}

/**
 * 扁平列出 rootDir 下的文件（BFS，最多 WORKSPACE_SCAN_FILE_CAP 个），按 mtime
 * 倒序返回——最近改过的更可能是用户想附加的。只读目录项与文件元数据，不读内容：
 * 一个 3GB 的视频和一行的 txt 在这里的成本相同。
 */
export async function scanWorkspaceFiles(
  rootDir: string,
): Promise<WorkspaceScanResult> {
  const collected: Array<WorkspaceFileEntry & { mtime: number }> = [];
  const queue: string[] = [""];
  let visitedDirs = 0;
  let truncated = false;

  while (
    queue.length > 0 &&
    !truncated &&
    visitedDirs < WORKSPACE_SCAN_DIR_CAP
  ) {
    const relDir = queue.shift() as string;
    const absDir = relDir ? path.join(rootDir, relDir) : rootDir;
    visitedDirs += 1;

    let entries;
    try {
      entries = await readdir(absDir, { withFileTypes: true });
    } catch {
      // 无权限或扫描期间被删除：跳过这个目录，不影响其余结果
      continue;
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) queue.push(relPath);
        continue;
      }
      if (!entry.isFile()) continue; // 符号链接等一律跳过，顺便避免目录环
      // 真正的截断只发生在这里：还有条目没处理但已经到顶。
      if (collected.length >= WORKSPACE_SCAN_FILE_CAP) {
        truncated = true;
        break;
      }

      try {
        const info = await stat(path.join(absDir, entry.name));
        collected.push({ relPath, size: info.size, mtime: info.mtimeMs });
      } catch {
        // 扫描期间被删除：跳过
      }
    }
  }

  // 目录数到顶时也还剩没进过的目录，同样属于「未覆盖全部」。
  if (visitedDirs >= WORKSPACE_SCAN_DIR_CAP && queue.length > 0) {
    truncated = true;
  }

  collected.sort((a, b) => b.mtime - a.mtime);

  return {
    files: collected.map(({ relPath, size }) => ({ relPath, size })),
    truncated,
  };
}
