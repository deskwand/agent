/**
 * @module main/agents/persistent-agent-runtime
 *
 * 把 manager 接到真实的 SessionManager / 渲染层 / 系统通知上（index.ts 只调这一个函数）。
 */
import { Notification } from "electron";
import type { DatabaseInstance } from "../db/database";
import { t } from "../i18n";
import type { SessionManager } from "../session/session-manager";
import type { ServerEvent } from "../../renderer/types";
import { MAX_CONSECUTIVE_FAILURES } from "../../shared/persistent-agent";
import { logError } from "../utils/logger";
import { PersistentAgentManager } from "./persistent-agent-manager";
import { createPersistentAgentStore } from "./persistent-agent-store";

export interface PersistentAgentRuntimeDeps {
  db: DatabaseInstance;
  sessionManager: SessionManager;
  sendToRenderer: (event: ServerEvent) => void;
  checkWorkspace: (cwd: string) => string | null;
}

export function createPersistentAgentRuntime(
  deps: PersistentAgentRuntimeDeps,
): PersistentAgentManager {
  const { sessionManager, sendToRenderer } = deps;
  return new PersistentAgentManager({
    store: createPersistentAgentStore(deps.db),
    checkWorkspace: deps.checkWorkspace,
    sessions: {
      createAgentSession: (name, cwd) =>
        sessionManager.createSessionRecord(name, cwd, { kind: "agent" }).id,
      continueSession: (sessionId, prompt) =>
        sessionManager.continueSession(sessionId, prompt),
      isSessionRunning: (sessionId) =>
        sessionManager.isSessionRunning(sessionId),
      sessionExists: (sessionId) => sessionManager.hasSession(sessionId),
      renameSession: (sessionId, title) => {
        sessionManager.renameSession(sessionId, title);
      },
      releaseSession: (sessionId) =>
        sessionManager.setSessionKind(sessionId, "ordinary"),
      deleteSession: (sessionId) => sessionManager.deleteSession(sessionId),
    },
    onEvent: (event) => {
      if (event.type === "removed") {
        sendToRenderer({
          type: "persistent-agent.remove",
          payload: { agentId: event.agentId },
        });
        return;
      }
      sendToRenderer({
        type: "persistent-agent.update",
        payload: { agent: event.agent },
      });
      if (event.type === "auto-paused") {
        try {
          new Notification({
            title: t("agents.notify.autoPausedTitle"),
            body: t("agents.notify.autoPausedBody", {
              name: event.agent.name,
              count: MAX_CONSECUTIVE_FAILURES,
            }),
          }).show();
        } catch (error) {
          logError("[PersistentAgents] Notification failed:", error);
        }
      }
    },
  });
}
