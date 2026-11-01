import type { TFunction } from "i18next";
import {
  AGENT_SESSION_LOST_ERROR,
  type PersistentAgentView,
} from "../../shared/persistent-agent";

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** 同一天只显示 `HH:mm`，否则 `MM-DD HH:mm`。 */
export function formatWakeTime(at: number, now: number): string {
  const target = new Date(at);
  const today = new Date(now);
  const clock = `${pad(target.getHours())}:${pad(target.getMinutes())}`;
  const sameDay =
    target.getFullYear() === today.getFullYear() &&
    target.getMonth() === today.getMonth() &&
    target.getDate() === today.getDate();
  return sameDay
    ? clock
    : `${pad(target.getMonth() + 1)}-${pad(target.getDate())} ${clock}`;
}

/** 智能体状态文案。「运行中」取自会话本身的 status，主进程不推这个状态。 */
export function formatAgentStatus(
  agent: PersistentAgentView,
  sessionRunning: boolean,
  t: TFunction,
  now: number,
  withReason = true,
): string {
  if (sessionRunning) return t("persistentAgents.status.running");
  if (agent.status === "paused") {
    return agent.lastError === AGENT_SESSION_LOST_ERROR
      ? t("persistentAgents.status.sessionLost")
      : t("persistentAgents.status.paused");
  }
  if (agent.status === "error") return t("persistentAgents.status.error");
  if (!agent.nextWakeup) return t("persistentAgents.status.idle");
  const time = formatWakeTime(agent.nextWakeup.at, now);
  if (agent.nextWakeup.kind === "watchdog") {
    return t("persistentAgents.status.sleepingWatchdog", { time });
  }
  return withReason && agent.nextWakeup.reason
    ? t("persistentAgents.status.sleepingReason", {
        time,
        reason: agent.nextWakeup.reason,
      })
    : t("persistentAgents.status.sleeping", { time });
}
