/**
 * @module main/agents/persistent-agent-extension
 *
 * 常驻智能体与会话运行时的唯一接缝：
 * - 人设走 `systemPromptSuffix`。后缀对同一智能体恒定（不含时间），不破坏提示词缓存；
 *   时间只放在唤醒消息里。
 * - 唤醒工具走 `customTools`，只给 `kind === "agent"` 的会话。
 * - 轮次结果与会话删除转给 manager。
 */
import type { PersistentAgent } from "../../shared/persistent-agent";
import type {
  AfterSessionRunContext,
  AgentRuntimeExtension,
  BeforeSessionRunContext,
  BeforeSessionRunResult,
  SessionDeletedContext,
  SessionRunErrorContext,
} from "../extensions/agent-runtime-extension";
import type { PersistentAgentManager } from "./persistent-agent-manager";
import { createWakeupTools, formatIntervalForModel } from "./wakeup-tool";

export function buildAgentPromptSuffix(
  agent: Pick<PersistentAgent, "name" | "instructions" | "schedule">,
): string {
  const interval = formatIntervalForModel(agent.schedule);
  const cadence = interval
    ? `If you don't set a check-in, you'll be woken at most ${interval} after your last turn ends. While work is in progress or you are waiting on something, set a short check-in with set_next_check_in; when there is nothing to do, don't set one and let the fallback wake you.`
    : "Use set_next_check_in to come back sooner than your next scheduled time when work is in progress.";
  return [
    "<persistent_agent>",
    `You are a long-running agent named "${agent.name}". You are woken up periodically and by wakeups you schedule; each wakeup arrives as an <agent_wakeup> message. The user may also talk to you directly in this session.`,
    "Use schedule_wakeup to plan follow-ups, and keep long-term state (plans, what you have already handled, results) in note files in your working directory, because older context may be compacted.",
    cadence,
    "",
    agent.instructions,
    "</persistent_agent>",
  ].join("\n");
}

export class PersistentAgentExtension implements AgentRuntimeExtension {
  readonly name = "persistent-agent";

  constructor(
    private readonly getManager: () => PersistentAgentManager | null,
  ) {}

  async beforeSessionRun(
    context: BeforeSessionRunContext,
  ): Promise<BeforeSessionRunResult> {
    if (context.session.kind !== "agent") return {};
    const manager = this.getManager();
    const agent = manager?.findBySessionId(context.session.id);
    if (!manager || !agent) return {};
    return {
      systemPromptSuffix: buildAgentPromptSuffix(agent),
      customTools: createWakeupTools(manager, agent.id),
    };
  }

  async afterSessionRun(context: AfterSessionRunContext): Promise<void> {
    if (context.session.kind !== "agent") return;
    const result =
      context.outcome === "failure"
        ? "failure"
        : context.outcome === "cancelled"
          ? "cancelled"
          : "success";
    this.getManager()?.onTurnFinished(
      context.session.id,
      result,
      result === "failure" ? "Turn failed" : undefined,
    );
  }

  async onSessionRunError(context: SessionRunErrorContext): Promise<void> {
    const error = context.error;
    this.getManager()?.onTurnFinished(
      context.sessionId,
      "failure",
      error instanceof Error ? error.message : String(error),
    );
  }

  async onSessionDeleted(context: SessionDeletedContext): Promise<void> {
    this.getManager()?.onSessionLost(context.sessionId);
  }
}
