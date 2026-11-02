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
  const wake = agent.nextWakeup;
  // 兜底（watchdog）与周期（periodic）是系统的心跳，属于实现细节，
  // 不把时间摆给用户看；只有伙伴自己排的签到与预约才显示——那是它给的承诺。
  if (!wake || wake.kind === "watchdog" || wake.kind === "periodic") {
    return t("persistentAgents.status.idle");
  }
  const time = formatWakeTime(wake.at, now);
  return withReason && wake.reason
    ? t("persistentAgents.status.sleepingReason", {
        time,
        reason: wake.reason,
      })
    : t("persistentAgents.status.sleeping", { time });
}
