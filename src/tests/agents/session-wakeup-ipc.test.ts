import { describe, expect, it, vi } from "vitest";
import { registerSessionWakeupIpc } from "../../main/agents/session-wakeup-ipc";
import type { SessionWakeupManager } from "../../main/agents/session-wakeup-manager";

type Handler = (event: unknown, ...args: unknown[]) => unknown;

function setup(manager: Record<string, unknown> | null) {
  const handlers = new Map<string, Handler>();
  registerSessionWakeupIpc({
    ipcMain: {
      handle: (channel, handler) => {
        handlers.set(channel, handler as Handler);
      },
    },
    getManager: () => (manager as SessionWakeupManager | null) ?? null,
  });
  return handlers;
}

describe("session wakeup ipc", () => {
  it("registers the two channels", () => {
    expect([...setup({}).keys()].sort()).toEqual([
      "sessionWakeup.cancel",
      "sessionWakeup.next",
    ]);
  });

  it("returns the next wakeup for a session", async () => {
    const getNext = vi.fn(() => ({
      id: "w1",
      at: 1_000,
      reason: "看构建结果",
    }));
    const handlers = setup({ getNext });
    expect(await handlers.get("sessionWakeup.next")!(null, "s1")).toEqual({
      id: "w1",
      at: 1_000,
      reason: "看构建结果",
    });
    expect(getNext).toHaveBeenCalledWith("s1");
  });

  it("cancels by session and wakeup id", async () => {
    const cancel = vi.fn(() => true);
    const handlers = setup({ cancel });
    expect(await handlers.get("sessionWakeup.cancel")!(null, "s1", "w1")).toBe(
      true,
    );
    expect(cancel).toHaveBeenCalledWith("s1", "w1");
  });

  it("throws when the manager is not ready", async () => {
    const handlers = setup(null);
    // requireManager 是同步抛错（Electron 的 ipcMain.handle 会把它转成 rejected promise）
    await expect(async () =>
      handlers.get("sessionWakeup.next")!(null, "s1"),
    ).rejects.toThrow("Session wakeup manager not initialized");
  });
});
