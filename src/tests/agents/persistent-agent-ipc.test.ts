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
        "persistentAgents.addToProject",
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

  it("validates and passes through riskyCapabilities / trustedRecipients on update", () => {
    const update = vi.fn();
    const handlers = register({ update } as unknown as PersistentAgentManager);
    const handler = handlers.get("persistentAgents.update")!;
    expect(() =>
      handler(null, "a1", { riskyCapabilities: { shell: "yes" } }),
    ).toThrow();
    expect(() => handler(null, "a1", { trustedRecipients: [1] })).toThrow();
    const caps = { shell: true, browser: false, computer: false };
    handler(null, "a1", {
      riskyCapabilities: caps,
      trustedRecipients: [" Bob@X.com "],
    });
    expect(update).toHaveBeenCalledWith("a1", {
      riskyCapabilities: caps,
      trustedRecipients: ["bob@x.com"],
    });
  });

  it("validates and passes riskyCapabilities through on create", () => {
    const create = vi.fn();
    const handlers = register({ create } as unknown as PersistentAgentManager);
    const base = {
      name: "n",
      instructions: "i",
      cwd: "/tmp",
      schedule: { kind: "interval", every: 30, unit: "minute" },
      wakeImmediately: false,
    };
    const handler = handlers.get("persistentAgents.create")!;
    expect(() =>
      handler(null, { ...base, riskyCapabilities: { shell: true } }),
    ).toThrow();
    const caps = { shell: false, browser: true, computer: false };
    handler(null, { ...base, riskyCapabilities: caps });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ riskyCapabilities: caps }),
    );
  });
});

describe("persistentAgents.addToProject", () => {
  function managerStub() {
    return {
      createForProject: vi.fn(async (input: unknown) => input),
    } as unknown as PersistentAgentManager;
  }

  const input = {
    cwd: " /tmp/proj ",
    name: " 瓦力 ",
    instructions: " 盯构建 ",
    schedule: { kind: "interval", every: 30, unit: "minute" },
    wakeImmediately: false,
  };

  it("trims and forwards to createForProject", () => {
    const manager = managerStub();
    const handlers = register(manager);
    handlers.get("persistentAgents.addToProject")!(null, input);
    const calls = (
      manager.createForProject as unknown as {
        mock: { calls: unknown[][] };
      }
    ).mock.calls;
    const passed = calls[0][0] as Record<string, unknown>;
    expect(passed.cwd).toBe("/tmp/proj");
    expect(passed.name).toBe("瓦力");
    expect(passed.instructions).toBe("盯构建");
    expect(passed.wakeImmediately).toBe(false);
  });

  it("rejects an unusable directory", () => {
    const handlers = register(managerStub(), "workspace-missing");
    expect(() =>
      handlers.get("persistentAgents.addToProject")!(null, input),
    ).toThrow("workspace-missing");
  });

  it("rejects an empty workspace", () => {
    const handlers = register(managerStub());
    expect(() =>
      handlers.get("persistentAgents.addToProject")!(null, {
        ...input,
        cwd: "  ",
      }),
    ).toThrow("Workspace is required");
  });
});
