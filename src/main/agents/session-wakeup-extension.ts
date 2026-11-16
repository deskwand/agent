/**
 * @module main/agents/session-wakeup-extension
 *
 * 普通会话与会话运行时的唯一接缝：
 * - 提示词后缀走 `systemPromptSuffix`，内容恒定（不含时间），不破坏提示词缓存；
 * - 工具走 `customTools`，只给 `kind === "ordinary"` 的会话；
 * - 轮次开始/结束与会话删除转给 manager。
 */
import type {
  AfterSessionRunContext,
  AgentRuntimeExtension,
  BeforeSessionRunContext,
  BeforeSessionRunResult,
  SessionDeletedContext,
  SessionRunErrorContext,
} from "../extensions/agent-runtime-extension";
import type { SessionWakeupManager } from "./session-wakeup-manager";
import { createSessionWakeupTools } from "./session-wakeup-tool";

export const SESSION_WAKEUP_PROMPT_SUFFIX = [
  "<self_wakeup>",
  "You can schedule a wakeup for yourself with schedule_wakeup. When it fires you are woken up in this same conversation with your reason included, so you can continue the work.",
  "Use it only when something genuinely has to happen later (waiting on a build, a deployment, a reply). Do not schedule a wakeup for work you can just do now, and do not schedule one just to keep yourself busy.",
  "You are not woken on a fixed rhythm: without a scheduled wakeup this conversation stays silent.",
  "</self_wakeup>",
].join("\n");

export class SessionWakeupExtension implements AgentRuntimeExtension {
  readonly name = "session-wakeup";

  constructor(private readonly getManager: () => SessionWakeupManager | null) {}

  async beforeSessionRun(
    context: BeforeSessionRunContext,
  ): Promise<BeforeSessionRunResult> {
    if (context.session.kind !== "ordinary") return {};
    const manager = this.getManager();
    if (!manager) return {};
    manager.beginRun(context.session.id, context.prompt);
    return {
      systemPromptSuffix: SESSION_WAKEUP_PROMPT_SUFFIX,
      customTools: createSessionWakeupTools(manager, context.session.id),
    };
  }

  async afterSessionRun(context: AfterSessionRunContext): Promise<void> {
    if (context.session.kind !== "ordinary") return;
    this.getManager()?.onTurnFinished(context.session.id);
  }

  async onSessionRunError(context: SessionRunErrorContext): Promise<void> {
    this.getManager()?.onTurnFinished(context.sessionId);
  }

  async onSessionDeleted(context: SessionDeletedContext): Promise<void> {
    this.getManager()?.onSessionDeleted(context.sessionId);
  }

  async onSessionClosed(context: SessionDeletedContext): Promise<void> {
    this.getManager()?.onSessionDeleted(context.sessionId);
  }
}
