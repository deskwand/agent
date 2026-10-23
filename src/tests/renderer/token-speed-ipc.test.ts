// @vitest-environment jsdom
//
// 守接线层：stream.speed 事件必须写进「对应会话」的 SessionState.tokenSpeed。
// 漏这条接线不会有任何报错，只会让弹窗永远不显示速度。
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../renderer/store";
import type { ServerEvent, Session } from "../../renderer/types";

const bridge = vi.hoisted(() => {
  const handlers: Array<(event: ServerEvent) => void> = [];
  const api = {
    invoke: vi.fn(async () => null),
    send: vi.fn(),
    on: vi.fn((handler: (event: ServerEvent) => void) => {
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

// 必须在 import useIPC 之前把 electronAPI 放上去（useIPC 顶部的 isElectron 是模块级常量）
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

function emit(event: ServerEvent) {
  act(() => {
    for (const handler of bridge.handlers) handler(event);
  });
}

function speedOf(sessionId: string) {
  return useAppStore.getState().sessionStates[sessionId]?.tokenSpeed;
}

describe("stream.speed → SessionState.tokenSpeed", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    useAppStore.setState(useAppStore.getInitialState());
    useAppStore.getState().addSession(makeSession("s1"));
    useAppStore.getState().addSession(makeSession("s2"));

    function Harness() {
      useIPC();
      return null;
    }
    container = document.createElement("div");
    root = createRoot(container);
    await act(async () => {
      root.render(React.createElement(Harness));
    });
    expect(bridge.handlers.length).toBeGreaterThan(0);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("stores the live estimate, then replaces it with the exact value", () => {
    emit({
      type: "stream.speed",
      payload: { sessionId: "s1", tokensPerSecond: 42.3, estimated: true },
    });
    expect(speedOf("s1")).toEqual({ tokensPerSecond: 42.3, estimated: true });

    emit({
      type: "stream.speed",
      payload: { sessionId: "s1", tokensPerSecond: 38, estimated: false },
    });
    expect(speedOf("s1")).toEqual({ tokensPerSecond: 38, estimated: false });
  });

  it("drops a stale estimate when a new turn starts, keeps the exact value", () => {
    emit({
      type: "stream.speed",
      payload: { sessionId: "s1", tokensPerSecond: 42.3, estimated: true },
    });
    useAppStore.getState().startExecutionClock("s1", Date.now());
    expect(speedOf("s1")).toBeNull();

    emit({
      type: "stream.speed",
      payload: { sessionId: "s1", tokensPerSecond: 38, estimated: false },
    });
    useAppStore.getState().finishExecutionClock("s1");
    useAppStore.getState().startExecutionClock("s1", Date.now());
    expect(speedOf("s1")).toEqual({ tokensPerSecond: 38, estimated: false });
  });

  it("keeps sessions apart", () => {
    emit({
      type: "stream.speed",
      payload: { sessionId: "s1", tokensPerSecond: 38, estimated: false },
    });
    expect(speedOf("s2")).toBeNull();
  });
});
