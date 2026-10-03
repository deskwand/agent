/**
 * 外部服务来源：目录条目 × mcp.json × 运行状态。
 *
 * 产出 `tab: "connect"` 的条目。目录里每条都会产出**一个条目**；
 * 是否已添加体现在 `instances` 是否为空 —— 空数组就是「还没添加」的卡片。
 *
 * 另外会把 mcp.json 里**目录之外**的远程 server 也带出来（用户自己加的），
 * 否则它们在连接页上会凭空消失。
 */
import type {
  ConnectorEntry,
  ConnectorStatus,
} from "../../../shared/connectors";
import {
  authOf,
  type CatalogAuth,
  type CatalogEntry,
} from "../../../shared/mcp-catalog";
import type { McpServerEntry } from "@earendil-works/pi-coding-agent";

/** UI 副标题的 i18n key。文案不在源码里硬编码。 */
export const SERVER_SUMMARY_REMOTE = "connectors.summary.remote";

export interface SourceBuildContext {
  loaded: { servers: McpServerEntry[]; errors: string[] };
  statusFor: (name: string) => ConnectorStatus | undefined;
  /** 该 server URL 是否已有本地凭据（= 用户授权过）。 */
  hasCredentials: (url: string) => boolean;
}

/**
 * 没有运行时状态时，靠凭据判断是「已授权」还是「未连接」。
 * 运行时状态永远优先 —— 已连上就不该再显示「已授权」。
 */
function statusOrFallback(
  ctx: SourceBuildContext,
  server: HttpServerEntry,
  auth: CatalogAuth,
): ConnectorStatus {
  const runtime = ctx.statusFor(server.name);
  if (runtime) return runtime;
  if (ctx.hasCredentials(server.config.url)) {
    return { kind: "authorized" };
  }
  if (hasKeyCredential(server, auth)) {
    return { kind: "authorized" };
  }
  return { kind: "idle" };
}

/**
 * key 型条目的「凭据已在本地」判定：配置里那个参数 / 头非空就是有。
 * **只看配置，不发网络请求** —— 这个函数在每次渲染列表时都跑。
 */
function hasKeyCredential(server: HttpServerEntry, auth: CatalogAuth): boolean {
  if (auth.kind !== "key") return false;
  if (auth.placement === "query") {
    try {
      return Boolean(new URL(server.config.url).searchParams.get(auth.name));
    } catch {
      return false;
    }
  }
  const value = server.config.headers?.[auth.name];
  return typeof value === "string" && value.trim().length > 0;
}

/** http（远程）server —— 只有这一支有 url。 */
type HttpServerEntry = McpServerEntry & {
  config: { url: string; headers?: Record<string, string> };
};

function isHttp(entry: McpServerEntry): entry is HttpServerEntry {
  return "url" in entry.config;
}

/** 目录与用户自建的分界：**名字相同还不够，端点也得同源同路径**。
 *  忽略末尾斜杠与 query/hash —— 用户可能加了 `?project_ref=x` 这类参数。
 *  不这样做的话，用户给自己那台同名 server 点「断开」会删掉他的配置。 */
export function sameEndpoint(a: string, b: string): boolean {
  try {
    const norm = (raw: string) => {
      const u = new URL(raw);
      return `${u.origin}${u.pathname.replace(/\/$/, "")}`;
    };
    return norm(a) === norm(b);
  } catch {
    return false;
  }
}

export function buildRemoteEntries(
  ctx: SourceBuildContext,
  catalog: readonly CatalogEntry[],
): ConnectorEntry[] {
  const byName = new Map<string, HttpServerEntry>();
  for (const server of ctx.loaded.servers) {
    if (isHttp(server)) byName.set(server.name, server);
  }

  const claimed = new Set<string>();
  const entries: ConnectorEntry[] = catalog.map((cat) => {
    const candidate = byName.get(cat.key);
    // 名字相同但端点不同 ⇒ 那是用户自己的 server，不是这条目录实例
    const server =
      candidate && sameEndpoint(candidate.config.url, cat.url)
        ? candidate
        : undefined;
    if (server) claimed.add(cat.key);
    return {
      key: `mcp:catalog:${cat.key}`,
      serverName: cat.key,
      source: "mcp-remote",
      transport: "http",
      nameKey: cat.nameKey,
      descriptionKey: cat.descriptionKey,
      category: cat.category,
      // 只带目录条目**确实声明过**的凭据形态：写成 `authOf(cat)` 会给 44 条 OAuth 条目
      // 也塞上一个 `{kind:"oauth"}`，数据变多、信息量为零。
      // 缺省即 OAuth，由消费者的 `entry.auth?.kind === "key"` 自己表达。
      auth: cat.auth,
      instances: server
        ? [
            {
              id: server.name,
              label: server.name,
              status: statusOrFallback(ctx, server, authOf(cat)),
              summary: SERVER_SUMMARY_REMOTE,
            },
          ]
        : [],
    };
  });

  // 目录之外的用户自建远程 server：不能因为不在目录里就藏起来
  for (const [name, server] of byName) {
    if (claimed.has(name)) continue;
    entries.push({
      key: `mcp:server:${name}`,
      serverName: name,
      source: "mcp-remote",
      transport: "http",
      // 用户自建的名字不是 i18n key，直接用原名当 key（t() 查不到就回退原文）
      nameKey: name,
      instances: [
        {
          id: name,
          label: name,
          status: statusOrFallback(ctx, server, { kind: "oauth" }),
          summary: SERVER_SUMMARY_REMOTE,
        },
      ],
    });
  }

  return entries;
}
