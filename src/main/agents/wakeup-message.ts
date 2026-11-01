/**
 * @module main/agents/wakeup-message
 *
 * 把一次唤醒（可能合并了多个触发原因）拼成投递给智能体会话的消息。
 * 纯函数；文案走主进程 i18n（当前语言），外层包 `<agent_wakeup>` 供渲染层识别。
 */
import {
  wrapAgentWakeup,
  type AgentScheduleConfig,
  type PersistentAgentWakeup,
} from "../../shared/persistent-agent";
import { t } from "../i18n";

export type WakeupTrigger =
  | { type: "periodic" }
  | { type: "scheduled"; reason: string }
  | { type: "manual" }
  | { type: "check_in"; note: string | null }
  | { type: "watchdog" };

export interface WakeupMessageInput {
  now: number;
  schedule: AgentScheduleConfig;
  triggers: WakeupTrigger[];
  /** 仍待执行的预约，按时间升序。 */
  upcoming: PersistentAgentWakeup[];
  missedCount: number;
}

const MAX_UPCOMING_LISTED = 5;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** 本地时间 `YYYY-MM-DD HH:mm`。 */
export function formatLocalDateTime(ts: number): string {
  return `${formatDate(ts)} ${formatClock(ts)}`;
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatClock(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatMonthDayClock(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${formatClock(ts)}`;
}

export function describeSchedule(schedule: AgentScheduleConfig): string {
  const sep = t("agents.wakeup.listSeparator");
  if (schedule.kind === "interval") {
    return t(`agents.wakeup.ruleInterval.${schedule.unit}`, {
      every: schedule.every,
    });
  }
  const times = schedule.times.join(sep);
  if (schedule.kind === "daily") {
    return t("agents.wakeup.ruleDaily", { times });
  }
  const names = t("agents.wakeup.weekdayShort").split(",");
  const days = schedule.weekdays.map((day) => names[day]).join(sep);
  return t("agents.wakeup.ruleWeekly", { days, times });
}

export function buildWakeupMessage(input: WakeupMessageInput): string {
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

  // 同类触发合并：多次周期 / 手动只列一行，预约按原因去重
  const seen = new Set<string>();
  for (const trigger of input.triggers) {
    const key =
      trigger.type === "scheduled"
        ? `s:${trigger.reason}`
        : trigger.type === "check_in"
          ? `c:${trigger.note ?? ""}`
          : trigger.type;
    if (seen.has(key)) continue;
    seen.add(key);
    if (trigger.type === "periodic") {
      lines.push(
        t("agents.wakeup.periodic", { rule: describeSchedule(input.schedule) }),
      );
    } else if (trigger.type === "scheduled") {
      lines.push(t("agents.wakeup.scheduled", { reason: trigger.reason }));
    } else if (trigger.type === "check_in") {
      lines.push(
        trigger.note
          ? t("agents.wakeup.checkIn", { note: trigger.note })
          : t("agents.wakeup.checkInBare"),
      );
    } else if (trigger.type === "watchdog") {
      lines.push(
        t("agents.wakeup.watchdog", {
          duration: describeInterval(input.schedule) ?? "",
        }),
      );
    } else {
      lines.push(t("agents.wakeup.manual"));
    }
  }

  if (input.upcoming.length > 0) {
    const items = input.upcoming
      .slice(0, MAX_UPCOMING_LISTED)
      .map((w) => `${formatMonthDayClock(w.runAt)} ${w.reason}`)
      .join(t("agents.wakeup.upcomingSeparator"));
    lines.push(t("agents.wakeup.upcoming", { items }));
  }

  if (input.missedCount > 0) {
    lines.push(t("agents.wakeup.missed", { count: input.missedCount }));
  }

  const interval = describeInterval(input.schedule);
  if (interval) {
    lines.push(t("agents.wakeup.cadence", { duration: interval }));
  }

  return wrapAgentWakeup(lines.join("\n"));
}

/** interval 规则的时长描述（如「30 分钟」）；其他规则返回 null。 */
export function describeInterval(schedule: AgentScheduleConfig): string | null {
  if (schedule.kind !== "interval") return null;
  return t(`agents.wakeup.duration.${schedule.unit}`, {
    every: schedule.every,
  });
}
