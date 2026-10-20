import type {
  DirectoryEntry,
  ExecutionResult,
  SandboxConfig,
  SandboxExecutor,
} from "./types";
import { SshError } from "./types";
import type { SshConnection } from "./ssh-connection";
import { type SshSftp } from "./ssh-connection";
import { SshPathGuard } from "./ssh-path-guard";
import { shQuote } from "./ssh-bootstrap";

const MAX_READ_BYTES = 10 * 1024 * 1024;

export function buildRemoteCommand(
  command: string,
  cwd: string,
  env?: Record<string, string>,
): string {
  const exports = Object.entries(env ?? {})
    .map(([key, value]) => `export ${key}=${shQuote(value)}; `)
    .join("");
  return `cd ${shQuote(cwd)} && (${exports}${command})`;
}

export class SshExecutor implements SandboxExecutor {
  private readonly guard: SshPathGuard;
  private timeoutMs = 120000;

  constructor(
    private readonly connection: SshConnection,
    private readonly workspacePath: string,
  ) {
    this.guard = new SshPathGuard(workspacePath);
  }

  private async sftp(): Promise<SshSftp> {
    return this.connection.sftp();
  }

  async initialize(config: SandboxConfig): Promise<void> {
    this.timeoutMs = config.timeout ?? 120000;
    await this.connection.ensureConnected();
    const sftp = await this.sftp();
    try {
      const stat = await sftp.stat(config.workspacePath);
      if (!stat.isDirectory()) {
        throw new SshError("SSH_WORKSPACE_MISSING", "not a directory");
      }
    } catch (error) {
      if (error instanceof SshError) throw error;
      throw new SshError(
        "SSH_WORKSPACE_MISSING",
        `Workspace does not exist: ${config.workspacePath}`,
      );
    }
  }

  async executeCommand(
    command: string,
    cwd?: string,
    env?: Record<string, string>,
  ): Promise<ExecutionResult> {
    const dir = this.guard.assertInside(cwd ?? this.workspacePath);
    return this.connection.exec(
      buildRemoteCommand(command, dir, env),
      this.timeoutMs,
    );
  }

  async readFile(filePath: string): Promise<string> {
    const target = this.guard.assertInside(filePath);
    const sftp = await this.sftp();
    const chunks: Buffer[] = [];
    let total = 0;
    await new Promise<void>((resolve, reject) => {
      const stream = sftp.createReadStream(target);
      stream.on("data", (chunk: Buffer | string) => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += buf.length;
        if (total > MAX_READ_BYTES) {
          (stream as NodeJS.ReadableStream & { destroy: () => void }).destroy();
          reject(new Error("File too large (max 10MB)"));
          return;
        }
        chunks.push(buf);
      });
      stream.on("error", reject);
      stream.on("end", () => resolve());
    });
    return Buffer.concat(chunks).toString("utf8");
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    const target = this.guard.assertInside(filePath);
    const sftp = await this.sftp();
    await new Promise<void>((resolve, reject) => {
      const stream = sftp.createWriteStream(target);
      stream.on("error", reject);
      stream.on("close", () => resolve());
      stream.end(content);
    });
  }

  async listDirectory(dirPath: string): Promise<DirectoryEntry[]> {
    const target = this.guard.assertInside(dirPath);
    const sftp = await this.sftp();
    const entries = await sftp.readdir(target);
    return entries
      .map((entry) => ({
        name: entry.filename,
        isDirectory: entry.attrs.isDirectory(),
        size: entry.attrs.size,
      }))
      .sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }

  async fileExists(filePath: string): Promise<boolean> {
    const target = this.guard.assertInside(filePath);
    const sftp = await this.sftp();
    try {
      await sftp.stat(target);
      return true;
    } catch (error) {
      const code = (error as { code?: number }).code;
      if (code === 2) return false;
      throw error;
    }
  }

  async deleteFile(filePath: string): Promise<void> {
    const target = this.guard.assertInside(filePath);
    const sftp = await this.sftp();
    await sftp.unlink(target);
  }

  async createDirectory(dirPath: string): Promise<void> {
    const target = this.guard.assertInside(dirPath);
    const sftp = await this.sftp();
    const segments = target.split("/").filter(Boolean);
    let current = "";
    for (const segment of segments) {
      current = `${current}/${segment}`;
      try {
        await sftp.mkdir(current);
      } catch (error) {
        if ((error as { code?: number }).code !== 4) throw error;
      }
    }
  }

  async copyFile(src: string, dest: string): Promise<void> {
    const from = this.guard.assertInside(src);
    const to = this.guard.assertInside(dest);
    const sftp = await this.sftp();
    await new Promise<void>((resolve, reject) => {
      const read = sftp.createReadStream(from);
      const write = sftp.createWriteStream(to);
      read.on("error", reject);
      write.on("error", reject);
      write.on("close", () => resolve());
      read.pipe(write);
    });
  }

  async shutdown(): Promise<void> {
    await this.connection.close();
  }
}
