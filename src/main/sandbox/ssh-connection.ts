import { createHash } from "crypto";
import {
  Client,
  type ClientChannel,
  type FileEntryWithStats,
  type SFTPWrapper,
  type Stats,
} from "ssh2";
import { log, logWarn } from "../utils/logger";
import type {
  ExecutionResult,
  HostKeyDecision,
  KnownHostsStore,
  SshErrorCode,
} from "./types";
import { SshError } from "./types";

const OUTPUT_CAP = 10 * 1024 * 1024;

export { SshError };

export function sha256Fingerprint(key: Buffer): string {
  return `SHA256:${createHash("sha256")
    .update(key)
    .digest("base64")
    .replace(/=+$/, "")}`;
}

const DROP_ERROR = /Not connected|No response|Channel closed|ECONNRESET/i;

export interface SshSftp {
  stat(path: string): Promise<Stats>;
  readdir(path: string): Promise<FileEntryWithStats[]>;
  unlink(path: string): Promise<void>;
  mkdir(path: string, mode?: number): Promise<void>;
  createReadStream(path: string): NodeJS.ReadableStream;
  createWriteStream(path: string): NodeJS.WritableStream;
}

type CallbackMethod = (...args: unknown[]) => void;

function wrapSftp(raw: SFTPWrapper): SshSftp {
  const call = <T>(method: string, ...args: unknown[]): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const fn = (raw as unknown as Record<string, CallbackMethod>)[method];
      fn.call(raw, ...args, (err: Error | null, result: T) => {
        if (err) reject(err);
        else resolve(result);
      });
    });
  return {
    stat: (path) => call<Stats>("stat", path),
    readdir: (path) => call<FileEntryWithStats[]>("readdir", path),
    unlink: (path) => call<void>("unlink", path),
    mkdir: (path, mode = 0o755) => call<void>("mkdir", path, { mode }),
    createReadStream: (path) => raw.createReadStream(path),
    createWriteStream: (path) => raw.createWriteStream(path),
  };
}

export type SshAuth =
  | { kind: "key"; privateKey: string }
  | { kind: "password"; password: string };

export interface SshConnectionOptions {
  host: string;
  port: number;
  username: string;
  auth: SshAuth;
  knownHosts: KnownHostsStore;
}

function mapAuthError(err: Error, code: SshErrorCode | null): SshError {
  if (code) return new SshError(code, err.message);
  const message = err.message || "SSH connection failed";
  if (/ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|ENOTFOUND/i.test(message)) {
    return new SshError("SSH_HOST_UNREACHABLE", message);
  }
  if (/authentication|All configured/i.test(message)) {
    return new SshError("SSH_AUTH_FAILED", message);
  }
  if (
    /Not connected|No response|Connection lost|Channel closed/i.test(message)
  ) {
    return new SshError("SSH_DISCONNECTED", message);
  }
  return new SshError("SSH_UNKNOWN", message);
}

export class SshConnection {
  private client: Client | null = null;
  private sftpSession: unknown = null;
  private connecting: Promise<void> | null = null;
  private hostKeyStatus: HostKeyDecision | null = null;
  private currentFingerprint = "";
  private closed = false;

  constructor(private readonly options: SshConnectionOptions) {}

  get isConnected(): boolean {
    return this.client !== null;
  }

  /** close() 之后连接作废；连接池据此淘汰旧条目。 */
  get isClosed(): boolean {
    return this.closed;
  }

  get fingerprint(): string {
    return this.currentFingerprint;
  }

  async ensureConnected(): Promise<void> {
    if (this.closed) {
      throw new SshError("SSH_DISCONNECTED", "connection closed");
    }
    if (this.client) return;
    if (!this.connecting) {
      this.connecting = this.open().finally(() => {
        this.connecting = null;
      });
    }
    await this.connecting;
  }

  private open(): Promise<void> {
    const { host, port, username, auth, knownHosts } = this.options;
    this.hostKeyStatus = null;
    return new Promise((resolve, reject) => {
      const client = new Client();
      client.on("ready", () => {
        this.client = client;
        resolve();
      });
      client.on("error", (err: Error) => {
        this.reset();
        logWarn("[SSH] connection error:", host, err.message);
        reject(mapAuthError(err, this.hostKeyErrorCode()));
      });
      client.on("close", () => {
        this.reset();
      });
      client.connect({
        host,
        port,
        username,
        readyTimeout: 15000,
        keepaliveInterval: 15000,
        keepaliveCountMax: 3,
        ...(auth.kind === "key"
          ? { privateKey: auth.privateKey }
          : { password: auth.password }),
        hostVerifier: (key: Buffer) => {
          const fingerprint = sha256Fingerprint(key);
          const decision = knownHosts.check(host, port, fingerprint);
          this.currentFingerprint = fingerprint;
          this.hostKeyStatus = decision;
          log(`[SSH] host key ${fingerprint} -> ${decision}`);
          // 只有已确认过的指纹才放行：unknown 必须先由用户核对
          return decision === "trusted";
        },
      });
    });
  }

  private hostKeyErrorCode(): SshErrorCode | null {
    if (this.hostKeyStatus === "unknown") return "SSH_HOST_KEY_UNKNOWN";
    if (this.hostKeyStatus === "mismatch") return "SSH_HOST_KEY_MISMATCH";
    return null;
  }

  /**
   * SFTP 会话。读/写/列目录都经过这里：断线后重连一次再重试，
   * 与 exec 的重试语义保持一致（spec §8.5）。
   */
  async sftp(): Promise<SshSftp> {
    // 流式 API 是同步的，先把会话建好，调用方才能直接拿到 createReadStream
    await this.rawSftp();
    const run = async <T>(
      method: keyof SshSftp,
      ...args: unknown[]
    ): Promise<T> => {
      const call = async (): Promise<T> => {
        const session = await this.rawSftp();
        const fn = session[method] as (...params: unknown[]) => unknown;
        return (await fn.apply(session, args)) as T;
      };
      try {
        return await call();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!DROP_ERROR.test(message)) throw error;
        this.reset();
        return await call();
      }
    };

    return {
      stat: (path) => run("stat", path),
      readdir: (path) => run("readdir", path),
      unlink: (path) => run("unlink", path),
      mkdir: (path, mode = 0o755) => run("mkdir", path, mode),
      createReadStream: (path) => this.sftpSessionStream(path, "read"),
      createWriteStream: (path) => this.sftpSessionStream(path, "write"),
    };
  }

  private sftpSessionStream(
    path: string,
    mode: "read" | "write",
  ): NodeJS.ReadableStream & NodeJS.WritableStream {
    const session = this.sftpSession as {
      createReadStream?: (p: string) => NodeJS.ReadableStream;
      createWriteStream?: (p: string) => NodeJS.WritableStream;
    } | null;
    if (!session) {
      throw new SshError("SSH_DISCONNECTED", "sftp session is not ready");
    }
    return mode === "read"
      ? (session.createReadStream?.(path) as NodeJS.ReadableStream &
          NodeJS.WritableStream)
      : (session.createWriteStream?.(path) as NodeJS.ReadableStream &
          NodeJS.WritableStream);
  }

  private async rawSftp(): Promise<{
    stat: (path: string) => Promise<unknown>;
    readdir: (path: string) => Promise<unknown>;
    unlink: (path: string) => Promise<void>;
    mkdir: (path: string, mode?: number) => Promise<void>;
    createReadStream: (path: string) => NodeJS.ReadableStream;
    createWriteStream: (path: string) => NodeJS.WritableStream;
  }> {
    await this.ensureConnected();
    if (!this.sftpSession) {
      const client = this.client;
      if (!client) throw new SshError("SSH_DISCONNECTED", "not connected");
      const raw = await new Promise<SFTPWrapper>((resolve, reject) => {
        client.sftp((err, sftp) => {
          if (err) reject(new SshError("SSH_UNKNOWN", err.message));
          else resolve(sftp);
        });
      });
      this.sftpSession = wrapSftp(raw);
    }
    return this.sftpSession as ReturnType<typeof wrapSftp>;
  }

  async exec(command: string, timeoutMs = 120000): Promise<ExecutionResult> {
    try {
      return await this.execOnce(command, timeoutMs);
    } catch (error) {
      // 断线后重连一次；二次失败不再重试，避免工具调用挂死。
      if (!(error instanceof SshError) || error.code !== "SSH_DISCONNECTED") {
        throw error;
      }
      this.reset();
      await this.ensureConnected();
      return this.execOnce(command, timeoutMs);
    }
  }

  private reset(): void {
    this.client = null;
    this.sftpSession = null;
  }

  private async execOnce(
    command: string,
    timeoutMs: number,
  ): Promise<ExecutionResult> {
    await this.ensureConnected();
    const client = this.client;
    if (!client) throw new SshError("SSH_DISCONNECTED", "not connected");
    return new Promise((resolve, reject) => {
      client.exec(command, (err, stream: ClientChannel) => {
        if (err) {
          reject(new SshError("SSH_DISCONNECTED", err.message));
          return;
        }
        let stdout = "";
        let stderr = "";
        let exitCode: number | null = null;
        let settled = false;
        const finish = (code: number, extra = "") => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve({
            success: code === 0,
            stdout:
              stdout.length > OUTPUT_CAP
                ? `${stdout.slice(0, OUTPUT_CAP)}\n[output truncated]`
                : stdout,
            stderr:
              stderr.length > OUTPUT_CAP
                ? `${stderr.slice(0, OUTPUT_CAP)}\n[output truncated]${extra}`
                : `${stderr}${extra}`,
            exitCode: code,
          });
        };
        const timer = setTimeout(() => {
          try {
            stream.signal("KILL");
          } catch {
            /* remote may not support signals */
          }
          finish(124, `\ncommand timed out after ${timeoutMs}ms`);
          try {
            stream.close();
          } catch {
            /* already closed */
          }
        }, timeoutMs);
        stream.on("data", (chunk: Buffer) => {
          if (stdout.length < OUTPUT_CAP + 1) stdout += chunk.toString("utf8");
        });
        stream.stderr.on("data", (chunk: Buffer) => {
          if (stderr.length < OUTPUT_CAP + 1) stderr += chunk.toString("utf8");
        });
        stream.on("exit", (code: number | null) => {
          exitCode = typeof code === "number" ? code : null;
        });
        stream.on("close", () => {
          finish(exitCode ?? 0);
        });
      });
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    const client = this.client;
    this.reset();
    if (!client) return;
    await new Promise<void>((resolve) => {
      client.once("close", () => resolve());
      client.end();
    });
  }
}
