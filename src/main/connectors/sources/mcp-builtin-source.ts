/**
 * 应用自带 MCP server 来源：预设 × mcp.json × 运行状态。
 *
 * 现在只剩 `GUI_Operate` 一个（`Chrome` 与示例 server 已下架），产出 `transport: "stdio"`
 * 的条目 —— 卡片画开关而不是「连接」按钮。
 *
 * ⚠️ **预设名字不可改**：工具名是 `mcp__<server>__<tool>`，改名字会变更工具声明，
 * 破坏提示词缓存并让老会话的工具调用记录对不上（本仓 AGENTS.md 明令）。
 */
import type {
  ConnectorEntry,
  ConnectorStatus,
} from "../../../shared/connectors";
import type { McpServerEntry } from "@earendil-works/pi-coding-agent";
import type { SourceBuildContext } from "./mcp-remote-source";

/** UI 副标题的 i18n key。 */
export const SERVER_SUMMARY_LOCAL = "connectors.summary.local";

interface BuiltinPreset {
  /** 不可改：见文件头 */
  name: string;
  nameKey: string;
  descriptionKey: string;
}

export const BUILTIN_PRESETS: readonly BuiltinPreset[] = [
  {
    name: "GUI_Operate",
    nameKey: "connectors.builtin.computerUse",
    descriptionKey: "connectors.builtin.computerUseDesc",
  },
] as const;

export function buildBuiltinEntries(ctx: SourceBuildContext): ConnectorEntry[] {
  const byName = new Map<string, McpServerEntry>();
  for (const server of ctx.loaded.servers) byName.set(server.name, server);

  return BUILTIN_PRESETS.map((preset) => {
    const server = byName.get(preset.name);
    return {
      key: `mcp:builtin:${preset.name}`,
      serverName: preset.name,
      source: "mcp-builtin",
      transport: "stdio",
      nameKey: preset.nameKey,
      descriptionKey: preset.descriptionKey,
      instances: server
        ? [
            {
              id: preset.name,
              label: preset.name,
              // enabled:false 的预设给 off —— 它由 store 直接给出，不属于传输状态
              status:
                server.config.enabled === false
                  ? ({ kind: "off" } as ConnectorStatus)
                  : (ctx.statusFor(preset.name) ?? { kind: "idle" }),
              summary: SERVER_SUMMARY_LOCAL,
            },
          ]
        : [],
    };
  });
}
