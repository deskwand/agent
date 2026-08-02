import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import lockfile from "proper-lockfile";
import type {
  Credential,
  CredentialInfo,
  CredentialStore,
} from "@earendil-works/pi-ai";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import { logWarn } from "../utils/logger";

/**
 * OAuth token 新鲜度检测（旧 shared-auth 逻辑恢复）。
 *
 * OpenAI Codex 等 OAuth 服务端会按签发时间（iat）轮换/撤销 access token，
 * 而 SDK 只检查 expires 时间戳——撤销后的 token 仍会被使用导致偶发 401。
 * 这里在每次读取凭证时按 1 小时阈值主动刷新并写回 auth.json。
 */
const TOKEN_REFRESH_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

/** 模块级刷新去重：同一 provider 并发只刷新一次（旧 shared-auth 逻辑）。 */
const pendingRefreshes = new Map<string, Promise<Credential | undefined>>();

const AUTH_FILE_WRITE_OPTIONS = { encoding: "utf-8" as const, mode: 0o600 };

function extractJwtIat(token: string): number | undefined {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return undefined;
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    );
    return typeof payload.iat === "number" ? payload.iat : undefined;
  } catch {
    return undefined;
  }
}

/**
 * auth.json 持久化 store。会话级 ModelRuntime 共用同一文件，
 * 写入经 proper-lockfile 保护，避免与 SDK 内部读写竞争。
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
    return this.withLockAsync(
      async (current) => this.parse(current)[providerId],
    );
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
      writeFileSync(
        this.authPath,
        JSON.stringify(data, null, 2),
        AUTH_FILE_WRITE_OPTIONS,
      );
      chmodSync(this.authPath, 0o600);
      return next;
    });
  }

  async delete(providerId: string): Promise<void> {
    await this.withLockAsync(async (current) => {
      const data = this.parse(current);
      delete data[providerId];
      writeFileSync(
        this.authPath,
        JSON.stringify(data, null, 2),
        AUTH_FILE_WRITE_OPTIONS,
      );
    });
  }

  async list(): Promise<readonly CredentialInfo[]> {
    return this.withLockAsync(async (current) =>
      Object.entries(this.parse(current)).map(([providerId, cred]) => ({
        providerId,
        type: cred?.type ?? "api_key",
      })),
    );
  }
}

async function doRefresh(
  providerId: string,
  credential: Credential,
  inner: CredentialStore,
): Promise<Credential | undefined> {
  try {
    const provider = builtinProviders().find((p) => p.id === providerId);
    const oauth = provider?.auth?.oauth;
    if (!oauth?.refresh) {
      return credential;
    }
    const refreshed = await oauth.refresh(credential as never);
    await inner.modify(providerId, async () => refreshed as Credential);
    return refreshed as Credential;
  } catch (error) {
    // 刷新失败 — fall back to existing token（旧逻辑）
    logWarn(
      `[OAuth] Token refresh failed for ${providerId}, using existing token:`,
      error,
    );
    return credential;
  }
}

function refreshWithDedupe(
  providerId: string,
  credential: Credential,
  inner: CredentialStore,
): Promise<Credential | undefined> {
  const pending = pendingRefreshes.get(providerId);
  if (pending) return pending;
  const promise = doRefresh(providerId, credential, inner);
  pendingRefreshes.set(providerId, promise);
  void promise.finally(() => {
    if (pendingRefreshes.get(providerId) === promise) {
      pendingRefreshes.delete(providerId);
    }
  });
  return promise;
}

/**
 * 构造带 1 小时 token 新鲜度检测的 CredentialStore。
 * read() 时检查 OAuth access token 的签发时间（iat），超 1 小时主动刷新。
 */
export function createFreshOAuthCredentialStore(
  authPath: string,
): CredentialStore {
  const inner = new AuthJsonCredentialStore(authPath);

  return {
    async read(providerId: string): Promise<Credential | undefined> {
      const credential = await inner.read(providerId);
      if (!credential || credential.type !== "oauth") {
        return credential;
      }
      const iat = extractJwtIat(credential.access);
      if (
        iat !== undefined &&
        Date.now() - iat * 1000 < TOKEN_REFRESH_THRESHOLD_MS
      ) {
        return credential;
      }
      // 签发超 1 小时（或无法解析 iat）——服务端可能已轮换/撤销
      return refreshWithDedupe(providerId, credential, inner);
    },
    list: () => inner.list(),
    modify: (providerId, fn) => inner.modify(providerId, fn),
    delete: (providerId) => inner.delete(providerId),
  };
}
