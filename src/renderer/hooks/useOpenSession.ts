import { useCallback, useRef } from "react";
import { useAppStore } from "../store";
import { useIPC } from "./useIPC";

/**
 * 切到某条会话，必要时先把消息与 trace 预载进 store。
 *
 * 侧栏点击与搜索弹窗共用这一份序列：`setActiveSession` 只管「谁开着」，
 * 没预载过的会话被切过去会停在「正在加载历史」——弹窗要跟侧栏行为一致，
 * 就不能各自抄一遍（历史上这是一份内联在 Sidebar 里的代码）。
 *
 * 预载失败**不切换**（切过去只会看着一片空白），`historyHydrated` 仍为 false，
 * 下次再点会重试。返回值就是这件事的答案：`false` 只表示「这次没打开」，
 * 被后一次点击顶掉的旧请求返回 `true` —— 那是正常交接，不是失败。
 */
export function useOpenSession(): (sessionId: string) => Promise<boolean> {
  const { isElectron, getSessionMessagesPage, getSessionTraceSteps } = useIPC();
  // 「最后一次请求」的序号：慢的那次回来时不能盖掉后点的那条会话。
  const loadSeqRef = useRef(0);

  return useCallback(
    async (sessionId: string) => {
      const store = useAppStore.getState();
      if (store.activeSessionId === sessionId) return true;

      const existing = store.sessionStates[sessionId];
      const needsMessages = isElectron && !existing?.historyHydrated;
      const existingSteps = existing?.traceSteps;
      const needsTraceSteps =
        isElectron && (!existingSteps || existingSteps.length === 0);

      if (!needsMessages && !needsTraceSteps) {
        store.setActiveSession(sessionId);
        return true;
      }

      const loadSeq = loadSeqRef.current + 1;
      loadSeqRef.current = loadSeq;

      try {
        if (needsMessages) {
          const page = (await getSessionMessagesPage(
            sessionId,
            null,
            1000,
          )) || { messages: [], hasMore: false };
          if (loadSeqRef.current !== loadSeq) return true;
          store.setMessagesTail(sessionId, page.messages, page.hasMore);
        }

        if (needsTraceSteps) {
          const steps = (await getSessionTraceSteps(sessionId)) || [];
          if (loadSeqRef.current !== loadSeq) return true;
          store.setTraceSteps(sessionId, steps);
        }

        if (loadSeqRef.current !== loadSeq) return true;
        useAppStore.getState().setActiveSession(sessionId);
        return true;
      } catch {
        // 不切换：historyHydrated 仍为 false，用户再点一次就会重试。
        // 是否弹提示由调用方决定（侧栏有列表可重试，弹窗已经关掉了，需要说一声）。
        return false;
      }
    },
    [getSessionMessagesPage, getSessionTraceSteps, isElectron],
  );
}
