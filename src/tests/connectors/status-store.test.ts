import { describe, expect, it, beforeEach } from "vitest";
import {
  initStatusStore,
  getConnectorStatus,
  subscribeStatus,
  resetForTest,
  type StatusSource,
} from "../../main/connectors/status-store";
import type { McpServerState } from "../../main/connectors/status-store";

/** 可注入的假数据源 —— 生产注入 `mcpToolsSnapshotStatusSource`（从工具快照派生，只可能给出 connected）。 */
function makeStubSource() {
  const states = new Map<string, McpServerState>();
  const listeners = new Set<(name: string, state: McpServerState) => void>();
  const source: StatusSource = {
    getState: (name) => states.get(name),
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  return {
    source,
    emit(name: string, state: McpServerState) {
      states.set(name, state);
      listeners.forEach((fn) => fn(name, state));
    },
  };
}

describe("status-store", () => {
  let stub: ReturnType<typeof makeStubSource>;

  beforeEach(() => {
    resetForTest();
    stub = makeStubSource();
    initStatusStore(stub.source);
  });

  it("returns undefined for unknown servers", () => {
    expect(getConnectorStatus("notion")).toBeUndefined();
  });

  it("maps connected to ready", () => {
    stub.emit("notion", "connected");
    expect(getConnectorStatus("notion")).toEqual({ kind: "ready" });
  });

  // 注：`connecting` / `failed` / `needs-auth` 随传输适配器一并删除 ——
  // 新的数据源只能派出 `connected`，那三种状态不可能再出现（见 mcp-status-source.ts）。

  it("notifies subscribers when the adapter emits", () => {
    let count = 0;
    subscribeStatus(() => {
      count++;
    });
    stub.emit("notion", "connected");
    stub.emit("linear", "connected");
    expect(count).toBe(2);
  });

  it("unsubscribe stops notifications", () => {
    let count = 0;
    const unsub = subscribeStatus(() => {
      count++;
    });
    unsub();
    stub.emit("notion", "connected");
    expect(count).toBe(0);
  });

  it("keeps the source injected until resetForTest", () => {
    stub.emit("notion", "connected");
    // 二次 init 不应覆盖已注入的来源（生产里 init 只在启动时调一次）
    initStatusStore(stub.source);
    expect(getConnectorStatus("notion")).toEqual({ kind: "ready" });
  });
});
