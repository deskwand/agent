/**
 * 连接状态的单一来源。
 *
 * 数据源是 `mcp/mcp-status-source.ts`（从工具快照派生）—— 传输适配器已删除。
 *
 * **依赖注入而非直接 import**：生产在启动时 `initStatusStore(realSource)`；
 * 测试注入 stub。这样测试不需要 mock 模块，也不会碰到 ESM 的猴子补丁问题。
 */
import type { ConnectorStatus } from "../../shared/connectors";
/**
 * 能派生的状态只剩一个 —— 见 `mcp/mcp-status-source.ts`。
 * `connecting` / `failed` / `needs-auth` 随传输适配器一并消失（不再有那个数据源）。
 */
export type McpServerState = "connected";

export interface StatusSource {
  getState(name: string): McpServerState | undefined;
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

  switch (state) {
    case "connected":
      return { kind: "ready" };
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
