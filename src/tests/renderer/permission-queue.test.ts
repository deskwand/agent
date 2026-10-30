// @vitest-environment jsdom
//
// 授权 / sudo 请求按 toolUseId 并发存储：答复或撤销一条不得影响其他会话的请求。
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../renderer/store";
import {
  useOrphanPendingDialogs,
  usePendingPermissionsForSession,
  usePendingSudoForSession,
} from "../../renderer/store/selectors";
import type {
  PermissionRequest,
  SudoPasswordRequest,
} from "../../renderer/types";

const bridge = vi.hoisted(() => {
  const api = {
    invoke: vi.fn(async (_event?: unknown): Promise<unknown> => null),
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
  return api;
});

import { useIPC } from "../../renderer/hooks/useIPC";

const perm = (toolUseId: string, sessionId: string): PermissionRequest => ({
  toolUseId,
  toolName: "bash",
  input: {},
  sessionId,
});
const sudo = (toolUseId: string, sessionId: string): SudoPasswordRequest => ({
  toolUseId,
  command: "sudo ls",
  sessionId,
});

let container: HTMLDivElement;
let root: Root;

/** 渲染一个 hook 并返回最新结果的读取函数。 */
async function renderHook<T>(hook: () => T): Promise<{ get: () => T }> {
  let value!: T;
  function Harness() {
    value = hook();
    return null;
  }
  await act(async () => {
    root.render(React.createElement(Harness));
  });
  return { get: () => value };
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  useAppStore.setState(useAppStore.getInitialState());
  bridge.send.mockClear();
  container = document.createElement("div");
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("permission 队列", () => {
  it("并发请求都保留", () => {
    const s = useAppStore.getState();
    s.addPendingPermission(perm("t1", "S1"));
    s.addPendingPermission(perm("t2", "S2"));
    expect(Object.keys(useAppStore.getState().pendingPermissions)).toEqual([
      "t1",
      "t2",
    ]);
  });

  it("dismiss 只删一条", () => {
    const s = useAppStore.getState();
    s.addPendingPermission(perm("t1", "S1"));
    s.addPendingPermission(perm("t2", "S2"));
    s.removePendingPermission("t1");
    expect(Object.keys(useAppStore.getState().pendingPermissions)).toEqual([
      "t2",
    ]);
  });

  it("respondToPermission 只删自己那条", async () => {
    const s = useAppStore.getState();
    s.addPendingPermission(perm("t1", "S1"));
    s.addPendingPermission(perm("t2", "S2"));
    const ipc = await renderHook(() => useIPC());
    act(() => ipc.get().respondToPermission("t1", "allow"));
    expect(Object.keys(useAppStore.getState().pendingPermissions)).toEqual([
      "t2",
    ]);
    expect(bridge.send).toHaveBeenCalledWith({
      type: "permission.response",
      payload: { toolUseId: "t1", result: "allow" },
    });
  });

  it("按会话取按到达顺序", async () => {
    const s = useAppStore.getState();
    s.addPendingPermission(perm("t1", "S1"));
    s.addPendingPermission(perm("t2", "S2"));
    s.addPendingPermission(perm("t3", "S1"));
    const r = await renderHook(() => usePendingPermissionsForSession("S1"));
    expect(r.get().map((p) => p.toolUseId)).toEqual(["t1", "t3"]);
    const none = await renderHook(() => usePendingPermissionsForSession(null));
    expect(none.get()).toEqual([]);
  });

  it("孤儿请求", async () => {
    const s = useAppStore.getState();
    s.addPendingPermission(perm("t1", "S1"));
    s.addPendingPermission(perm("t2", "S2"));
    const r = await renderHook(() => useOrphanPendingDialogs(new Set(["S1"])));
    expect(r.get().permission?.sessionId).toBe("S2");
    const all = await renderHook(() =>
      useOrphanPendingDialogs(new Set(["S1", "S2"])),
    );
    expect(all.get().permission).toBeNull();
  });
});

describe("sudo 队列", () => {
  it("并发请求都保留", () => {
    const s = useAppStore.getState();
    s.addPendingSudoPassword(sudo("t1", "S1"));
    s.addPendingSudoPassword(sudo("t2", "S2"));
    expect(Object.keys(useAppStore.getState().pendingSudoPasswords)).toEqual([
      "t1",
      "t2",
    ]);
  });

  it("dismiss 只删一条", () => {
    const s = useAppStore.getState();
    s.addPendingSudoPassword(sudo("t1", "S1"));
    s.addPendingSudoPassword(sudo("t2", "S2"));
    s.removePendingSudoPassword("t1");
    expect(Object.keys(useAppStore.getState().pendingSudoPasswords)).toEqual([
      "t2",
    ]);
  });

  it("respondToSudoPassword 只删自己那条", async () => {
    const s = useAppStore.getState();
    s.addPendingSudoPassword(sudo("t1", "S1"));
    s.addPendingSudoPassword(sudo("t2", "S2"));
    const ipc = await renderHook(() => useIPC());
    act(() => ipc.get().respondToSudoPassword("t1", "pw"));
    expect(Object.keys(useAppStore.getState().pendingSudoPasswords)).toEqual([
      "t2",
    ]);
    expect(bridge.send).toHaveBeenCalledWith({
      type: "sudo.password.response",
      payload: { toolUseId: "t1", password: "pw" },
    });
  });

  it("按会话取按到达顺序，孤儿请求", async () => {
    const s = useAppStore.getState();
    s.addPendingSudoPassword(sudo("t1", "S1"));
    s.addPendingSudoPassword(sudo("t2", "S2"));
    s.addPendingSudoPassword(sudo("t3", "S1"));
    const r = await renderHook(() => usePendingSudoForSession("S1"));
    expect(r.get().map((p) => p.toolUseId)).toEqual(["t1", "t3"]);
    const orphan = await renderHook(() =>
      useOrphanPendingDialogs(new Set(["S1"])),
    );
    expect(orphan.get().sudo?.sessionId).toBe("S2");
    const none = await renderHook(() =>
      useOrphanPendingDialogs(new Set(["S1", "S2"])),
    );
    expect(none.get().sudo).toBeNull();
  });
});
