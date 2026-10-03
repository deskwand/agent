/**
 * 连接条目的聚合器。
 *
 * 把两类来源（外部服务 / 本机能力）拼成同一份列表，并把四个操作路由到注入的实现上。
 * **所有依赖都是注入的**（不直接 import 文件系统或 SDK），这样单测不需要 mock 模块，
 * 生产由 `connectors/index.ts` 接上真实实现。
 *
 * 四个操作对应渲染层的四种意图：
 *  - `addCatalogServer` —— 目录卡片点「连接」
 *  - `removeServer`     —— 卡片点「断开」（两步清理，见 spec §7.2）
 *  - `setEnabled`       —— 本机能力开关
 *  - `authorize`        —— 卡片点「重新授权」
 */
import type {
  ActionResult,
  AddCustomServerInput,
  ConnectorEntry,
} from "../../shared/connectors";
import { authOf, type CatalogEntry } from "../../shared/mcp-catalog";
import { sameEndpoint } from "./sources/mcp-remote-source";
import type {
  LoadedMcpConfig,
  McpServerConfig,
} from "@earendil-works/pi-coding-agent";
import type { ConnectorStatus } from "../../shared/connectors";
import { buildRemoteEntries } from "./sources/mcp-remote-source";
import { buildBuiltinEntries } from "./sources/mcp-builtin-source";
import { buildCustomEntries } from "./sources/mcp-custom-source";

export interface RegistryDeps {
  loadConfig: () => LoadedMcpConfig;
  statusFor: (name: string) => ConnectorStatus | undefined;
  catalog: readonly CatalogEntry[];
  addServer: (name: string, config: McpServerConfig) => Promise<ActionResult>;
  removeServer: (name: string) => Promise<ActionResult>;
  setServerEnabled: (name: string, enabled: boolean) => Promise<ActionResult>;
  /** 走 Task 6 的 `startSignIn`；授权 URL 通过 `openUrl` 交给上层打开。 */
  signIn: (
    serverUrl: string,
    openUrl: (url: string) => void,
  ) => Promise<ActionResult>;
  /** 清 `mcp-auth.json` 里属于该 URL 的凭据。断开必须做，见 spec §7.2。 */
  removeCredentials: (serverUrl: string) => Promise<boolean>;
  /**
   * 让 SDK 立刻连上新 server（spec §7.7）。
   * 返回 false = 没有活跃会话，调用方应提示「下次对话生效」。
   */
  activateNow: (name: string, config: McpServerConfig) => boolean;
  /** 与 SDK 的 validateMcpServerConfig 同规则；不合规的名字必须在写入前拦下。 */
  isValidServerName: (name: string) => boolean;
  /** 该 server URL 是否已有本地凭据（= 授权过）。用于区分「已授权」与「未连接」。 */
  hasCredentials: (url: string) => boolean;
  /** 中止某个 server 正在进行的授权（用户在浏览器里没点完就想退出）。 */
  cancelSignIn: (serverUrl: string) => boolean;
  /**
   * 按名字取出一个内置预设的配置（能力 tab 的开关用）。
   * 未添加的预设要能一键打开，所以得有办法从名字造出配置。
   */
  builtinConfigFor: (serverName: string) => McpServerConfig | undefined;
}

export interface Registry {
  list(): ConnectorEntry[];
  /**
   * 写入配置**并立刻开始授权**。
   *
   * `startSignIn` 是唯一会打开浏览器的入口；如果只写配置不调它，
   * 点「连接」在界面上毫无反应 —— 浏览器永远不开（这正是用户报的 bug）。
   */
  addCatalogServer(
    key: string,
    openUrl: (url: string) => void,
  ): Promise<ActionResult>;
  removeServer(serverName: string): Promise<ActionResult>;
  setEnabled(serverName: string, enabled: boolean): Promise<ActionResult>;
  authorize(
    serverName: string,
    openUrl: (url: string) => void,
  ): Promise<ActionResult>;
  /**
   * key 型目录条目：把用户粘的凭据写进配置并立刻生效。**不开浏览器** ——
   * 这条路径上没有 OAuth，调 `signIn` 只会得到一句 `not a remote server` 之类的错。
   */
  connectWithKey(key: string, credential: string): Promise<ActionResult>;
  addCustomServer(input: AddCustomServerInput): Promise<ActionResult>;
  /** 中止正在进行的授权。这是「连接中」状态唯一的退路。 */
  cancelSignIn(serverName: string): ActionResult;
}

/**
 * 目录条目 + 用户凭据 → mcp.json 配置。**纯函数**，单测不必 mock 文件系统。
 *
 * query 型用 URL API 拼参，而不是字符串拼 `?`：模板里可能已有 `format=0` 这类
 * **非凭据**参数（腾讯位置服务就是），拼错分隔符会静默产生一个坏 URL。
 */
export function configForCatalogEntry(
  entry: CatalogEntry,
  credential: string,
): McpServerConfig {
  const auth = authOf(entry);
  if (auth.kind !== "key") {
    throw new Error(`catalog entry "${entry.key}" does not take a key`);
  }
  if (auth.placement === "query") {
    const url = new URL(entry.url);
    url.searchParams.set(auth.name, credential);
    return { type: "http", url: url.toString() };
  }
  return {
    type: "http",
    url: entry.url,
    headers: { [auth.name]: `${auth.valuePrefix ?? ""}${credential}` },
  };
}

export function buildRegistry(deps: RegistryDeps): Registry {
  /**
   * 同名条目已存在但**不是这个端点**时拒绝写入。
   *
   * `upsertServer` 对同 transport 是 `{...existing, ...config}`（url 被换掉），
   * transport 不同则整个配置被替换 —— 无论哪种都会静默毁掉用户自己那台 server。
   * 归属判定已经把它显示成「未添加」，这里就是那条路径的出口，必须堵上。
   */
  function conflictingServer(
    key: string,
    url: string,
  ): ActionResult | undefined {
    const existing = deps.loadConfig().servers.find((s) => s.name === key);
    if (
      existing &&
      !("url" in existing.config && sameEndpoint(existing.config.url, url))
    ) {
      return {
        ok: false,
        error: `a server named "${key}" already exists with a different endpoint; remove it first`,
      };
    }
    return undefined;
  }

  function list(): ConnectorEntry[] {
    const loaded = deps.loadConfig();
    const ctx = {
      loaded,
      statusFor: deps.statusFor,
      hasCredentials: deps.hasCredentials,
    };
    return [
      ...buildRemoteEntries(ctx, deps.catalog),
      ...buildBuiltinEntries(ctx),
      ...buildCustomEntries(ctx, deps.catalog),
    ];
  }

  async function addCatalogServer(
    key: string,
    openUrl: (url: string) => void,
  ): Promise<ActionResult> {
    const entry = deps.catalog.find((c) => c.key === key);
    if (!entry) return { ok: false, error: `unknown catalog key: ${key}` };

    const conflict = conflictingServer(key, entry.url);
    if (conflict) return conflict;

    const config: McpServerConfig = { type: "http", url: entry.url };
    const res = await deps.addServer(key, config);
    if (!res.ok) return res;

    // 写盘成功后立刻授权。目录里的服务都是 OAuth 远程服务，
    // 不走到这一步就不会有人打开浏览器（`McpOAuthProvider` 有已存 token 时
    // 会直接返回 AUTHORIZED，不会开浏览器，所以这里不需要先判断）。
    const signedIn = await deps.signIn(entry.url, openUrl);
    if (!signedIn.ok) return signedIn;

    // 授权成功后让 SDK 立刻连上。没有活跃会话时如实告诉 UI ——
    // 否则界面毫无变化，用户会以为「点了没反应」。
    const activated = deps.activateNow(key, config);
    return activated ? { ok: true } : { ok: true, pendingActivation: true };
  }

  async function removeServer(serverName: string): Promise<ActionResult> {
    // 两步都必须做：只删配置不删凭据，重新添加时会静默复用旧 token。
    const entry = deps.loadConfig().servers.find((s) => s.name === serverName);
    if (entry && "url" in entry.config) deps.cancelSignIn(entry.config.url);
    const res = await deps.removeServer(serverName);
    if (entry && "url" in entry.config) {
      await deps.removeCredentials(entry.config.url);
    }
    return res;
  }

  async function setEnabled(
    serverName: string,
    enabled: boolean,
  ): Promise<ActionResult> {
    const exists = deps
      .loadConfig()
      .servers.some((server) => server.name === serverName);

    // 未添加过的内置能力：开关就是「添加并启用」，不能因为文件里没有就拒绝
    if (!exists) {
      if (!enabled) return { ok: true };
      const config = deps.builtinConfigFor(serverName);
      if (!config)
        return { ok: false, error: `unknown capability: ${serverName}` };
      const added = await deps.addServer(serverName, config);
      if (!added.ok) return added;
      return deps.activateNow(serverName, config)
        ? { ok: true }
        : { ok: true, pendingActivation: true };
    }

    const res = await deps.setServerEnabled(serverName, enabled);
    if (res.ok && enabled) {
      const current = deps
        .loadConfig()
        .servers.find((server) => server.name === serverName)?.config;
      if (current) deps.activateNow(serverName, current);
    }
    return res;
  }

  async function authorize(
    serverName: string,
    openUrl: (url: string) => void,
  ): Promise<ActionResult> {
    const entry = deps.loadConfig().servers.find((s) => s.name === serverName);
    if (!entry || !("url" in entry.config)) {
      return { ok: false, error: `not a remote server: ${serverName}` };
    }
    const res = await deps.signIn(entry.config.url, openUrl);
    if (res.ok && !deps.activateNow(serverName, entry.config)) {
      return { ok: true, pendingActivation: true };
    }
    return res;
  }

  function cancelSignIn(serverName: string): ActionResult {
    const entry = deps.loadConfig().servers.find((s) => s.name === serverName);
    if (!entry || !("url" in entry.config)) {
      return { ok: false, error: `not a remote server: ${serverName}` };
    }
    return deps.cancelSignIn(entry.config.url)
      ? { ok: true }
      : { ok: false, error: "no sign-in in progress" };
  }

  async function connectWithKey(
    key: string,
    credential: string,
  ): Promise<ActionResult> {
    const entry = deps.catalog.find((c) => c.key === key);
    if (!entry) return { ok: false, error: `unknown catalog key: ${key}` };
    // 反向也要堵：OAuth 条目走这个入口会把凭据写到一个不需要它的端点上，
    // 用户看到「已连接」而服务永远未授权。
    if (authOf(entry).kind !== "key") {
      return { ok: false, error: `"${key}" does not take a key` };
    }
    const value = credential.trim();
    if (!value) return { ok: false, error: "credential is empty" };

    const conflict = conflictingServer(key, entry.url);
    if (conflict) return conflict;

    const config = configForCatalogEntry(entry, value);
    const res = await deps.addServer(key, config);
    if (!res.ok) return res;
    return deps.activateNow(key, config)
      ? { ok: true }
      : { ok: true, pendingActivation: true };
  }

  async function addCustomServer(
    input: AddCustomServerInput,
  ): Promise<ActionResult> {
    if (input.kind === "url") {
      return deps.addServer(input.name, { type: "http", url: input.url });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(input.payload);
    } catch (e) {
      return { ok: false, error: `invalid JSON: ${(e as Error).message}` };
    }

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return { ok: false, error: "top level must be an object" };
    }

    const servers = (parsed as { mcpServers?: Record<string, McpServerConfig> })
      .mcpServers;
    if (!servers || typeof servers !== "object") {
      return { ok: false, error: "missing mcpServers object" };
    }

    for (const [name, config] of Object.entries(servers)) {
      if (
        typeof config !== "object" ||
        config === null ||
        Array.isArray(config)
      ) {
        return { ok: false, error: `"${name}" must be an object` };
      }
      if (!deps.isValidServerName(name)) {
        // SDK 会用同样的规则拒绝它（激活时抛异常、加载时丢弃），
        // 放进去只会留下一个永远连不上的条目。
        return {
          ok: false,
          error: `invalid server name "${name}": use letters, digits, "_" and "-"`,
        };
      }
      const res = await deps.addServer(name, config);
      if (!res.ok) return res;
    }
    return { ok: true };
  }

  return {
    list,
    addCatalogServer,
    connectWithKey,
    removeServer,
    setEnabled,
    authorize,
    addCustomServer,
    cancelSignIn,
  };
}
