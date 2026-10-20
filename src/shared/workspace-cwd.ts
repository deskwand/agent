export type WorkspaceCwd =
  | { kind: "local"; path: string }
  | { kind: "ssh"; hostId: string; path: string };

const SSH_PREFIX = "ssh://";

export function parseWorkspaceCwd(cwd: string): WorkspaceCwd {
  const trimmed = cwd.trim();
  if (!trimmed.startsWith(SSH_PREFIX)) return { kind: "local", path: trimmed };
  const rest = trimmed.slice(SSH_PREFIX.length);
  const slash = rest.indexOf("/");
  const hostId = slash > 0 ? rest.slice(0, slash) : "";
  const rawPath = slash > 0 ? rest.slice(slash) : "";
  if (!hostId || !rawPath) throw new Error(`Invalid ssh workspace: ${cwd}`);
  if (rawPath.split("/").includes("..")) {
    throw new Error(`Invalid ssh workspace: ${cwd}`);
  }
  const normalized = normalizePosixPath(rawPath);
  const trimmedPath =
    normalized.length > 1 && normalized.endsWith("/")
      ? normalized.slice(0, -1)
      : normalized;
  if (!trimmedPath.startsWith("/")) {
    throw new Error(`Invalid ssh workspace: ${cwd}`);
  }
  return { kind: "ssh", hostId, path: trimmedPath };
}

export function toSshWorkspace(hostId: string, remotePath: string): string {
  if (!hostId || hostId.includes("/")) {
    throw new Error(`Invalid ssh host id: ${hostId}`);
  }
  if (!remotePath.startsWith("/")) {
    throw new Error(`Remote path must be absolute: ${remotePath}`);
  }
  return `${SSH_PREFIX}${hostId}${normalizePosixPath(remotePath)}`;
}

export function formatWorkspaceCwd(cwd: string, hostLabel?: string): string {
  const parsed = parseWorkspaceCwd(cwd);
  return parsed.kind === "ssh"
    ? `${hostLabel ?? parsed.hostId}:${parsed.path}`
    : parsed.path;
}

/**
 * POSIX 路径归一化，语义对齐 `path.posix.normalize`，但不依赖 Node 内建模块。
 *
 * 这个文件同时被 main 和 renderer 引用，renderer 里 `import "path"` 会被 Vite
 * 换成浏览器 stub，然后 `posix` 导出为 undefined，运行时才炸（构建期只是警告）。
 * 远程路径全是 POSIX，这里只需要纯字符串实现。
 */
function normalizePosixPath(input: string): string {
  const isAbsolute = input.startsWith("/");
  const keepTrailingSlash = input.length > 1 && input.endsWith("/");
  const segments: string[] = [];
  for (const segment of input.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.length > 0 && segments[segments.length - 1] !== "..") {
        segments.pop();
      } else if (!isAbsolute) {
        segments.push("..");
      }
      continue;
    }
    segments.push(segment);
  }
  let normalized = `${isAbsolute ? "/" : ""}${segments.join("/")}`;
  if (keepTrailingSlash && normalized !== "/") normalized += "/";
  return normalized === "" ? "." : normalized;
}
