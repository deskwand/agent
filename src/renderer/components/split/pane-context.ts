import { createContext, useContext } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "../../store";
import { useActiveSessionId, useCurrentSession } from "../../store/selectors";
import { useFocusedPaneId } from "../../store/split-layout";
import type { PaneId } from "../../store/split-tree";
import type { Session } from "../../types";

export interface PaneContextValue {
  paneId: PaneId;
  sessionId: string | null;
}

export const PaneContext = createContext<PaneContextValue | null>(null);

/** 区域会话 id；Provider 外回退全局 activeSessionId。 */
export function usePaneSessionId(): string | null {
  const ctx = useContext(PaneContext);
  const globalId = useActiveSessionId();
  return ctx ? ctx.sessionId : globalId;
}

/** 区域会话对象；Provider 外回退全局当前会话。 */
export function usePaneSession(): Session | null {
  const ctx = useContext(PaneContext);
  const globalSession = useCurrentSession();
  const paneSession = useAppStore(
    useShallow((s) =>
      ctx?.sessionId
        ? (s.sessions.find((sess) => sess.id === ctx.sessionId) ?? null)
        : null,
    ),
  );
  return ctx ? paneSession : globalSession;
}

/** 本区域是否为聚焦区域；Provider 外恒为 true。 */
export function useIsFocusedPane(): boolean {
  const ctx = useContext(PaneContext);
  const focusedPaneId = useFocusedPaneId();
  return ctx ? ctx.paneId === focusedPaneId : true;
}

export function usePaneId(): PaneId | null {
  return useContext(PaneContext)?.paneId ?? null;
}
