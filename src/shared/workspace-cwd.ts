import { posix } from "path";

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
  const normalized = posix.normalize(rawPath);
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
  return `${SSH_PREFIX}${hostId}${posix.normalize(remotePath)}`;
}

export function formatWorkspaceCwd(cwd: string, hostLabel?: string): string {
  const parsed = parseWorkspaceCwd(cwd);
  return parsed.kind === "ssh"
    ? `${hostLabel ?? parsed.hostId}:${parsed.path}`
    : parsed.path;
}
