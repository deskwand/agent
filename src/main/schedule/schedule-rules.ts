/**
 * @module main/schedule/schedule-rules
 *
 * 周期规则的纯计算：定时任务与常驻智能体共用（从 scheduled-task-manager 搬出）。
 */
import type {
  ScheduleRepeatUnit,
  ScheduledTaskScheduleConfig,
  ScheduledTaskWeekday,
} from "./scheduled-task-manager";

/** setTimeout 的上限；更长的延迟要截断后到点重挂。 */
export const MAX_TIMER_DELAY_MS = 2_147_483_647;

export interface ScheduleRule {
  /** 间隔规则的起算锚点。 */
  runAt: number;
  nextRunAt: number | null;
  scheduleConfig: ScheduledTaskScheduleConfig | null;
  repeatEvery: number | null;
  repeatUnit: ScheduleRepeatUnit | null;
}

export function normalizeRepeatEvery(
  value: number | null | undefined,
): number | null {
  if (typeof value !== "number") return null;
  if (!Number.isFinite(value)) return null;
  const normalized = Math.floor(value);
  if (normalized <= 0) return null;
  return normalized;
}

export function normalizeRepeatUnit(
  value: ScheduleRepeatUnit | null | undefined,
): ScheduleRepeatUnit | null {
  if (value === "minute" || value === "hour" || value === "day") {
    return value;
  }
  return null;
}

export function normalizeScheduleConfig(
  value: ScheduledTaskScheduleConfig | null | undefined,
): ScheduledTaskScheduleConfig | null {
  if (!value) {
    return null;
  }
  if (value.kind === "daily") {
    const times = normalizeScheduleTimes(value.times);
    if (times.length === 0) {
      return null;
    }
    return { kind: "daily", times };
  }
  if (value.kind === "weekly") {
    const times = normalizeScheduleTimes(value.times);
    const weekdays = normalizeWeekdays(value.weekdays);
    if (times.length === 0 || weekdays.length === 0) {
      return null;
    }
    return { kind: "weekly", weekdays, times };
  }
  return null;
}

export function isRepeatingRule(rule: ScheduleRule): boolean {
  return (
    rule.scheduleConfig !== null || Boolean(rule.repeatEvery && rule.repeatUnit)
  );
}

export function computeNextRunAt(
  rule: ScheduleRule,
  now: number,
): number | null {
  if (rule.scheduleConfig) {
    return computeNextRunAtFromScheduleConfig(rule.scheduleConfig, now);
  }
  const intervalMs = getIntervalMs(rule.repeatEvery, rule.repeatUnit);
  if (intervalMs === null) return null;
  const nextBase = rule.nextRunAt ?? rule.runAt;
  if (!Number.isFinite(nextBase)) return null;
  if (nextBase > now) return nextBase;
  const skippedIntervals = Math.floor((now - nextBase) / intervalMs) + 1;
  return nextBase + skippedIntervals * intervalMs;
}

function getIntervalMs(
  repeatEvery: number | null,
  repeatUnit: ScheduleRepeatUnit | null,
): number | null {
  if (!repeatEvery || !repeatUnit) return null;
  if (repeatUnit === "minute") return repeatEvery * 60 * 1000;
  if (repeatUnit === "hour") return repeatEvery * 60 * 60 * 1000;
  return repeatEvery * 24 * 60 * 60 * 1000;
}

function normalizeScheduleTimes(times: string[]): string[] {
  if (!Array.isArray(times)) {
    return [];
  }
  const validTimes = Array.from(
    new Set(times.filter((time) => /^([01]\d|2[0-3]):([0-5]\d)$/.test(time))),
  );
  return validTimes.sort((left, right) => compareTimeStrings(left, right));
}

function normalizeWeekdays(days: number[]): ScheduledTaskWeekday[] {
  if (!Array.isArray(days)) {
    return [];
  }
  const normalized = Array.from(
    new Set(
      days.filter(
        (day): day is ScheduledTaskWeekday =>
          Number.isInteger(day) && day >= 0 && day <= 6,
      ),
    ),
  );
  return normalized.sort((left, right) => left - right);
}

function compareTimeStrings(left: string, right: string): number {
  return toTimeMinutes(left) - toTimeMinutes(right);
}

function toTimeMinutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function computeNextRunAtFromScheduleConfig(
  scheduleConfig: ScheduledTaskScheduleConfig,
  now: number,
): number | null {
  if (scheduleConfig.kind === "daily") {
    return findNextScheduledSlot(now, scheduleConfig.times);
  }
  return findNextScheduledSlot(
    now,
    scheduleConfig.times,
    scheduleConfig.weekdays,
  );
}

function findNextScheduledSlot(
  now: number,
  times: string[],
  weekdays?: ScheduledTaskWeekday[],
): number | null {
  const normalizedTimes = normalizeScheduleTimes(times);
  if (normalizedTimes.length === 0) {
    return null;
  }
  const allowedWeekdays = weekdays
    ? new Set(normalizeWeekdays(weekdays))
    : null;
  const nowDate = new Date(now);

  for (let dayOffset = 0; dayOffset <= 14; dayOffset += 1) {
    const candidateDate = new Date(
      nowDate.getFullYear(),
      nowDate.getMonth(),
      nowDate.getDate() + dayOffset,
      0,
      0,
      0,
      0,
    );
    if (
      allowedWeekdays &&
      !allowedWeekdays.has(candidateDate.getDay() as ScheduledTaskWeekday)
    ) {
      continue;
    }
    for (const time of normalizedTimes) {
      const [hour, minute] = time.split(":").map(Number);
      const candidate = new Date(
        candidateDate.getFullYear(),
        candidateDate.getMonth(),
        candidateDate.getDate(),
        hour,
        minute,
        0,
        0,
      ).getTime();
      if (candidate > now) {
        return candidate;
      }
    }
  }

  return null;
}

/** 数 (fromExclusive, toInclusive] 区间内落了几个周期点，最多数到 cap。 */
export function countSlotsBetween(
  rule: ScheduleRule,
  fromExclusive: number,
  toInclusive: number,
  cap = 999,
): number {
  let count = 0;
  let cursor = fromExclusive;
  while (count < cap) {
    const next = computeNextRunAt({ ...rule, nextRunAt: cursor }, cursor);
    if (next === null || next > toInclusive) break;
    count += 1;
    cursor = next;
  }
  return count;
}
