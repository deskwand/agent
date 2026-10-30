import { useEffect, useRef } from "react";
import { useAppStore } from "../store";
import { useIPC } from "./useIPC";

/**
 * 保证区域里的会话历史已载入 store。
 *
 * `useOpenSession` 只覆盖「点侧栏打开」这一条路径；分屏后会话还会经「在分屏中打开」、
 * 拖拽落区、恢复布局直接进入区域，那些路径不会预载，区域就会一直停在「正在加载历史」。
 * 载入方式与 `useOpenSession` 一致；失败静默（historyHydrated 仍为 false，换会话/重挂载再试）。
 */
export function useEnsureSessionHydrated(sessionId: string | null): void {
  const { isElectron, getSessionMessagesPage, getSessionTraceSteps } = useIPC();
  const hydrated = useAppStore((s) =>
    sessionId ? Boolean(s.sessionStates[sessionId]?.historyHydrated) : true,
  );
  const inFlightRef = useRef<Set<string>>(new Set());
  const latestIdRef = useRef<string | null>(sessionId);

  useEffect(() => {
    latestIdRef.current = sessionId;
    if (!isElectron || !sessionId || hydrated) return;
    const inFlight = inFlightRef.current;
    if (inFlight.has(sessionId)) return;
    inFlight.add(sessionId);

    void (async () => {
      try {
        const page = (await getSessionMessagesPage(sessionId, null, 1000)) || {
          messages: [],
          hasMore: false,
        };
        if (latestIdRef.current !== sessionId) return;
        const store = useAppStore.getState();
        store.setMessagesTail(sessionId, page.messages, page.hasMore);

        const existingSteps =
          useAppStore.getState().sessionStates[sessionId]?.traceSteps;
        if (!existingSteps || existingSteps.length === 0) {
          const steps = (await getSessionTraceSteps(sessionId)) || [];
          if (latestIdRef.current !== sessionId) return;
          useAppStore.getState().setTraceSteps(sessionId, steps);
        }
      } catch {
        // 静默：historyHydrated 仍为 false，下次进入该区域会重试。
      } finally {
        inFlight.delete(sessionId);
      }
    })();
  }, [
    sessionId,
    hydrated,
    isElectron,
    getSessionMessagesPage,
    getSessionTraceSteps,
  ]);
}
