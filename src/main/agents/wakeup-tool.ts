/**
 * @module main/agents/wakeup-tool
 *
 * 只给常驻智能体会话的工具：预约 / 取消唤醒、设置下次签到。
 * 不走 codemodeOnly：智能体每次唤醒都可能用到，留在常规工具层。
 */
import { Type } from "@sinclair/typebox";
import type { AgentScheduleConfig } from "../../shared/persistent-agent";
import type { AgentRuntimeCustomTool } from "../extensions/agent-runtime-extension";
import type { PersistentAgentManager } from "./persistent-agent-manager";
import { formatLocalDateTime } from "./wakeup-message";

function textBlock(value: string): {
  content: { type: "text"; text: string }[];
  details: unknown;
} {
  return {
    content: [{ type: "text" as const, text: value }],
    details: undefined as unknown,
  };
}

/** `at` 不带时区偏移时按本地时间解释（JS 对 date-time 字串本就如此）。 */
export function parseWakeupTime(
  params: { at?: string; in_minutes?: number },
  now: number,
): { ok: true; runAt: number } | { ok: false; error: string } {
  const hasAt = typeof params.at === "string" && params.at.trim() !== "";
  const hasMinutes = typeof params.in_minutes === "number";
  if (hasAt === hasMinutes) {
    return { ok: false, error: "Provide exactly one of 'at' or 'in_minutes'." };
  }
  if (hasMinutes) {
    return { ok: true, runAt: now + Math.round(params.in_minutes! * 60_000) };
  }
  const raw = params.at!.trim();
  // 只有日期的 ISO 字串 JS 按 UTC 解析，补成本地零点
  const runAt = Date.parse(
    /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00` : raw,
  );
  if (Number.isNaN(runAt)) {
    return { ok: false, error: "Could not parse 'at' as an ISO 8601 time." };
  }
  return { ok: true, runAt };
}

export function createWakeupTools(
  manager: PersistentAgentManager,
  agentId: string,
  now: () => number = () => Date.now(),
): AgentRuntimeCustomTool[] {
  // 工具描述是给模型看的提示文本，按本仓惯例写英文。
  return [
    {
      name: "schedule_wakeup",
      label: "schedule_wakeup",
      description:
        "Schedule a wakeup at a specific time for a specific task, e.g. to post at 9:00. Give either 'at' (ISO 8601; without an offset it is local time) or 'in_minutes', plus a short reason that will be shown to you when you wake up. To simply check back later, use set_next_check_in.",
      parameters: Type.Object({
        at: Type.Optional(Type.String({ description: "ISO 8601 time." })),
        in_minutes: Type.Optional(
          Type.Number({ description: "Minutes from now." }),
        ),
        reason: Type.String({ description: "What to do when woken up." }),
      }),
      async execute(_toolCallId, params) {
        const input = params as {
          at?: string;
          in_minutes?: number;
          reason: string;
        };
        const parsed = parseWakeupTime(input, now());
        if (!parsed.ok) return textBlock(parsed.error);
        try {
          const wakeup = manager.scheduleWakeup(
            agentId,
            parsed.runAt,
            input.reason,
          );
          return textBlock(
            `Scheduled wakeup ${wakeup.id} at ${formatLocalDateTime(wakeup.runAt)}.`,
          );
        } catch (error) {
          return textBlock(
            error instanceof Error ? error.message : String(error),
          );
        }
      },
    },
    {
      name: "cancel_wakeup",
      label: "cancel_wakeup",
      description: "Cancel a pending wakeup you scheduled, by its id.",
      parameters: Type.Object({
        wakeup_id: Type.String(),
      }),
      async execute(_toolCallId, params) {
        const { wakeup_id } = params as { wakeup_id: string };
        return textBlock(
          manager.cancelWakeup(agentId, wakeup_id)
            ? "Cancelled."
            : "No pending wakeup with that id.",
        );
      },
    },
    {
      name: "set_next_check_in",
      label: "set_next_check_in",
      description:
        "Set when you want to be woken next to check on ongoing work, e.g. while waiting for a build or a reply. Replaces any earlier check-in. Without a check-in you are still woken by your fallback interval. For something that must happen at a specific time, use schedule_wakeup instead.",
      parameters: Type.Object({
        in_minutes: Type.Number({ description: "Minutes from now." }),
        note: Type.Optional(
          Type.String({ description: "What to look at when woken up." }),
        ),
      }),
      async execute(_toolCallId, params) {
        const input = params as { in_minutes: number; note?: string };
        const runAt = now() + Math.round(input.in_minutes * 60_000);
        const note = input.note?.trim() || null;
        try {
          const result = manager.setCheckIn(agentId, runAt, note);
          const limit = formatIntervalForModel(result.schedule);
          const capNote =
            result.capped && limit ? ` (capped at your ${limit} maximum)` : "";
          return textBlock(
            `Check-in set for ${formatLocalDateTime(result.runAt)}${capNote}.`,
          );
        } catch (error) {
          return textBlock(
            error instanceof Error ? error.message : String(error),
          );
        }
      },
    },
  ];
}

/** 给模型看的 interval 时长（如 `30 minutes`、`1 hour`）；其他规则返回 null。 */
export function formatIntervalForModel(
  schedule: AgentScheduleConfig,
): string | null {
  if (schedule.kind !== "interval") return null;
  return `${schedule.every} ${schedule.unit}${schedule.every === 1 ? "" : "s"}`;
}
