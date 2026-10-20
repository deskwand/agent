import { posix } from "path";

export function remoteJoinInsideRoot(root: string, target: string): string {
  const normalizedRoot = posix.normalize(root);
  const joined = target.startsWith("/")
    ? posix.normalize(target)
    : posix.normalize(posix.join(normalizedRoot, target));
  if (joined !== normalizedRoot && !joined.startsWith(`${normalizedRoot}/`)) {
    throw new Error(`Path is outside workspace: ${joined}`);
  }
  return joined;
}
