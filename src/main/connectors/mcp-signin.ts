/**
 * 远程 MCP 的 OAuth 授权流程。
 *
 * **为什么这活是我们干**：SDK 没导出 `signInMcpServer`，但它**公开**了
 * `@earendil-works/pi-mcp/oauth` 子路径（`package.json` 里明确开的门），
 * 里面有全套原语 —— discovery / 动态注册 / PKCE / 回环回调 / 换 token。
 * 我们只是把它们按顺序串起来，不自己实现协议。
 *
 * 凭据落在 `<agentDir>/mcp-auth.json`，形状由公开类型 `McpOAuthState` 定义。
 * SDK 的 `credentials` 注入点用它的默认实现（class 且带 private 字段，结构性不可替换），
 * 所以我们只按公开形状读它、只删自己那个 key。
 *
 * **token 永不出本机** —— 这是相对平台托管路线的明确产品优势（spec D9）。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import {
  McpOAuthProvider,
  OAuthCallbackServer,
  authorizeMcp,
  type McpOAuthState,
} from "@earendil-works/pi-mcp/oauth";
import type { ActionResult } from "../../shared/connectors";
import lockfile from "proper-lockfile";
import { log, logError } from "../utils/logger";

/** SDK 默认凭据存储的位置。 */
export function credentialsPath(agentDir: string): string {
  return path.join(agentDir, "mcp-auth.json");
}

/**
 * 读凭据。`unreadable` = 文件存在但读不出来（损坏 / 被并发写坏）。
 * 此时调用方**不能**写入，否则会把其他 server 的 token 一并抹掉。
 */
export function readCredentialsResult(agentDir: string): {
  data: Record<string, McpOAuthState>;
  unreadable: boolean;
} {
  let text: string;
  try {
    text = fs.readFileSync(credentialsPath(agentDir), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return { data: {}, unreadable: false };
    }
    return { data: {}, unreadable: true };
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return { data: {}, unreadable: true };
    }
    return { data: parsed as Record<string, McpOAuthState>, unreadable: false };
  } catch {
    return { data: {}, unreadable: true };
  }
}

export function readCredentials(
  agentDir: string,
): Record<string, McpOAuthState> {
  return readCredentialsResult(agentDir).data;
}

const CREDENTIALS_WRITE_OPTIONS = { encoding: "utf8" as const, mode: 0o600 };

/** 原子写：先写 .tmp 再 rename，避免读到写了一半的文件。 */
function writeCredentialsAtomically(
  file: string,
  data: Record<string, McpOAuthState>,
): void {
  const tmpPath = `${file}.tmp`;
  fs.writeFileSync(
    tmpPath,
    `${JSON.stringify(data, null, 2)}\n`,
    CREDENTIALS_WRITE_OPTIONS,
  );
  fs.chmodSync(tmpPath, 0o600);
  fs.renameSync(tmpPath, file);
}

export function writeCredentials(
  agentDir: string,
  data: Record<string, McpOAuthState>,
): void {
  const file = credentialsPath(agentDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeCredentialsAtomically(file, data);
}

/**
 * 在排他锁内做「读 → 改 → 写」。
 *
 * 为什么必须加锁：这个文件同时被 SDK 的 `McpOAuthCredentialStore`（401 后刷新 token）
 * 和我们（用户点连接/断开）改。SDK 用 `proper-lockfile` 锁**同一个路径**
 * （`FileAuthStorageBackend.acquireLockSyncWithRetry`），所以这里锁同一路径才能互斥。
 * 不加锁的话，并发刷新期间我们的整文件写回会覆盖掉 SDK 刚刷出来的新 token ——
 * 而很多服务会轮换 refresh token，覆盖等于登录失效。
 *
 * 锁参数与 SDK 对齐（stale 30s），避免持锁期间读到锁超时。
 */
async function withCredentialsLock<T>(
  agentDir: string,
  fn: (data: Record<string, McpOAuthState>) => T,
): Promise<T> {
  const file = credentialsPath(agentDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, "{}\n", CREDENTIALS_WRITE_OPTIONS);
  }

  let release: (() => Promise<void>) | undefined;
  try {
    // 重试要够密够久：并发的 token 刷新 + 用户操作会同时抢锁，
    // 抢不到就抛错的话，用户会看到莫名其妙的「连接失败」。
    release = await lockfile.lock(file, {
      realpath: false,
      stale: 30000,
      retries: { retries: 50, factor: 1, minTimeout: 20, maxTimeout: 100 },
    });
    const { data, unreadable } = readCredentialsResult(agentDir);
    // 损坏时不写：那会把其他 server 的 token 一起抹掉
    if (unreadable)
      throw new Error(`cannot parse ${file}; refusing to overwrite`);
    return fn(data);
  } finally {
    await release?.();
  }
}

/** 加锁地改凭据。`fn` 收到的 data 可以直接改，返回值决定是否写回。 */
export async function modifyCredentialsLocked(
  agentDir: string,
  fn: (data: Record<string, McpOAuthState>) => boolean,
): Promise<boolean> {
  return withCredentialsLock(agentDir, (data) => {
    const shouldWrite = fn(data);
    if (shouldWrite)
      writeCredentialsAtomically(credentialsPath(agentDir), data);
    return shouldWrite;
  });
}

/**
 * 只删属于这个 server URL 的 key，不动别人的。
 *
 * 断开**必须**做这一步：只删配置不删凭据的话，用户重新添加时会静默复用旧 token，
 * 看起来「没连却已连」（spec §7.2）。
 */
export async function removeCredentials(
  agentDir: string,
  serverUrl: string,
): Promise<boolean> {
  let key: string;
  try {
    key = String(new URL(serverUrl));
  } catch {
    key = serverUrl;
  }
  try {
    return await modifyCredentialsLocked(agentDir, (data) => {
      if (!(key in data)) return false;
      delete data[key];
      return true;
    });
  } catch (e) {
    // 文件损坏时不写：那会把其他 server 的 token 一起抹掉
    logError(`[connectors] could not remove credentials for ${serverUrl}`, e);
    return false;
  }
}

export interface SignInOptions {
  agentDir: string;
  serverUrl: string;
  /** 由调用方注入：在 DeskBand 窗口或系统浏览器里打开授权页。 */
  openAuthorizationUrl: (url: string) => void;
  /** 覆盖回调等待时长（毫秒），默认 5 分钟。 */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * 正在等待用户授权的回调服务器，按 server URL 索引。
 *
 * 授权要等用户在浏览器里点「批准」，最长等到超时（默认 5 分钟）。没有这个表，
 * 用户就没有任何办法中止 —— 界面只能干等，看起来就是「卡住且无法取消」。
 */
const pendingSignIns = new Map<
  string,
  { controller: AbortController; callback?: OAuthCallbackServer }
>();

/** 中止某个 server 正在进行的授权。返回 false 表示当前没有在等它。 */
export function cancelSignIn(serverUrl: string): boolean {
  let key: string;
  try {
    key = String(new URL(serverUrl));
  } catch {
    key = serverUrl;
  }
  const pending = pendingSignIns.get(key);
  if (!pending) return false;
  pending.controller.abort();
  // 同时中止网络请求与回调等待；监听器尚未启动时也能登记取消。
  void pending.callback?.close().catch(() => {});
  return true;
}

/**
 * 走完整授权码流程。成功时 token 已写入 `<agentDir>/mcp-auth.json`。
 *
 * 步骤：discovery → 动态客户端注册 → PKCE → 起回环回调 → 打开浏览器
 *      → 回调拿 code → 换 token。
 */
export async function startSignIn(opts: SignInOptions): Promise<ActionResult> {
  const { agentDir, serverUrl, openAuthorizationUrl } = opts;
  const url = String(new URL(serverUrl));
  if (pendingSignIns.has(url)) {
    return { ok: false, error: "sign-in already in progress" };
  }
  // 在第一个 await 之前占位，避免重复请求覆盖彼此的回调服务器。
  const pending: {
    controller: AbortController;
    callback?: OAuthCallbackServer;
  } = {
    controller: new AbortController(),
  };
  pendingSignIns.set(url, pending);
  const signal = pending.controller.signal;
  const oauthFetch = (input: string | URL, init?: RequestInit) =>
    fetch(input, {
      ...init,
      signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal,
    });

  let callback: OAuthCallbackServer | undefined;
  try {
    // 复用上次注册的回环端口：授权服务器里登记的 redirect_uri 含端口，
    // 换端口会让它拒绝请求，回调永远不触发（SDK 的 signInMcpServer 同样这么做）。
    // 同时清掉残留的 oauthState —— 旧的 state 会让新一代请求对不上。
    const stored = readCredentials(agentDir)[url];
    // OAuthClientInformationMixed 是联合类型：只有 Full 变体带 redirect_uris
    const registeredRedirect =
      stored?.clientInformation && "redirect_uris" in stored.clientInformation
        ? stored.clientInformation.redirect_uris?.[0]
        : undefined;
    const preferredPort = registeredRedirect
      ? Number(new URL(registeredRedirect).port) || undefined
      : undefined;

    callback = await OAuthCallbackServer.listen({
      path: "/callback",
      timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      ...(preferredPort ? { port: preferredPort } : {}),
    });
    pending.callback = callback;
    signal.throwIfAborted();

    // 本次的 redirect_uri 与已注册的不一致 → 之前登记的客户端作废，必须重新注册。
    // 顺带清掉残留的 oauthState（旧的 state 会让新一代请求对不上）。
    // 走锁改，避免与 SDK 的 token 刷新互相覆盖。
    const staleRedirect =
      !!stored &&
      !!registeredRedirect &&
      registeredRedirect !== callback.redirectUrl;
    if (staleRedirect || stored?.oauthState) {
      await modifyCredentialsLocked(agentDir, (data) => {
        signal.throwIfAborted();
        const current = data[url];
        if (!current) return false;
        const next = { ...current };
        if (staleRedirect) {
          delete next.clientInformation;
          delete next.tokens;
          delete next.tokensExpireAt;
        }
        delete next.oauthState;
        data[url] = next;
        return true;
      });
    }

    let authorizationUrl: string | undefined;

    const provider = new McpOAuthProvider({
      serverUrl: url,
      redirectUrl: callback.redirectUrl,
      clientMetadata: { client_name: "DeskWand" },
      store: {
        load: () => readCredentials(agentDir)[url],
        // 走锁写：SDK 的刷新可能同时在改同一个文件，
        // 整文件覆盖会把刚刷出来的 token 抹掉（refresh token 轮换后等于登录失效）。
        save: async (next) => {
          signal.throwIfAborted();
          await modifyCredentialsLocked(agentDir, (data) => {
            signal.throwIfAborted();
            data[url] = { ...next, serverUrl: url };
            return true;
          });
        },
      },
      onRedirect: (redirect) => {
        signal.throwIfAborted();
        authorizationUrl = redirect.toString();
      },
    });

    const first = await authorizeMcp(provider, {
      serverUrl: url,
      fetch: oauthFetch,
    });
    signal.throwIfAborted();
    if (first === "AUTHORIZED") {
      log(`[connectors] ${url} authorized from stored tokens`);
      return { ok: true };
    }

    if (!authorizationUrl) {
      return { ok: false, error: "OAuth flow produced no authorization URL" };
    }

    openAuthorizationUrl(authorizationUrl);

    const oauthState = await provider.state();
    signal.throwIfAborted();
    const callbackResult = await callback.waitForCallback(oauthState);
    signal.throwIfAborted();

    await authorizeMcp(provider, {
      serverUrl: url,
      authorizationCode: callbackResult.code,
      // RFC 9207：把授权响应里的 iss 原样转发。上游 1.1.0 起
      // authorization_response_iss_parameter_supported 为 true 时，iss 缺失会抛
      // OAuthIssuerMismatchError（旧版 0.99.1 完全没有这个校验）。
      iss: callbackResult.iss,
      fetch: oauthFetch,
    });
    signal.throwIfAborted();

    log(`[connectors] signed in to ${url}`);
    return { ok: true };
  } catch (e) {
    if (signal.aborted) return { ok: false, cancelled: true };
    logError(`[connectors] sign-in failed for ${serverUrl}`, e);
    return { ok: false, error: (e as Error).message };
  } finally {
    await callback?.close().catch(() => {});
    if (pendingSignIns.get(url) === pending) pendingSignIns.delete(url);
  }
}
