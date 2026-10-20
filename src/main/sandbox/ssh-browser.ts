import { posix } from "path";
import type { SshDirEntry } from "./types";

export interface BrowseConnection {
  sftp(): Promise<unknown>;
}

interface SftpListing {
  realpath(path: string): Promise<string>;
  readdir(
    path: string,
  ): Promise<
    Array<{ filename: string; attrs: { isDirectory(): boolean; size: number } }>
  >;
}

export async function browseRemote(
  connection: BrowseConnection,
  requested?: string,
): Promise<{ path: string; parent: string | null; entries: SshDirEntry[] }> {
  const sftp = (await connection.sftp()) as SftpListing;
  const base = requested ?? (await sftp.realpath("."));
  if (!base.startsWith("/")) throw new Error("Path must be absolute");
  if (base.split("/").includes("..")) {
    throw new Error("Path traversal is not allowed");
  }
  const target = posix.normalize(base);
  const entries = (await sftp.readdir(target))
    .map((entry) => ({
      name: entry.filename,
      isDir: entry.attrs.isDirectory(),
      size: entry.attrs.size,
    }))
    .sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  return {
    path: target,
    parent: target === "/" ? null : posix.dirname(target),
    entries,
  };
}
