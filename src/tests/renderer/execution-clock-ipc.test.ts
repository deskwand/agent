// @vitest-environment jsdom
//
// 回归：无用户消息的自动 running（定时任务、扩展触发、后台子代理续跑）
// 没有任何 startExecutionClock 调用点，只有 session.status 兜底。
// 漏掉这条接线不会报错、不会让别的测试变红 —— 所以必须单测钉住。
//
// 刻意**不用** fake timers：useIPC 挂载时会跑一串异步 invoke，
// 冻结计时器有挂死的风险。下面的断言全部用相对时间写。
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../renderer/store";
import type { Session } from "../../renderer/types";

const bridge = vi.hoisted(() => {
  const handlers: Array<(event: unknown) => void> = [];
  const api = {
    invoke: vi.fn(async () => null),
    send: vi.fn(),
    on: vi.fn((handler: (event: unknown) => void) => {
      handlers.push(handler);
      return () => {};
    }),
    config: {
      get: vi.fn(async () => ({})),
      isConfigured: vi.fn(async () => false),
    },
    getSystemTheme: vi.fn(async () => ({ shouldUseDarkColors: false })),
  };
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: api,
  });
  return { handlers };
});

// 必须在 import useIPC 之前把 electronAPI 放上去：useIPC 顶部的 isElectron
// 是模块级常量，构造时机在 import 求值那一刻。
import { useIPC } from "../../renderer/hooks/useIPC";

function makeSession(id: string): Session {
  return {
    id,
    title: `Session ${id}`,
    status: "idle",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    cwd: "/tmp",
    mountedPaths: [],
    allowedTools: [],
    memoryEnabled: false,
    isProjectMode: false,
  };
}

function clockOf(sessionId: string) {
  return useAppStore.getState().sessionStates[sessionId]!.executionClock;
}

describe("session.status → ensureExecutionClock", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    useAppStore.setState(useAppStore.getInitialState());
    useAppStore.getState().addSession(makeSession("s1"));

    let ipc!: ReturnType<typeof useIPC>;
    function Harness() {
      ipc = useIPC();
      return null;
    }
    container = document.createElement("div");
    root = createRoot(container);
    await act(async () => {
      root.render(React.createElement(Harness));
    });
    expect(ipc.isElectron).toBe(true);
    expect(bridge.handlers.length).toBeGreaterThan(0);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
  });

  async function emitStatus(status: string): Promise<void> {
    await act(async () => {
      for (const handler of bridge.handlers) {
        handler({
          type: "session.status",
          payload: { sessionId: "s1", status },
        });
      }
    });
  }

  it("starts the clock for a run with no user message", async () => {
    const before = Date.now();
    await emitStatus("running");
    const { startAt, endAt } = clockOf("s1");
    expect(startAt).toBeGreaterThanOrEqual(before);
    expect(startAt).toBeLessThanOrEqual(Date.now());
    expect(endAt).toBeNull();
  });

  it("keeps the origin when the run resumes inside the linger window", async () => {
    const now = Date.now();
    useAppStore.getState().startExecutionClock("s1", now - 90_000);
    useAppStore.getState().finishExecutionClock("s1", now - 2_000);
    await emitStatus("running");
    expect(clockOf("s1")).toEqual({ startAt: now - 90_000, endAt: null });
  });

  it("discards a stale origin from an earlier run", async () => {
    useAppStore.getState().startExecutionClock("s1", 100_000);
    useAppStore.getState().finishExecutionClock("s1", 200_000);
    await emitStatus("running");
    expect(clockOf("s1").startAt).toBeGreaterThan(200_000);
    expect(clockOf("s1").endAt).toBeNull();
  });

  it("leaves a live clock alone", async () => {
    useAppStore.getState().startExecutionClock("s1", 100_000);
    await emitStatus("running");
    expect(clockOf("s1")).toEqual({ startAt: 100_000, endAt: null });
  });

  it("still freezes the clock when the session goes idle", async () => {
    useAppStore.getState().startExecutionClock("s1", 100_000);
    await emitStatus("idle");
    const { startAt, endAt } = clockOf("s1");
    expect(startAt).toBe(100_000);
    expect(endAt).toBeGreaterThanOrEqual(100_000);
  });
});
