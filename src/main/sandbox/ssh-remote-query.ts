import { posix } from "path";
import type { SandboxExecutor } from "./types";
import { shQuote } from "./ssh-bootstrap";

export const REMOTE_SCAN_FILE_CAP = 2000;
const REMOTE_SCAN_DEPTH = 8;
const REMOTE_RESULT_CAP = 5000;

export async function scanRemoteWorkspace(
  executor: SandboxExecutor,
  rootDir: string,
): Promise<{
  files: Array<{ relPath: string; size: number }>;
  truncated: boolean;
}> {
  const ignored = ["node_modules", ".git", ".tmp"]
    .map((name) => `-name ${shQuote(name)} -prune -o`)
    .join(" ");
  const command = [
    `find ${shQuote(rootDir)} -maxdepth ${REMOTE_SCAN_DEPTH}`,
    ignored,
    `-type f -exec stat -c '%Y\\t%s\\t%n' {} +`,
    `| head -n ${REMOTE_SCAN_FILE_CAP + 1}`,
  ].join(" ");
  const result = await executor.executeCommand(command);
  const rows = result.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [mtime, size, ...rest] = line.split("\t");
      const absolute = rest.join("\t");
      const relPath = absolute.startsWith(`${rootDir}/`)
        ? absolute.slice(rootDir.length + 1)
        : posix.relative(rootDir, absolute);
      return {
        relPath,
        size: Number(size) || 0,
        mtime: Number(mtime) || 0,
      };
    });
  const truncated = rows.length > REMOTE_SCAN_FILE_CAP;
  const files = rows
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, REMOTE_SCAN_FILE_CAP)
    .map(({ relPath, size }) => ({ relPath, size }));
  return { files, truncated };
}

export async function globRemote(
  executor: SandboxExecutor,
  rootDir: string,
  pattern: string,
): Promise<string[]> {
  const inner = `shopt -s globstar nullglob; cd ${shQuote(rootDir)} && printf '%s\\n' ${pattern}`;
  const fallback = `cd ${shQuote(rootDir)} && printf '%s\\n' ${pattern}`;
  const command = `bash -lc ${shQuote(inner)} || sh -c ${shQuote(fallback)}`;
  const result = await executor.executeCommand(command);
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, REMOTE_RESULT_CAP);
}

export async function grepRemote(
  executor: SandboxExecutor,
  rootDir: string,
  pattern: string,
): Promise<string> {
  const command = [
    "grep -rIn",
    "--exclude-dir=node_modules --exclude-dir=.git",
    `-- ${shQuote(pattern)} ${shQuote(rootDir)}`,
    `| head -n 50`,
  ].join(" ");
  const result = await executor.executeCommand(command);
  return result.stdout.trim() || "No matches found";
}
