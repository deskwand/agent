import { create } from "zustand";
import type { PersistentAgentView } from "../../shared/persistent-agent";

interface PersistentAgentState {
  agents: Record<string, PersistentAgentView>;
  setAll: (list: PersistentAgentView[]) => void;
  upsert: (agent: PersistentAgentView) => void;
  remove: (id: string) => void;
}

/** 常驻智能体列表：主进程推 `persistent-agent.*` 事件，这里只镜像。 */
export const usePersistentAgentStore = create<PersistentAgentState>((set) => ({
  agents: {},
  setAll: (list) =>
    set({ agents: Object.fromEntries(list.map((agent) => [agent.id, agent])) }),
  upsert: (agent) =>
    set((state) => ({ agents: { ...state.agents, [agent.id]: agent } })),
  remove: (id) =>
    set((state) => {
      const next = { ...state.agents };
      delete next[id];
      return { agents: next };
    }),
}));
