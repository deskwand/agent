import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import lockfile from "proper-lockfile";
import type {
  Credential,
  CredentialInfo,
  CredentialStore,
} from "@earendil-works/pi-ai";

const AUTH_FILE_WRITE_OPTIONS = { encoding: "utf-8" as const, mode: 0o600 };

/**
 * OAuth 凭证持久化存储。
 *
 * 读路径无锁（原子写保证读到完整文件），写路径用 proper-lockfile
 * 排他锁串行化，避免并发刷新写回互相覆盖（OAuth refresh token 单次轮换）。
 */
class AuthJsonCredentialStore implements CredentialStore {
  private readonly authPath: string;

  constructor(authPath: string) {
    this.authPath = authPath;
    this.ensureFile();
  }

  private ensureFile(): void {
    const dir = dirname(this.authPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    if (!existsSync(this.authPath)) {
      writeFileSync(this.authPath, "{}", AUTH_FILE_WRITE_OPTIONS);
      chmodSync(this.authPath, 0o600);
    }
  }

  private readRaw(): string | undefined {
    return existsSync(this.authPath)
      ? readFileSync(this.authPath, "utf-8")
      : undefined;
  }

  /** 原子写：先写临时文件再 rename，读者无需加锁即可看到完整内容。 */
  private writeAtomically(content: string): void {
    const tmpPath = `${this.authPath}.tmp`;
    writeFileSync(tmpPath, content, AUTH_FILE_WRITE_OPTIONS);
    chmodSync(tmpPath, 0o600);
    renameSync(tmpPath, this.authPath);
  }

  private async withLockAsync<T>(
    fn: (current: string | undefined) => Promise<T>,
  ): Promise<T> {
    this.ensureFile();
    let release: (() => Promise<void>) | undefined;
    try {
      release = await lockfile.lock(this.authPath, {
        realpath: false,
        // 与 SDK 的 AuthStorage 锁参数对齐（stale 30s），避免持锁期间读锁超时
        stale: 30000,
        retries: {
          retries: 5,
          factor: 2,
          minTimeout: 50,
          maxTimeout: 2000,
        },
      });
      const current = existsSync(this.authPath)
        ? readFileSync(this.authPath, "utf-8")
        : undefined;
      return await fn(current);
    } finally {
      await release?.();
    }
  }

  private parse(current: string | undefined): Record<string, Credential> {
    if (!current) return {};
    try {
      return JSON.parse(current) as Record<string, Credential>;
    } catch {
      return {};
    }
  }

  async read(providerId: string): Promise<Credential | undefined> {
    return this.parse(this.readRaw())[providerId];
  }

  async modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
  ): Promise<Credential | undefined> {
    return this.withLockAsync(async (current) => {
      const data = this.parse(current);
      const next = await fn(data[providerId]);
      // 与 SDK AuthStorage.modify 语义一致：fn 返回 undefined 表示
      // “不写入”（并发刷新/登出竞态），保留原值，不得删除条目。
      if (next === undefined) {
        return data[providerId];
      }
      data[providerId] = next;
      this.writeAtomically(JSON.stringify(data, null, 2));
      return next;
    });
  }

  async delete(providerId: string): Promise<void> {
    await this.withLockAsync(async (current) => {
      const data = this.parse(current);
      delete data[providerId];
      this.writeAtomically(JSON.stringify(data, null, 2));
    });
  }

  async list(): Promise<readonly CredentialInfo[]> {
    return Object.entries(this.parse(this.readRaw())).map(
      ([providerId, credential]) => ({
        providerId,
        type: credential?.type ?? "api_key",
      }),
    );
  }
}

/**
 * auth.json 持久化 store。会话级 ModelRuntime 共用同一文件，
 * 写入经 proper-lockfile 保护并采用原子写（temp + rename）。
 *
 * OAuth token 刷新职责由 pi-ai 上游负责（expires 到期自动刷新），
 * 本 store 不感知 token 生命周期；401 恢复为上游缺失能力（见计划“上游跟踪”）。
 */
export function createAuthCredentialStore(authPath: string): CredentialStore {
  const inner = new AuthJsonCredentialStore(authPath);

  return {
    read: (providerId) => inner.read(providerId),
    list: () => inner.list(),
    modify: (providerId, fn) => inner.modify(providerId, fn),
    delete: (providerId) => inner.delete(providerId),
  };
}
