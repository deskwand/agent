/**
 * DeskBand 的 `McpTransport` 实现。
 *
 * 上游 `createDefaultTransport` 未从公开面导出，所以这里自己构造传输。但**不必自己写协议**：
 * pi-mcp 自带 `StdioTransport` 与 `StreamableHttpTransport`，后者直接接受 `authProvider`
 * （token 注入与 401 后刷新由它负责）。适配器的职责收敛为四件：
 *
 *  1. `start()` 前插 Chrome 就绪等待（DeskBend 特有；见 chrome-readiness.ts）
 *  2. 按自研 store 里的**原始 `type`** 选传输 —— 上游配置表达不了 SSE，所以 stdio 之外的
 *     区分只能靠回查 store
 *  3. 观测生命周期，维护 UI 需要的 per-server 状态表
 *  4. stdio 用 spawn 前的 env 组装（登录 shell 环境合并，否则 npx/uvx 类 server 找不到）
 *
 * 关于 OAuth 的一处关键事实（实现时核实）：pi-mcp 的 `AuthProvider`（`token()` /
 * `onUnauthorized()`）与 `@modelcontextprotocol/sdk` 的 `OAuthClientProvider` 是**两套不同的抽象**
 * —— 后者要求完整的 OAuth 客户端行为（动态注册、redirect、codeVerifier 等）。
 * 因此带 OAuth 的 HTTP 传输必须用 pi-mcp 自己的 `StreamableHttpTransport`，不能用 SDK 的。
 */
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { Transport as SdkTransport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type {
  AuthProvider,
  JsonRpcMessage,
  McpTransport,
} from "@earendil-works/pi-mcp";
import {
  StdioTransport,
  StreamableHttpTransport,
} from "@earendil-works/pi-mcp";
import type { McpServerEntry } from "@earendil-works/pi-coding-agent";
import { ensureChromeReady, mcpServerNeedsChrome } from "./chrome-readiness";
import { mcpConfigStore } from "./mcp-config-store";
import { getEnhancedEnv } from "./mcp-server-paths";
import { log, logWarn } from "../utils/logger";

/**
 * UI 用的状态集合。刻意**不含** `disconnected` / `closed`（上游那两个映射为 `connecting`），
 * 也不含 `disabled`（它由 store 的 `enabled: false` 直接给出，不属于传输状态）。
 */
export type McpServerState =
  | "connecting"
  | "connected"
  | "needs-auth"
  | "failed";

const states = new Map<string, McpServerState>();
/**
 * 活着的传输。退出时必须显式关掉 —— stdio server 是 spawn 出来的子进程，
 * 父进程退出**不会**自动回收（旧实现靠 `mcpManager.shutdown()` 做这件事，
 * 而内置扩展的传输只在会话结束时关闭，DeskBend 的退出路径并没有关会话）。
 */
const liveTransports = new Set<() => Promise<void>>();
const errors = new Map<string, string>();
const listeners = new Set<(name: string, state: McpServerState) => void>();

function setState(name: string, state: McpServerState, error?: string): void {
  if (states.get(name) === state && errors.get(name) === error) return;
  states.set(name, state);
  if (error === undefined) errors.delete(name);
  else errors.set(name, error);
  for (const listener of listeners) listener(name, state);
}

export function getMcpServerState(name: string): McpServerState | undefined {
  return states.get(name);
}

export function getMcpServerError(name: string): string | undefined {
  return errors.get(name);
}

export function onMcpStateChange(
  listener: (name: string, state: McpServerState) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 仅供测试：清空状态表与订阅。 */
export function resetMcpServerStatesForTest(): void {
  states.clear();
  errors.clear();
  listeners.clear();
  liveTransports.clear();
}

/**
 * 关闭所有由本适配器创建的传输（连带回收 stdio 子进程）。
 * 退出路径必须调用，否则 MCP server 子进程会成为孤儿。
 */
export async function closeAllDeskwandMcpTransports(): Promise<void> {
  const closers = [...liveTransports];
  liveTransports.clear();
  await Promise.allSettled(closers.map((close) => close()));
}

/** 自研 store 里的原始 type —— 上游配置表达不了 SSE，只能回查。 */
function resolveStoreType(
  serverName: string,
): "stdio" | "sse" | "streamable-http" {
  const server = mcpConfigStore
    .getServers()
    .find(
      (candidate) =>
        candidate.name.replace(/\s+/g, "_").replace(/__/g, "_") === serverName,
    );
  return server?.type ?? "stdio";
}

function isAuthRequiredError(error: unknown): boolean {
  const name = (error as { constructor?: { name?: string } })?.constructor
    ?.name;
  return (
    name === "McpAuthRequiredError" ||
    name === "McpSessionExpiredError" ||
    /401|unauthorized|invalid_token/i.test(
      error instanceof Error ? error.message : String(error),
    )
  );
}

/** 把 `@modelcontextprotocol/sdk` 的传输适配成 pi-mcp 的 `McpTransport`（SSE 用）。 */
function adaptSdkTransport(sdk: SdkTransport): McpTransport {
  return {
    start: () => sdk.start(),
    // 两套 SDK 的 JSON-RPC 类型名义不同、结构一致
    send: (message: JsonRpcMessage) =>
      sdk.send(message as unknown as Parameters<SdkTransport["send"]>[0]),
    close: () => sdk.close(),
    onMessage: (listener) => {
      sdk.onmessage = (message) => listener(message as JsonRpcMessage);
      return () => {
        sdk.onmessage = undefined;
      };
    },
    onError: (listener) => {
      sdk.onerror = (error) => listener(error);
      return () => {
        sdk.onerror = undefined;
      };
    },
    onClose: (listener) => {
      sdk.onclose = () => listener();
      return () => {
        sdk.onclose = undefined;
      };
    },
  };
}

export function createDeskwandTransport(
  entry: McpServerEntry,
  cwd: string,
  authProvider: AuthProvider | undefined,
): McpTransport {
  const name = entry.name;
  const storeType = resolveStoreType(name);
  const needsChrome = mcpServerNeedsChrome(name);

  let initializedId: string | number | undefined;
  // 上游 connect() 会调 transport.setProtocolVersion?.(negotiated)。StreamableHttpTransport
  // 用它发 MCP-Protocol-Version 头；不转发会让严格的远程 server 在 initialize 之后拒绝所有请求。
  let bufferedProtocolVersion: string | undefined;
  let stderrTail = "";
  let delegate: McpTransport | undefined;
  // McpClient 会在 start() 之前就注册监听器（实测），所以必须先缓存、待 delegate 建好再转发
  const pending = {
    message: [] as Array<(m: JsonRpcMessage) => void>,
    error: [] as Array<(e: Error) => void>,
    close: [] as Array<() => void>,
  };
  let unsubscribers: Array<() => void> = [];
  // 注意：旧客户端在 chrome-devtools-mcp 返回结构化 {error:true,message:"Not connected"}
  // 时会重连并重试一次。**该行为没有搬过来**，这是一次有意记录的损失：
  // 那个重试需要「吞掉首次响应 + 用新 id 重发 + 把响应 id 改回去」，而请求 id 的重写一旦出错
  // 会让上游永远等不到响应（比现在的行为更糟）。之所以不能沿用旧写法：在同一 id 下重发会被
  // 上游当作 unknown request 丢弃、且工具会被执行两次（有副作用）。
  // 上游的惰性重连覆盖「连接断开」那一类；这一类的补救留给模型自行重试。

  const httpConfig = "url" in entry.config ? entry.config : undefined;

  async function buildDelegate(): Promise<McpTransport> {
    if (httpConfig) {
      return new StreamableHttpTransport({
        url: httpConfig.url,
        ...(httpConfig.headers ? { headers: httpConfig.headers } : {}),
        ...(authProvider ? { authProvider } : {}),
      });
    }
    const stdioConfig = entry.config as {
      command: string;
      args?: readonly string[];
      cwd?: string;
      env?: Record<string, string>;
    };
    const env = await getEnhancedEnv(stdioConfig.env ?? {});
    return new StdioTransport({
      command: stdioConfig.command,
      args: [...(stdioConfig.args ?? [])],
      cwd: stdioConfig.cwd ?? cwd,
      env,
      // 上游用 `transport instanceof StdioTransport` 抓 stderr 尾，而它拿到的是我们的包装对象
      // → 那个检查永远为 false。所以我们自己抓，并在报错时带上（旧客户端会记录 stderr）。
      stderr: "pipe",
      onStderr: (chunk: string) => {
        stderrTail = `${stderrTail}${chunk}`.slice(-2000);
      },
    });
  }

  function handleMessage(
    listener: (m: JsonRpcMessage) => void,
    message: JsonRpcMessage,
  ): void {
    const response = message as { id?: string | number; error?: unknown };
    if (
      initializedId !== undefined &&
      response.id === initializedId &&
      response.error === undefined
    ) {
      setState(name, "connected");
      initializedId = undefined;
    }

    listener(message);
  }

  function handleError(listener: (e: Error) => void, error: Error): void {
    setState(
      name,
      isAuthRequiredError(error) ? "needs-auth" : "failed",
      error.message,
    );
    listener(error);
  }

  function handleClose(listener: () => void): void {
    // 上游的 disconnected / closed 都映射为 connecting（状态集合里没有它们）
    logWarn(`[MCP] connection closed for ${name}`);
    setState(name, "connecting");
    listener();
  }

  const transport: McpTransport = {
    async start(): Promise<void> {
      setState(name, "connecting");
      try {
        if (needsChrome) await ensureChromeReady(name);
        delegate =
          storeType === "sse" && httpConfig
            ? adaptSdkTransport(
                new SSEClientTransport(new URL(httpConfig.url), {
                  requestInit: httpConfig.headers
                    ? { headers: httpConfig.headers }
                    : undefined,
                }),
              )
            : await buildDelegate();
        // 转发先前缓存的监听器（客户端在 start() 之前就注册了它们）
        unsubscribers = [
          ...pending.message.map((listener) =>
            delegate!.onMessage((m) => handleMessage(listener, m)),
          ),
          ...pending.error.map((listener) =>
            delegate!.onError((e) => handleError(listener, e)),
          ),
          ...pending.close.map((listener) =>
            delegate!.onClose(() => handleClose(listener)),
          ),
        ];
        pending.message = [];
        pending.error = [];
        pending.close = [];
        if (bufferedProtocolVersion !== undefined) {
          delegate.setProtocolVersion?.(bufferedProtocolVersion);
        }
        await delegate.start();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setState(
          name,
          isAuthRequiredError(error) ? "needs-auth" : "failed",
          message,
        );
        throw error;
      }
    },

    async send(message: JsonRpcMessage): Promise<void> {
      if (!delegate) throw new Error(`transport for ${name} is not started`);
      // 记录 initialize 请求 id：它的成功响应是「已连接」的判据
      const request = message as { id?: string | number; method?: string };
      if (request.method === "initialize" && request.id !== undefined) {
        initializedId = request.id;
      }
      try {
        await delegate.send(message);
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        setState(
          name,
          isAuthRequiredError(error) ? "needs-auth" : "failed",
          text,
        );
        throw error;
      }
    },

    async close() {
      for (const off of unsubscribers) off();
      unsubscribers = [];
      await delegate?.close();
    },

    onMessage(listener) {
      if (delegate) {
        const off = delegate.onMessage((m) => handleMessage(listener, m));
        unsubscribers.push(off);
        return off;
      }
      pending.message.push(listener);
      return () => {
        pending.message = pending.message.filter((item) => item !== listener);
      };
    },

    onError(listener) {
      if (delegate) {
        const off = delegate.onError((e) => handleError(listener, e));
        unsubscribers.push(off);
        return off;
      }
      pending.error.push(listener);
      return () => {
        pending.error = pending.error.filter((item) => item !== listener);
      };
    },

    onClose(listener) {
      if (delegate) {
        const off = delegate.onClose(() => handleClose(listener));
        unsubscribers.push(off);
        return off;
      }
      pending.close.push(listener);
      return () => {
        pending.close = pending.close.filter((item) => item !== listener);
      };
    },
  };

  liveTransports.add(async () => {
    for (const off of unsubscribers) off();
    unsubscribers = [];
    await delegate?.close();
  });

  log(`[MCP] transport created for ${name} (storeType=${storeType})`);
  return transport;
}
