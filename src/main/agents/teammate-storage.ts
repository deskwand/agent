/**
 * @module main/agents/teammate-storage
 *
 * 伙伴专属目录的文件操作：创建工作区、删除伙伴时清理 `teammates/<id>/`。
 */
import fs from "node:fs";
import type { TeammateStoragePort } from "./persistent-agent-manager";
import {
  getTeammateRoot,
  getTeammateWorkspace,
  isManagedWorkspace,
} from "./teammate-paths";

export function createTeammateStorage(
  userDataPath: string,
  memory: { dispose(agentId: string): Promise<void> },
): TeammateStoragePort {
  return {
    ensureWorkspace(agentId) {
      const workspace = getTeammateWorkspace(userDataPath, agentId);
      fs.mkdirSync(workspace, { recursive: true });
      return workspace;
    },
    isManagedWorkspace: (agent) => isManagedWorkspace(userDataPath, agent),
    async removeAgentData(agentId) {
      await memory.dispose(agentId);
      await fs.promises.rm(getTeammateRoot(userDataPath, agentId), {
        recursive: true,
        force: true,
      });
    },
  };
}
