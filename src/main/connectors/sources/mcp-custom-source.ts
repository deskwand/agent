/**
 * 用户自己加进 `mcp.json` 的 server（既不是目录里的远程服务，也不是内置预设）。
 *
 * 连接器页原先只有 remote + builtin 两个来源，所以这类 server **完全不可见** ——
 * 只有已废弃的那张设置页（直接读 `mcp.getServers()`）能看到它们。
 * 用户自定义的入口正是要落在这一来源上。
 *
 * **只负责 stdio。** 非目录的 **http** server 由 `mcp-remote-source.ts` 产出；两边都产出
 * 会重复渲染并重复给出「断开」（那是删配置的动作）。
 */
import type {
  ConnectorEntry,
  ConnectorStatus,
} from "../../../shared/connectors";
import type { CatalogEntry } from "../../../shared/mcp-catalog";
import { BUILTIN_PRESETS } from "../builtin-presets";
import type { SourceBuildContext } from "./mcp-remote-source";
import { SERVER_SUMMARY_LOCAL } from "./mcp-builtin-source";

export function buildCustomEntries(
  ctx: SourceBuildContext,
  catalog: readonly CatalogEntry[],
): ConnectorEntry[] {
  // 已归 remote / builtin 的名字不再重复列出。
  const claimed = new Set<string>();
  for (const preset of BUILTIN_PRESETS) claimed.add(preset.name);
  for (const entry of catalog) claimed.add(entry.key);

  return (
    ctx.loaded.servers
      .filter((server) => !claimed.has(server.name))
      // **只认 stdio**：非目录的 http server 已经由 `buildRemoteEntries` 产出
      // （同样用 `mcp:server:<name>` 作 key）。两边都产出会让同一台服务器渲染成
      // 两张卡（React 重复 key），而且会重复给出那个会**删配置**的「断开」。
      .filter((server) => !("url" in server.config))
      .map((server) => ({
        key: `mcp:server:${server.name}`,
        serverName: server.name,
        source: "mcp-custom" as const,
        tab: "connect" as const,
        // 自定义 server 没有 i18n key —— 直接用名字（t() 查不到时原样返回）。
        nameKey: server.name,
        instances: [
          {
            id: server.name,
            label: server.name,
            // `enabled: false` 由配置直接给出，不属于运行时状态
            status:
              server.config.enabled === false
                ? ({ kind: "off" } as ConnectorStatus)
                : (ctx.statusFor(server.name) ?? { kind: "idle" }),
            summary: SERVER_SUMMARY_LOCAL,
            // 本来源只剩 stdio（http 在 remote 来源里）—— 所以动作是启用/停用
            transport: "stdio",
          },
        ],
      }))
  );
}
