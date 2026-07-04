import { isAbsolute, relative, resolve } from "path";

function normalizeGitPath(value: string): string {
  return value.replace(/\\/g, "/");
}

export function countChangedFilesFromPorcelain(stdout: string): number {
  const files = new Set<string>();

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line) continue;

    const payload = line.slice(3).trim();
    if (!payload) continue;

    const renamedParts = payload.split(" -> ");
    const path = renamedParts[renamedParts.length - 1] || payload;
    files.add(normalizeGitPath(path));
  }

  return files.size;
}

export function resolveWorkspacePath(cwd: string, filePath: string): string {
  return isAbsolute(filePath) ? filePath : resolve(cwd, filePath);
}

export function toRepoRelativePath(cwd: string, filePath: string): string {
  const absolutePath = resolveWorkspacePath(cwd, filePath);
  const repoRelativePath = relative(cwd, absolutePath);
  return normalizeGitPath(repoRelativePath);
}

export function partitionArtifactPaths(
  cwd: string,
  paths: string[],
  trackedRepoRelativePaths: Set<string>,
): {
  trackedRelativePaths: string[];
  untrackedAbsolutePaths: string[];
} {
  const trackedRelativePaths: string[] = [];
  const untrackedAbsolutePaths: string[] = [];

  for (const path of paths) {
    const absolutePath = resolveWorkspacePath(cwd, path);
    const repoRelativePath = toRepoRelativePath(cwd, absolutePath);

    if (
      repoRelativePath &&
      repoRelativePath !== "." &&
      trackedRepoRelativePaths.has(repoRelativePath)
    ) {
      trackedRelativePaths.push(repoRelativePath);
      continue;
    }

    untrackedAbsolutePaths.push(absolutePath);
  }

  return { trackedRelativePaths, untrackedAbsolutePaths };
}
