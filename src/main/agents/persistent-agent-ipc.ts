/**
 * @module main/agents/persistent-agent-ipc
 *
 * 常驻智能体的 IPC 通道（`persistentAgents.*`）。preload 只暴露这些方法。
 */
import type { IpcMain } from "electron";
import type {
  PersistentAgentCreateInput,
  PersistentAgentUpdateInput,
} from "../../shared/persistent-agent";
import type { PersistentAgentManager } from "./persistent-agent-manager";

export interface PersistentAgentIpcDeps {
  ipcMain: Pick<IpcMain, "handle">;
  getManager: () => PersistentAgentManager | null;
  checkWorkspace: (cwd: string) => string | null;
}

export function registerPersistentAgentIpc({
  ipcMain,
  getManager,
  checkWorkspace,
}: PersistentAgentIpcDeps): void {
  const requireManager = (): PersistentAgentManager => {
    const manager = getManager();
    if (!manager) throw new Error("Persistent agent manager not initialized");
    return manager;
  };
  const assertWorkspace = (cwd: string): void => {
    const reason = checkWorkspace(cwd);
    if (reason) throw new Error(reason);
  };
  const assertText = (value: string | undefined, field: string): void => {
    if (value !== undefined && value.trim() === "") {
      throw new Error(`${field} is required`);
    }
  };

  ipcMain.handle("persistentAgents.list", () => getManager()?.list() ?? []);
  ipcMain.handle(
    "persistentAgents.create",
    (_event, input: PersistentAgentCreateInput) => {
      const manager = requireManager();
      assertText(input.name ?? "", "Name");
      assertText(input.instructions ?? "", "Instructions");
      assertWorkspace(input.cwd);
      return manager.create({
        ...input,
        name: input.name.trim(),
        instructions: input.instructions.trim(),
      });
    },
  );
  ipcMain.handle(
    "persistentAgents.update",
    (_event, id: string, patch: PersistentAgentUpdateInput) => {
      const manager = requireManager();
      assertText(patch.name, "Name");
      assertText(patch.instructions, "Instructions");
      return manager.update(id, {
        ...patch,
        ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
        ...(patch.instructions !== undefined
          ? { instructions: patch.instructions.trim() }
          : {}),
      });
    },
  );
  ipcMain.handle(
    "persistentAgents.delete",
    (_event, id: string, options: { deleteSession: boolean }) =>
      requireManager().delete(id, {
        deleteSession: options?.deleteSession === true,
      }),
  );
  ipcMain.handle("persistentAgents.pause", (_event, id: string) =>
    requireManager().pause(id),
  );
  ipcMain.handle("persistentAgents.resume", (_event, id: string) =>
    requireManager().resume(id),
  );
  ipcMain.handle("persistentAgents.wakeNow", (_event, id: string) =>
    requireManager().wakeNow(id),
  );
  ipcMain.handle("persistentAgents.listWakeups", (_event, id: string) =>
    requireManager().listWakeups(id),
  );
  ipcMain.handle(
    "persistentAgents.cancelWakeup",
    (_event, agentId: string, wakeupId: string) =>
      requireManager().cancelWakeup(agentId, wakeupId),
  );
}
