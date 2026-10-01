/**
 * 连接状态的单一来源。
 *
 * 传输适配器（`mcp-transport-adapter.ts`）已经维护了每个 server 的状态表，
 * 但它的 `onMcpStateChange` 一直没有消费者。这里把它接出来，供连接页与
 * 旧的 `mcp.getServerStatus` IPC 共用 —— 取代原先设置页 3 秒轮询的做法。
 *
 * **依赖注入而非直接 import**：生产在启动时 `initStatusStore(realSource)`；
 * 测试注入 stub。这样测试不需要 mock 模块，也不会碰到 ESM 的猴子补丁问题。
 */
import type { ConnectorStatus } from "../../shared/connectors";
import type { McpServerState } from "../mcp/mcp-transport-adapter";

export interface StatusSource {
  getState(name: string): McpServerState | undefined;
  getError(name: string): string | undefined;
  subscribe(fn: (name: string, state: McpServerState) => void): () => void;
}

type StatusListener = () => void;

const listeners = new Set<StatusListener>();
let source: StatusSource | undefined;
let unsubscribeSource: (() => void) | undefined;

export function initStatusStore(next: StatusSource): void {
  if (source) return;
  source = next;
  unsubscribeSource = next.subscribe(() => {
    listeners.forEach((fn) => fn());
  });
}

export function getConnectorStatus(name: string): ConnectorStatus | undefined {
  if (!source) return undefined;
  const state = source.getState(name);
  if (!state) return undefined;

  const error = source.getError(name);
  if (error) return { kind: "failed", message: error };

  switch (state) {
    case "connected":
      return { kind: "ready" };
    case "connecting":
      return { kind: "connecting" };
    case "needs-auth":
      return { kind: "needs-auth" };
    case "failed":
      return { kind: "failed", message: "failed" };
  }
}

export function subscribeStatus(fn: StatusListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** 仅供测试：断开来源与订阅，让下一个用例能注入自己的 stub。 */
export function resetForTest(): void {
  listeners.clear();
  unsubscribeSource?.();
  unsubscribeSource = undefined;
  source = undefined;
}
