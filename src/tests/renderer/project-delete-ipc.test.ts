// @vitest-environment jsdom
//
// 回归：项目删除后必须把本地 store 里的会话摘掉。
// 漏掉这条接线不会报错、也不会让别的测试变红 —— 界面继续显示已经不存在的
// 会话，表现为「点了删除，项目还在」。所以在这里钉住真实的 useIPC 行为，
// 而不是断言源码里出现了某个字符串。
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../renderer/store";
import type { Session } from "../../renderer/types";

const bridge = vi.hoisted(() => {
  const api = {
    invoke: vi.fn(async (_event: { type: string }) => null as unknown),
    send: vi.fn(),
    on: vi.fn(() => () => {}),
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
  return { api };
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
    cwd: "/work/proj",
    mountedPaths: [],
    allowedTools: [],
    memoryEnabled: false,
    isProjectMode: true,
  };
}

function sessionIds(): string[] {
  return useAppStore
    .getState()
    .sessions.map((s) => s.id)
    .sort();
}

describe("project.delete → renderer session store", () => {
  let container: HTMLDivElement;
  let root: Root;
  let ipc!: ReturnType<typeof useIPC>;

  function answerProjectDelete(result: Record<string, unknown> | null): void {
    bridge.api.invoke.mockImplementation(async (event: { type: string }) =>
      event?.type === "project.delete" ? result : null,
    );
  }

  beforeEach(async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    useAppStore.setState(useAppStore.getInitialState());
    useAppStore.getState().addSession(makeSession("p1"));
    useAppStore.getState().addSession(makeSession("p2"));

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
  });

  afterEach(async () => {
    await act(async () => root.unmount());
  });

  it("removes the deleted sessions from the store", async () => {
    answerProjectDelete({
      success: true,
      path: "/work/proj",
      deletedSessionIds: ["p1"],
    });

    await act(async () => {
      await ipc.deleteProject("/work/proj");
    });

    expect(sessionIds()).toEqual(["p2"]);
  });

  it("clears the active session when it was among the deleted ones", async () => {
    useAppStore.getState().setActiveSession("p1");
    answerProjectDelete({
      success: true,
      path: "/work/proj",
      deletedSessionIds: ["p1"],
    });

    await act(async () => {
      await ipc.deleteProject("/work/proj");
    });

    expect(useAppStore.getState().activeSessionId).toBeNull();
  });

  it("leaves the store intact when the delete fails", async () => {
    answerProjectDelete({
      success: false,
      path: "",
      deletedSessionIds: [],
      error: "boom",
    });

    await act(async () => {
      await ipc.deleteProject("/work/proj");
    });

    expect(sessionIds()).toEqual(["p1", "p2"]);
  });
});
