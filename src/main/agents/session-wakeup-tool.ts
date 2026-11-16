/**
 * @module main/agents/session-wakeup-tool
 *
 * 只给普通会话（kind === "ordinary"）的自唤醒工具。
 * 不提供 set_next_check_in：它的语义依赖兜底 interval，普通会话没有。
 */
import { Type } from "@sinclair/typebox";
import type { AgentRuntimeCustomTool } from "../extensions/agent-runtime-extension";
import type { SessionWakeupManager } from "./session-wakeup-manager";
import { formatLocalDateTime } from "./wakeup-message";
import { parseWakeupTime } from "./wakeup-tool";

function textBlock(value: string): {
  content: { type: "text"; text: string }[];
  details: unknown;
} {
  return {
    content: [{ type: "text" as const, text: value }],
    details: undefined as unknown,
  };
}

export function createSessionWakeupTools(
  manager: SessionWakeupManager,
  sessionId: string,
  now: () => number = () => Date.now(),
): AgentRuntimeCustomTool[] {
  return [
    {
      name: "schedule_wakeup",
      label: "schedule_wakeup",
      description:
        "Schedule a wakeup for yourself in this conversation, e.g. to check a build or a deployment at a specific time. Give either 'at' (ISO 8601; without an offset it is local time) or 'in_minutes', plus a short reason that will be shown to you when you wake up. Use it only when something has to happen later; for work you can do now, just do it.",
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
          reason?: string;
        };
        const reason = input.reason?.trim();
        if (!reason) {
          return textBlock(
            "Provide a short reason so you know what to do when you wake up.",
          );
        }
        const parsed = parseWakeupTime(input, now());
        if (!parsed.ok) return textBlock(parsed.error);
        try {
          const wakeup = manager.schedule(sessionId, parsed.runAt, reason);
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
          manager.cancel(sessionId, wakeup_id)
            ? "Cancelled."
            : "No pending wakeup with that id.",
        );
      },
    },
  ];
}
