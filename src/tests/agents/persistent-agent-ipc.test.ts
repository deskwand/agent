import { describe, expect, it, vi } from "vitest";
import { registerPersistentAgentIpc } from "../../main/agents/persistent-agent-ipc";
import type { PersistentAgentManager } from "../../main/agents/persistent-agent-manager";

type Handler = (event: unknown, ...args: unknown[]) => unknown;

function register(
  manager: PersistentAgentManager | null,
  workspace: string | null = null,
  checkWorkspace: (cwd: string) => string | null = () => workspace,
) {
  const handlers = new Map<string, Handler>();
  registerPersistentAgentIpc({
    ipcMain: {
      handle: (channel: string, handler: Handler) => {
        handlers.set(channel, handler);
      },
    } as never,
    getManager: () => manager,
    checkWorkspace,
  });
  return handlers;
}

describe("registerPersistentAgentIpc", () => {
  it("registers every channel", () => {
    expect([...register(null).keys()].sort()).toEqual(
      [
        "persistentAgents.cancelWakeup",
        "persistentAgents.create",
        "persistentAgents.delete",
        "persistentAgents.list",
        "persistentAgents.listWakeups",
        "persistentAgents.pause",
        "persistentAgents.resume",
        "persistentAgents.update",
        "persistentAgents.wakeNow",
      ].sort(),
    );
  });

  it("lists nothing and refuses other calls before the manager exists", () => {
    const handlers = register(null);
    expect(handlers.get("persistentAgents.list")!(null)).toEqual([]);
    expect(() => handlers.get("persistentAgents.pause")!(null, "a1")).toThrow(
      "Persistent agent manager not initialized",
    );
  });

  it("rejects a blank name on create", () => {
    const handlers = register({} as PersistentAgentManager);
    expect(() =>
      handlers.get("persistentAgents.create")!(null, {
        name: "  ",
        instructions: "x",
        cwd: "/tmp",
        schedule: { kind: "interval", every: 30, unit: "minute" },
        wakeImmediately: false,
      }),
    ).toThrow("Name is required");
  });

  it("skips workspace validation on create when cwd is omitted", async () => {
    const create = vi.fn(async () => ({ id: "a1" }));
    const check = vi.fn(() => "bad");
    const handlers = register({ create } as never, null, check);
    await handlers.get("persistentAgents.create")!(null, {
      name: "n",
      instructions: "x",
      schedule: { kind: "interval", every: 30, unit: "minute" },
      wakeImmediately: false,
    });
    expect(check).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalled();
  });

  it("still validates a given cwd on create", () => {
    const create = vi.fn();
    const handlers = register({ create } as never, "bad");
    expect(() =>
      handlers.get("persistentAgents.create")!(null, {
        name: "n",
        instructions: "x",
        cwd: "/nope",
        schedule: { kind: "interval", every: 30, unit: "minute" },
        wakeImmediately: false,
      }),
    ).toThrow("bad");
    expect(create).not.toHaveBeenCalled();
  });
});
