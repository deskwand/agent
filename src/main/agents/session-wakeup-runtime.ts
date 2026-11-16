/**
 * @module main/agents/session-wakeup-runtime
 *
 * 把 SessionWakeupManager 接到真实的 SessionManager 与渲染层事件上。
 */
import type { ServerEvent } from "../../renderer/types";
import type { DatabaseInstance } from "../db/database";
import type { SessionManager } from "../session/session-manager";
import { SessionWakeupManager } from "./session-wakeup-manager";
import { createSessionWakeupStore } from "./session-wakeup-store";

export interface SessionWakeupRuntimeDeps {
  db: DatabaseInstance;
  sessionManager: SessionManager;
  sendToRenderer: (event: ServerEvent) => void;
}

export function createSessionWakeupRuntime(
  deps: SessionWakeupRuntimeDeps,
): SessionWakeupManager {
  const { sessionManager, sendToRenderer } = deps;
  return new SessionWakeupManager({
    store: createSessionWakeupStore(deps.db),
    sessions: {
      continueSession: (sessionId, prompt) =>
        sessionManager.continueSession(
          sessionId,
          prompt,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          true,
        ),
      isSessionRunning: (sessionId) =>
        sessionManager.isSessionRunning(sessionId),
      sessionExists: (sessionId) => sessionManager.hasSession(sessionId),
      isOrdinarySession: (sessionId) =>
        sessionManager.getSessionKind(sessionId) === "ordinary",
    },
    onEvent: (event) => {
      sendToRenderer({
        type: "session-wakeup.update",
        payload: {
          sessionId: event.sessionId,
          next: event.type === "removed" ? null : event.next,
        },
      });
    },
  });
}
