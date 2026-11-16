import { create } from "zustand";
import type { SessionWakeupView } from "../../shared/session-wakeup";

interface SessionWakeupState {
  /** sessionId → 下一次唤醒；没有预约的会话不占键。 */
  next: Record<string, SessionWakeupView>;
  /** 每次写入 +1。chip 用它判断「拉取期间有没有更新的推送」，避免拿旧快照覆盖。 */
  revision: number;
  upsert: (sessionId: string, next: SessionWakeupView | null) => void;
}

/** 普通会话的自我唤醒：主进程推 `session-wakeup.update`，这里只镜像。 */
export const useSessionWakeupStore = create<SessionWakeupState>((set) => ({
  next: {},
  revision: 0,
  upsert: (sessionId, next) =>
    set((state) => {
      const draft = { ...state.next };
      if (next) draft[sessionId] = next;
      else delete draft[sessionId];
      return { next: draft, revision: state.revision + 1 };
    }),
}));
