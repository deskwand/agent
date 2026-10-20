import { posix } from "path";

export class SshPathGuard {
  private readonly root: string;

  constructor(root: string) {
    this.root = posix.normalize(root);
  }

  assertInside(target: string): string {
    const normalized = posix.normalize(target);
    const insideRoot =
      this.root === "/" ||
      normalized === this.root ||
      normalized.startsWith(`${this.root}/`);
    if (!insideRoot) {
      throw new Error(`Path is outside workspace: ${normalized}`);
    }
    return normalized;
  }
}
