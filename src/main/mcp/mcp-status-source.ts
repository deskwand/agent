/**
 * 把「工具快照」接成 status-store 的数据源。
 *
 * 原先这里读的是传输适配器的状态表 —— 但适配器已经删掉（传输交还 SDK）。
 * 现在能派的只有一件事：**某 server 的 `mcp__<name>__*` 工具出现在快照里 ⇒ 它连上了**。
 * 快照由 `recordMcpTools` 在 `session_start` / `tool_execution_end` 时填充。
 *
 * 拿不到的：`failed` 的具体错误、`needs-auth`、以及「正在连」。失败可见性靠上游那条
 * 一次性警告 + `mcp.log`。见 design-docs/2026-10-02-mcp-transport-revert-plan.md §5.1。
 */
import type { StatusSource } from "../connectors/status-store";
import { getMcpToolsSnapshot, onMcpToolsChange } from "./mcp-client-extension";

export const mcpToolsSnapshotStatusSource: StatusSource = {
  getState: (name) =>
    getMcpToolsSnapshot().some((tool) => tool.serverName === name)
      ? "connected"
      : undefined,
  subscribe: (fn) => onMcpToolsChange(() => fn("", "connected")),
};
