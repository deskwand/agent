import type { AgentScheduleConfig } from "../../../shared/persistent-agent";

export type AgentWeekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface AgentScheduleFormState {
  mode: "interval" | "daily" | "weekly";
  every: number;
  unit: "minute" | "hour" | "day";
  times: string[];
  weekdays: AgentWeekday[];
}

export const DEFAULT_AGENT_SCHEDULE_FORM: AgentScheduleFormState = {
  mode: "interval",
  every: 30,
  unit: "minute",
  times: [],
  weekdays: [],
};

/** 表单 → 周期规则；不合法返回 null。分钟级间隔至少 5 分钟，免得空烧额度。 */
export function toAgentScheduleConfig(
  form: AgentScheduleFormState,
): AgentScheduleConfig | null {
  if (form.mode === "interval") {
    if (!Number.isInteger(form.every) || form.every <= 0) return null;
    if (form.unit === "minute" && form.every < 5) return null;
    return { kind: "interval", every: form.every, unit: form.unit };
  }
  const times = Array.from(new Set(form.times)).sort();
  if (times.length === 0) return null;
  if (form.mode === "daily") return { kind: "daily", times };
  const weekdays = Array.from(new Set(form.weekdays)).sort((a, b) => a - b);
  if (weekdays.length === 0) return null;
  return { kind: "weekly", weekdays, times };
}

export function fromAgentScheduleConfig(
  config: AgentScheduleConfig,
): AgentScheduleFormState {
  if (config.kind === "interval") {
    return {
      ...DEFAULT_AGENT_SCHEDULE_FORM,
      every: config.every,
      unit: config.unit,
    };
  }
  return {
    ...DEFAULT_AGENT_SCHEDULE_FORM,
    mode: config.kind,
    times: [...config.times],
    weekdays: config.kind === "weekly" ? [...config.weekdays] : [],
  };
}
