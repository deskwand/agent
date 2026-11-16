/**
 * @module main/agents/session-wakeup-message
 *
 * 把普通会话的一次唤醒（可能合并了多个原因）拼成投递消息。
 * 复用 `<agent_wakeup>` 标签，渲染层走现成的 AgentWakeupRow。
 * 普通会话没有周期规则，所以不出现「周期唤醒」「兜底」这类行。
 */
import { wrapAgentWakeup } from "../../shared/persistent-agent";
import type { SessionWakeup } from "../../shared/session-wakeup";
import { t } from "../i18n";
import { formatLocalDateTime, formatMonthDayClock } from "./wakeup-message";

export interface SessionWakeupMessageInput {
  now: number;
  /** 本次到期的唤醒原因（可能重复）。 */
  reasons: string[];
  /** 仍待执行的预约，按时间升序。 */
  upcoming: SessionWakeup[];
  missedCount: number;
}

export function buildSessionWakeupMessage(
  input: SessionWakeupMessageInput,
): string {
  const weekday = t("agents.wakeup.weekday").split(",")[
    new Date(input.now).getDay()
  ];
  const lines = [
    t("agents.wakeup.header", {
      time: formatLocalDateTime(input.now),
      weekday,
    }),
    t("agents.wakeup.reasons"),
  ];

  for (const reason of new Set(input.reasons)) {
    lines.push(t("agents.wakeup.scheduled", { reason }));
  }

  if (input.upcoming.length > 0) {
    const items = input.upcoming
      .map((w) => `${formatMonthDayClock(w.runAt)} ${w.reason}`)
      .join(t("agents.wakeup.upcomingSeparator"));
    lines.push(t("agents.wakeup.upcoming", { items }));
  }

  if (input.missedCount > 0) {
    lines.push(t("agents.wakeup.missed", { count: input.missedCount }));
  }

  return wrapAgentWakeup(lines.join("\n"));
}
