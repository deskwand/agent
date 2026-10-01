import { describe, expect, it, beforeEach } from "vitest";
import {
  initStatusStore,
  getConnectorStatus,
  subscribeStatus,
  resetForTest,
  type StatusSource,
} from "../../main/connectors/status-store";
import type { McpServerState } from "../../main/mcp/mcp-transport-adapter";

/** 可注入的假数据源 —— 生产环境注入真正的 transport adapter。 */
function makeStubSource() {
  const states = new Map<string, McpServerState>();
  const errors = new Map<string, string>();
  const listeners = new Set<(name: string, state: McpServerState) => void>();
  const source: StatusSource = {
    getState: (name) => states.get(name),
    getError: (name) => errors.get(name),
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  return {
    source,
    emit(name: string, state: McpServerState, error?: string) {
      states.set(name, state);
      if (error) errors.set(name, error);
      else errors.delete(name);
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

  it("maps connecting to connecting", () => {
    stub.emit("notion", "connecting");
    expect(getConnectorStatus("notion")).toEqual({ kind: "connecting" });
  });

  it("maps needs-auth to needs-auth", () => {
    stub.emit("notion", "needs-auth");
    expect(getConnectorStatus("notion")).toEqual({ kind: "needs-auth" });
  });

  it("maps failed with the adapter's error message", () => {
    stub.emit("notion", "failed", "timeout");
    expect(getConnectorStatus("notion")).toEqual({
      kind: "failed",
      message: "timeout",
    });
  });

  it("falls back to a generic message when failed without one", () => {
    stub.emit("notion", "failed");
    expect(getConnectorStatus("notion")).toEqual({
      kind: "failed",
      message: "failed",
    });
  });

  it("notifies subscribers when the adapter emits", () => {
    let count = 0;
    subscribeStatus(() => {
      count++;
    });
    stub.emit("notion", "connected");
    stub.emit("linear", "needs-auth");
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
