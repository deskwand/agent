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
import type { CatalogEntry } from "../../../shared/mcp-catalog";
import type { McpServerEntry } from "@earendil-works/pi-coding-agent";

/** UI 副标题的 i18n key。文案不在源码里硬编码。 */
export const SERVER_SUMMARY_REMOTE = "connectors.summary.remote";

export interface SourceBuildContext {
  loaded: { servers: McpServerEntry[]; errors: string[] };
  statusFor: (name: string) => ConnectorStatus | undefined;
}

function isHttp(entry: McpServerEntry): boolean {
  return "url" in entry.config;
}

export function buildRemoteEntries(
  ctx: SourceBuildContext,
  catalog: readonly CatalogEntry[],
): ConnectorEntry[] {
  const byName = new Map<string, McpServerEntry>();
  for (const server of ctx.loaded.servers) {
    if (isHttp(server)) byName.set(server.name, server);
  }

  const claimed = new Set<string>();
  const entries: ConnectorEntry[] = catalog.map((cat) => {
    const server = byName.get(cat.key);
    if (server) claimed.add(cat.key);
    return {
      key: `mcp:catalog:${cat.key}`,
      serverName: cat.key,
      source: "mcp-remote",
      tab: "connect",
      nameKey: cat.nameKey,
      descriptionKey: cat.descriptionKey,
      instances: server
        ? [
            {
              id: server.name,
              label: server.name,
              status: ctx.statusFor(server.name) ?? { kind: "idle" },
              summary: SERVER_SUMMARY_REMOTE,
            },
          ]
        : [],
    };
  });

  // 目录之外的用户自建远程 server：不能因为不在目录里就藏起来
  for (const name of byName.keys()) {
    if (claimed.has(name)) continue;
    entries.push({
      key: `mcp:server:${name}`,
      serverName: name,
      source: "mcp-remote",
      tab: "connect",
      // 用户自建的名字不是 i18n key，直接用原名当 key（t() 查不到就回退原文）
      nameKey: name,
      instances: [
        {
          id: name,
          label: name,
          status: ctx.statusFor(name) ?? { kind: "idle" },
          summary: SERVER_SUMMARY_REMOTE,
        },
      ],
    });
  }

  return entries;
}
