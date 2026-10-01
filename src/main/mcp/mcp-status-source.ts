/**
 * 把传输适配器的状态表接成 status-store 的数据源。
 *
 * 适配器（`mcp-transport-adapter.ts`）一直在维护每个 server 的状态，但它的
 * `onMcpStateChange` 原本没有消费者。这里做一个薄适配，让连接页与旧的
 * `mcp.getServerStatus` IPC 共用同一份状态，而不是各自去读适配器的内部 Map。
 */
import type { StatusSource } from "../connectors/status-store";
import {
  getMcpServerError,
  getMcpServerState,
  onMcpStateChange,
} from "./mcp-transport-adapter";

export const mcpTransportStatusSource: StatusSource = {
  getState: getMcpServerState,
  getError: getMcpServerError,
  // 适配器的回调签名是 (name, state)，且只用于"有变化"通知；
  // 具体状态由 status-store 通过 getState/getError 读取。
  subscribe: (fn) =>
    onMcpStateChange((name) =>
      fn(name, getMcpServerState(name) ?? "connecting"),
    ),
};
