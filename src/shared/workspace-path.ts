import { isUncPath, isWindowsDrivePath } from "./local-file-path";

/** The directory name used by the app's default working directory (chats mode).
 *  Sessions whose cwd resolves to this directory should not be treated as project-mode. */
export const DEFAULT_WORKDIR_DIRNAME = "default_working_dir";

/** Build the path to the app's built-in default working directory given the userData path.
 *  Browser-safe — no Node.js `path` dependency. */
export function getDefaultWorkingDirPath(userDataPath: string): string {
  return joinRelativePath(userDataPath, DEFAULT_WORKDIR_DIRNAME);
}

export function resolvePathAgainstWorkspace(
  pathValue: string,
  workspacePath?: string | null,
): string {
  if (!pathValue) {
    return pathValue;
  }

  if (
    isWindowsDrivePath(pathValue) ||
    isUncPath(pathValue) ||
    pathValue.startsWith("/")
  ) {
    if (pathValue.startsWith("/workspace/")) {
      return workspacePath
        ? joinRelativePath(workspacePath, pathValue.slice("/workspace/".length))
        : pathValue;
    }
    if (/^[A-Za-z]:[/\\]workspace[/\\]/i.test(pathValue)) {
      const relativePart = pathValue.replace(
        /^[A-Za-z]:[/\\]workspace[/\\]/i,
        "",
      );
      return workspacePath
        ? joinRelativePath(workspacePath, relativePart)
        : pathValue;
    }
    return pathValue;
  }

  if (!workspacePath) {
    return pathValue;
  }

  return joinRelativePath(workspacePath, pathValue);
}

/**
 * Join base + relative path without Node.js `path` module (browser-safe).
 * Handles `.` and `..` segment normalization.
 */
function joinRelativePath(basePath: string, relativePath: string): string {
  const isWin = isWindowsDrivePath(basePath) || isUncPath(basePath);
  const sep = isWin ? "\\" : "/";

  const base = basePath.replace(/[/\\]+$/, "");
  const rel = relativePath.replace(/^[/\\]+/, "");
  const joined = `${base}${sep}${rel}`;

  // Normalize separators then resolve `.` / `..` segments
  const normalized = joined.replace(/[/\\]+/g, sep);
  const parts = normalized.split(sep);
  const resolved: string[] = [];

  // Determine the minimum number of parts that must remain to prevent
  // traversal above the path root:
  //   - UNC path  \\server\share  → splits to ['', '', 'server', 'share', …]
  //                                  floor = 4 (keep both empty + server + share)
  //   - Windows drive  C:\         → splits to ['C:', …]
  //                                  floor = 1
  //   - POSIX absolute /           → splits to ['', …]
  //                                  floor = 1
  const floor = isUncPath(basePath) ? 4 : 1;

  for (const part of parts) {
    if (part === ".") continue;
    if (part === ".." && resolved.length > floor) {
      resolved.pop();
    } else {
      resolved.push(part);
    }
  }

  const result = resolved.join(sep);

  // Post-resolve prefix check: ensure the path root prefix is preserved.
  // For POSIX paths the root is '/', for Windows drives it's 'X:', for UNC it's '\\\\server\\share'.
  const rootPrefix = isUncPath(basePath)
    ? parts.slice(0, 4).join(sep)
    : isWindowsDrivePath(basePath)
      ? parts[0] // e.g. 'C:'
      : ""; // POSIX: empty string is a valid prefix check; resolved always starts with '/'
  if (rootPrefix && !result.startsWith(rootPrefix)) {
    // Root prefix was stripped — traversal escaped the filesystem root; clamp to base
    return base;
  }

  return result;
}

/**
 * 把工作目录路径折成一个可比较的「项目键」。
 *
 * renderer 用它给侧边栏分组建键，main 用它匹配「删哪个项目的会话」——
 * 两边必须是同一个函数：一旦规则分叉，Windows 上大小写或分隔符一变就会出现
 * 「界面上是一个项目、删除只干掉一半」，剩下的会话让分组当场复活。
 *
 * Windows 盘符路径与 UNC 路径统一分隔符并折叠大小写；POSIX 路径只去尾部斜杠、
 * 保持大小写敏感（`/a` 与 `/A` 是两个目录）。
 */
export function toWorkspaceKey(cwd: string): string {
  const normalized = cwd.trim().replace(/[/\\]+$/, "");
  const isWindowsPath =
    /^[A-Za-z]:([\\/]|$)/.test(normalized) ||
    normalized.startsWith("\\\\") ||
    normalized.startsWith("//");
  return isWindowsPath
    ? normalized.replace(/\\/g, "/").toLowerCase()
    : normalized;
}
