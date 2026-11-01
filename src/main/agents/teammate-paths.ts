/**
 * @module main/agents/teammate-paths
 *
 * 伙伴专属目录的路径函数：`<userData>/teammates/<id>/{workspace,memory}`。
 * id 来自数据库，必须拒绝路径分隔符与 `..`，保证拼出的路径不会跑出 `teammates/`。
 */
import path from "node:path";

export const TEAMMATES_DIRNAME = "teammates";

export function getTeammateRoot(userDataPath: string, agentId: string): string {
  if (
    agentId === "" ||
    agentId === "." ||
    agentId === ".." ||
    agentId.includes("/") ||
    agentId.includes("\\")
  ) {
    throw new Error("Invalid teammate id");
  }
  return path.join(userDataPath, TEAMMATES_DIRNAME, agentId);
}

export function getTeammateWorkspace(
  userDataPath: string,
  agentId: string,
): string {
  return path.join(getTeammateRoot(userDataPath, agentId), "workspace");
}

export function getTeammateMemoryRoot(
  userDataPath: string,
  agentId: string,
): string {
  return path.join(getTeammateRoot(userDataPath, agentId), "memory");
}

/** cwd 是否恰好是该伙伴的专属工作区（子目录与相似前缀都不算）。 */
export function isManagedWorkspace(
  userDataPath: string,
  agent: { id: string; cwd: string },
): boolean {
  return (
    path.resolve(agent.cwd) ===
    path.resolve(getTeammateWorkspace(userDataPath, agent.id))
  );
}
