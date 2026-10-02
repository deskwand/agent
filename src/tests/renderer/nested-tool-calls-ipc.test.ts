// @vitest-environment jsdom
//
// 回归：ServerEvent `stream.nestedToolCalls` 必须把运行时快照路由进 store。
// useIPC 的事件 switch 带 default 分支，漏接既不会编译报错，也不会让别的
// 测试变红 —— 所以必须单测钉住这条接线。
//
// 刻意**不用** fake timers：useIPC 挂载时会跑一串异步 invoke，
// 冻结计时器有挂死的风险。
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../renderer/store";
import type { NestedToolRuntimeUi } from "../../shared/nested-tool-calls";

const bridge = vi.hoisted(() => {
  const handlers: Array<(event: unknown) => void> = [];
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: {
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
    },
  });
  return { handlers };
});

// 必须在 import useIPC 之前把 electronAPI 放上去：useIPC 顶部的 isElectron
// 是模块级常量，构造时机在 import 求值那一刻。
import { useIPC } from "../../renderer/hooks/useIPC";

const runtime: NestedToolRuntimeUi = {
  snapshot: {
    parentToolCallId: "p1",
    parentStatus: "running",
    complete: false,
    source: "live",
    calls: [],
  },
  outputs: {},
};

describe("stream.nestedToolCalls IPC routing", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    useAppStore.setState(useAppStore.getInitialState(), true);

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

  it("stores the runtime snapshot for the event session", async () => {
    await act(async () => {
      for (const handler of bridge.handlers) {
        handler({
          type: "stream.nestedToolCalls",
          payload: { sessionId: "s1", runtime },
        });
      }
    });

    expect(useAppStore.getState().sessionStates.s1.nestedToolCalls?.p1).toEqual(
      runtime,
    );
  });
});
