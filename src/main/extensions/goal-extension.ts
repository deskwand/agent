import { app } from "electron";
import type { TSchema } from "@sinclair/typebox";
import { Type } from "@sinclair/typebox";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type {
  AgentRuntimeExtension,
  AgentRuntimeCustomTool,
  BeforeSessionRunContext,
  BeforeSessionRunResult,
  AfterSessionRunContext,
  AfterSessionRunResult,
  CommandContext,
  CommandResult,
  SessionDeletedContext,
  SessionRunErrorContext,
} from "./agent-runtime-extension";
import type { DatabaseInstance, GoalRow } from "../db/database";

// ─── Types ───────────────────────────────────────────────────────────

export const MAX_GOAL_ITERATIONS = 50;

export type GoalStatus =
  | "active"
  | "paused"
  | "complete"
  | "cleared"
  | "blocked"
  | "budget_limited";

export interface GoalState {
  objective: string;
  status: GoalStatus;
  iteration: number;
  firstTurnDone: boolean;
  generation: number;
  tokenBudget?: number;
  tokensUsed: number;
  timeBudgetSeconds?: number;
  timeUsedSeconds: number;
  startedAt: number;
  endedAt?: number;
}

export interface GoalStatusSnapshot {
  status: GoalStatus;
  objective?: string;
  iteration?: number;
  tokensUsed?: number;
  tokenBudget?: number;
  timeUsedSeconds?: number;
  timeBudgetSeconds?: number;
  activePeriodStartedAt?: number;
}

// ─── Prompt templates ────────────────────────────────────────────────

/** Total elapsed active seconds: accumulated time plus the current active
 *  period's live duration. Non-active states (pause/complete/blocked) are
 *  frozen at their accumulated value. Shared by the system prompt, status
 *  payloads, and the session-list restore payload. */
export function elapsedSeconds(goal: GoalState): number {
  const live = goal.status === "active" || goal.status === "budget_limited";
  return live
    ? goal.timeUsedSeconds + (Date.now() - goal.startedAt) / 1000
    : goal.timeUsedSeconds;
}

export function buildGoalStatusSnapshot(goal: GoalState): GoalStatusSnapshot {
  const live = goal.status === "active" || goal.status === "budget_limited";
  return {
    status: goal.status,
    objective: goal.objective,
    iteration: goal.iteration,
    tokensUsed: goal.tokensUsed,
    tokenBudget: goal.tokenBudget,
    timeUsedSeconds: goal.timeUsedSeconds,
    timeBudgetSeconds: goal.timeBudgetSeconds,
    activePeriodStartedAt: live ? goal.startedAt : undefined,
  };
}

function buildGoalSystemPrompt(goal: GoalState): string {
  const lines = [`## Active Goal`];
  lines.push(`Objective: ${goal.objective}`);
  if (goal.tokenBudget) {
    lines.push(
      `Token used: ${Math.round(goal.tokensUsed).toLocaleString()} / ${goal.tokenBudget.toLocaleString()}`,
    );
  }
  if (goal.timeBudgetSeconds) {
    lines.push(
      `Time used: ${formatDuration(elapsedSeconds(goal))} / ${formatDuration(goal.timeBudgetSeconds)}`,
    );
  }
  lines.push(
    `When the objective is fully achieved, call \`update_goal\` with status "complete" and a brief summary.`,
    `Do not mark the goal complete without concrete evidence.`,
    ``,
    `== Completion Audit ==`,
    `Before calling update_goal complete, verify EVERY requirement:`,
    `- Derive concrete requirements from the objective. Do not shrink scope.`,
    `- For each requirement, find authoritative evidence (file content, command output, test results).`,
    `- Treat uncertain or indirect evidence as NOT achieved — keep working.`,
    `- Completion is proven only when ALL requirements have verifiable evidence.`,
    ``,
    `== Blocked Audit ==`,
    `- Do NOT call update_goal with status "blocked" the first time a blocker appears.`,
    `- Only use "blocked" when the SAME blocking condition has repeated for 3+ consecutive goal turns.`,
    `- Once the threshold is met, call update_goal blocked immediately — do not keep reporting.`,
    `- Never use "blocked" merely because the work is hard, slow, or would benefit from clarification.`,
  );
  return lines.join("\n");
}

function buildContinuePrompt(goal: GoalState): string {
  return `Continue working toward the active goal: ${goal.objective}
This is automatic continuation #${goal.iteration}.
Make concrete progress. Verify completion against the actual current state before calling update_goal.
If the SAME obstacle repeats for 3+ consecutive turns, call update_goal with status "blocked".`;
}

function buildBudgetLimitedPrompt(
  goal: GoalState,
  reason: "token" | "time",
): string {
  let used: string;
  let limit: string;
  if (goal.tokenBudget && (reason === "token" || !goal.timeBudgetSeconds)) {
    used = `${Math.round(goal.tokensUsed).toLocaleString()} tokens`;
    limit = `${goal.tokenBudget.toLocaleString()} tokens`;
  } else {
    used = `${formatDuration(goal.timeUsedSeconds)}`;
    limit = `${formatDuration(goal.timeBudgetSeconds!)}`;
  }
  return `The goal has reached its ${reason} budget (${used} / ${limit}).
Do not start new substantive work. Summarize progress, identify remaining work or blockers, and leave a clear next step.
If the goal is actually complete, call update_goal with status "complete". Otherwise the system will pause the goal after this turn.`;
}

function buildStartPrompt(goal: GoalState): string {
  return `Work toward the following goal: ${goal.objective}
Make concrete progress. When done, call update_goal with status "complete".
Use get_goal to check your current budget consumption at any time.`;
}

export function buildResumePrompt(goal: GoalState): string {
  return `Resume working toward the active goal: ${goal.objective}
This is turn #${goal.iteration}. Pick up where you left off.`;
}

// ─── Goal tools ─────────────────────────────────────────────────────

const UpdateGoalSchema = Type.Object({
  status: Type.String({
    description: "New goal status. Only 'complete' or 'blocked' allowed.",
  }),
  summary: Type.String({
    description:
      "Brief summary of what was accomplished (complete) or what blocks progress (blocked).",
  }),
});

type UpdateGoalInput = { status: "complete" | "blocked"; summary: string };

// ─── Locale messages ────────────────────────────────────────────────

const MSG: Record<string, Record<string, string>> = {
  zh: {
    noActiveGoal: "没有活跃的目标。",
    noGoalToPause: "没有可暂停的目标。",
    noGoalToResume: "没有可恢复的目标。",
    noGoalToClear: "没有可清除的目标。",
    alreadyActive: "目标已在执行中。",
    started: "目标已启动: {{objective}}{{budget}}",
    paused: "目标已暂停: {{objective}}",
    resumed: "目标已恢复: {{objective}}",
    resumedAtCap:
      "目标已恢复: {{objective}}。已达 {{max}} 轮上限，恢复后计数重新开始",
    cleared: "目标已清除。",
    needObjective: "请提供一个目标描述。",
    goalIsStatus: "目标状态为 {{status}}，请用 /goal <目标> 创建新目标。",
    statusActive: "🎯 执行中 (第{{n}}轮): {{objective}}{{budget}}",
    statusPaused: "⏸ 已暂停: {{objective}}",
    statusComplete: "✅ 已完成: {{objective}}",
    statusBlocked: "🚫 已阻塞: {{objective}}",
    statusBudgetLimited: "💸 预算耗尽: {{objective}}{{budget}}",
    summaryComplete: "目标完成",
    summaryBlocked: "目标阻塞",
    summaryCompleteStats: "{{n}} 轮 · {{time}} · {{tokens}}",
    summaryBlockedStats: "{{n}} 轮 · {{time}}",
  },
  en: {
    noActiveGoal: "No active goal.",
    noGoalToPause: "No active goal to pause.",
    noGoalToResume: "No goal to resume.",
    noGoalToClear: "No goal to clear.",
    alreadyActive: "Goal is already active.",
    started: "Goal started: {{objective}}{{budget}}",
    paused: "Goal paused: {{objective}}",
    resumed: "Goal resumed: {{objective}}",
    resumedAtCap:
      "Goal resumed: {{objective}}. Reached the {{max}}-turn cap; counting restarts",
    cleared: "Goal cleared.",
    needObjective: "Please provide a goal objective.",
    goalIsStatus: "Goal is {{status}}; start a new one with /goal <objective>.",
    statusActive: "🎯 Goal active (turn {{n}}): {{objective}}{{budget}}",
    statusPaused: "⏸ Goal paused: {{objective}}",
    statusComplete: "✅ Goal complete: {{objective}}",
    statusBlocked: "🚫 Goal blocked: {{objective}}",
    statusBudgetLimited: "💸 Goal budget exhausted: {{objective}}{{budget}}",
    summaryComplete: "Goal Complete",
    summaryBlocked: "Goal Blocked",
    summaryCompleteStats: "{{n}} turns · {{time}} · {{tokens}}",
    summaryBlockedStats: "{{n}} turns · {{time}}",
  },
};

function getLocale(): string {
  try {
    const l = app.getLocale();
    return l.startsWith("zh") ? "zh" : "en";
  } catch {
    return "en";
  }
}

function msg(key: string, params?: Record<string, string | number>): string {
  const locale = getLocale();
  const tpl = MSG[locale]?.[key] || MSG.en[key] || key;
  if (!params) return tpl;
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) =>
    params[k] !== undefined ? String(params[k]) : `{{${k}}}`,
  );
}

// ─── Extension ───────────────────────────────────────────────────────

export class GoalExtension implements AgentRuntimeExtension {
  readonly name = "goal";

  constructor(private db: DatabaseInstance) {}

  /** Goal state keyed by sessionId, so multiple sessions do not interfere. */
  private goals: Map<string, GoalState> = new Map();

  /** Injected by SessionManager: whether the session's queue is actively running. */
  private isSessionRunning?: (sessionId: string) => boolean;

  setSessionStateProvider(fn: (sessionId: string) => boolean): void {
    this.isSessionRunning = fn;
  }

  /** Per-session goal tools (get_goal, update_goal). */
  private goalTools: Map<string, AgentRuntimeCustomTool[]> = new Map();

  /** Per-session generation snapshots to detect pause/resume mid-turn. */
  private sessionGenerations: Map<string, number> = new Map();

  // ── helpers ──────────────────────────────────────────────────────

  private getGoal(sessionId: string): GoalState | undefined {
    return this.goals.get(sessionId);
  }

  private setGoal(sessionId: string, goal: GoalState): void {
    this.goals.set(sessionId, goal);
    try {
      this.db.goals.upsert({
        session_id: sessionId,
        objective: goal.objective,
        status: goal.status,
        iteration: goal.iteration,
        first_turn_done: goal.firstTurnDone ? 1 : 0,
        generation: goal.generation,
        token_budget: goal.tokenBudget ?? null,
        tokens_used: goal.tokensUsed,
        time_budget_seconds: goal.timeBudgetSeconds ?? null,
        time_used_seconds: goal.timeUsedSeconds,
        started_at: goal.startedAt,
        ended_at: goal.endedAt ?? null,
      });
    } catch (error) {
      // best-effort: DB write failure does not affect in-memory state
      console.error("[GoalExtension] Failed to persist goal:", error);
    }
  }

  public deleteGoal(sessionId: string): void {
    this.goals.delete(sessionId);
    this.goalTools.delete(sessionId);
    this.sessionGenerations.delete(sessionId);
    try {
      this.db.goals.delete(sessionId);
    } catch (error) {
      console.error("[GoalExtension] Failed to delete goal from DB:", error);
    }
  }

  /**
   * Recover goal states from DB into memory on app startup.
   * Terminal state residuals (complete/blocked/cleared) are cleaned up directly.
   * Returns recovered goals for the caller (SessionManager) to process.
   */
  recoverGoals(): Array<{ sessionId: string; goal: GoalState }> {
    let rows: GoalRow[];
    try {
      rows = this.db.goals.getAll();
    } catch (error) {
      console.error("[GoalExtension] Failed to load goals from DB:", error);
      return [];
    }

    const recovered: Array<{ sessionId: string; goal: GoalState }> = [];
    for (const row of rows) {
      // Clean up terminal state residuals
      if (
        row.status === "complete" ||
        row.status === "blocked" ||
        row.status === "cleared"
      ) {
        try {
          this.db.goals.delete(row.session_id);
        } catch {
          // best-effort cleanup
        }
        continue;
      }

      const goal: GoalState = {
        objective: row.objective,
        status: row.status as GoalStatus,
        iteration: row.iteration,
        firstTurnDone: row.first_turn_done === 1,
        generation: row.generation,
        tokenBudget: row.token_budget ?? undefined,
        tokensUsed: row.tokens_used,
        timeBudgetSeconds: row.time_budget_seconds ?? undefined,
        timeUsedSeconds: row.time_used_seconds,
        startedAt: row.started_at,
        endedAt: row.ended_at ?? undefined,
      };

      // Resumable goals restart a fresh active period on recovery so the
      // elapsed clock does not count time the app was closed.
      if (goal.status === "active" || goal.status === "budget_limited") {
        goal.startedAt = Date.now();
      }

      this.goals.set(row.session_id, goal);
      recovered.push({ sessionId: row.session_id, goal });
    }

    return recovered;
  }

  getAllGoals(): Array<{ sessionId: string; goal: GoalState }> {
    return Array.from(this.goals.entries()).map(([sessionId, goal]) => ({
      sessionId,
      goal,
    }));
  }

  private updateGoalUsage(
    sessionId: string,
    ctx: AfterSessionRunContext,
  ): void {
    const goal = this.getGoal(sessionId);
    if (!goal) return;

    let total = 0;
    for (const msg of ctx.messages) {
      if (msg.role === "assistant" && msg.tokenUsage) {
        total += msg.tokenUsage.input ?? 0;
        total += msg.tokenUsage.output ?? 0;
      }
    }
    goal.tokensUsed = total;
  }

  /** Roll the current active period into the accumulated counter and restart
   *  the period clock. Call at every pause/terminal/checkpoint so the elapsed
   *  time never includes paused or offline time. A no-op for paused goals:
   *  paused time must never count (covers a mid-turn pause whose in-flight
   *  turn later completes, and update_goal/complete invoked while paused). */
  private checkpointElapsed(goal: GoalState): void {
    if (goal.status !== "active" && goal.status !== "budget_limited") return;
    goal.timeUsedSeconds += (Date.now() - goal.startedAt) / 1000;
    goal.startedAt = Date.now();
  }

  private goalStatusPayload(goal?: GoalState): {
    goalStatus: NonNullable<AfterSessionRunResult["goalStatus"]>;
  } {
    if (!goal) {
      return { goalStatus: { status: "cleared" } };
    }
    return { goalStatus: buildGoalStatusSnapshot(goal) };
  }

  /** Ensure per-session goal tools exist, creating them if needed.
   *  Exposes `get_goal` and `update_goal` to the model. */
  private ensureGoalTools(sessionId: string): AgentRuntimeCustomTool[] {
    let tools = this.goalTools.get(sessionId);
    if (!tools) {
      const sid = sessionId;
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      const self = this;

      // ── get_goal ──
      const getGoal: AgentRuntimeCustomTool = {
        name: "get_goal",
        label: "Get Goal",
        description:
          "Read the current goal status: objective, tokens used, time used, budget remaining.",
        parameters: Type.Object({}) as unknown as TSchema,
        execute: async () => {
          const goal = self.getGoal(sid);
          if (!goal)
            return {
              content: [{ type: "text" as const, text: "No active goal." }],
              details: {},
            };
          const remaining = goal.tokenBudget
            ? Math.max(0, goal.tokenBudget - goal.tokensUsed).toString()
            : "unlimited";
          const info = [
            `Objective: ${goal.objective}`,
            `Status: ${goal.status}`,
            `Turn: ${goal.iteration}`,
            `Tokens used: ${Math.round(goal.tokensUsed).toLocaleString()}${goal.tokenBudget ? ` / ${goal.tokenBudget.toLocaleString()} (${remaining} remaining)` : " (no budget)"}`,
            `Time used: ${formatDuration(elapsedSeconds(goal))}${goal.timeBudgetSeconds ? ` / ${formatDuration(goal.timeBudgetSeconds)}` : " (no budget)"}`,
          ];
          return {
            content: [{ type: "text" as const, text: info.join("\n") }],
            details: {},
          };
        },
      };

      // ── update_goal ──
      const updateGoal: AgentRuntimeCustomTool = {
        name: "update_goal",
        label: "Update Goal",
        description:
          "Update the goal status. Use 'complete' when verified, 'blocked' only after 3+ consecutive turns with the same obstacle.",
        parameters: UpdateGoalSchema as TSchema,
        execute: async (
          _toolCallId: string,
          params: unknown,
          _signal: AbortSignal | undefined,
          _onUpdate: unknown,
          _ctx: ExtensionContext,
        ) => {
          const parsed = params as UpdateGoalInput;
          const goal = self.getGoal(sid);
          if (!goal) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "There is no active goal to update.",
                },
              ],
              details: {},
            };
          }
          // 终态幂等：complete/blocked 已收尾，重复调用不再报"无活跃目标"
          if (goal.status === "complete" || goal.status === "blocked") {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Goal is already ${goal.status}.`,
                },
              ],
              details: {},
            };
          }
          if (
            goal.status !== "active" &&
            goal.status !== "budget_limited" &&
            goal.status !== "paused"
          ) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "There is no active goal to update.",
                },
              ],
              details: {},
            };
          }
          if (parsed.status === "complete") {
            self.checkpointElapsed(goal);
            goal.status = "complete";
            goal.endedAt = Date.now();
            self.setGoal(sid, goal);
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Goal marked complete. Summary: ${parsed.summary}`,
                },
              ],
              details: {},
            };
          }
          if (parsed.status === "blocked") {
            self.checkpointElapsed(goal);
            goal.status = "blocked";
            goal.endedAt = Date.now();
            self.setGoal(sid, goal);
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Goal marked blocked. Reason: ${parsed.summary}`,
                },
              ],
              details: {},
            };
          }
          return {
            content: [
              {
                type: "text" as const,
                text: `Invalid status: ${parsed.status}. Only 'complete' or 'blocked' allowed.`,
              },
            ],
            details: {},
          };
        },
      };

      // ── goal_complete (backward compat, delegates to update_goal logic) ──
      const goalComplete: AgentRuntimeCustomTool = {
        name: "goal_complete",
        label: "Goal Complete",
        description:
          "Mark the active goal as complete. Prefer update_goal with status 'complete' instead.",
        parameters: Type.Object({
          summary: Type.String({
            description: "Brief summary of what was accomplished.",
          }),
        }) as TSchema,
        execute: async (
          _toolCallId: string,
          params: unknown,
          _signal: AbortSignal | undefined,
          _onUpdate: unknown,
          _ctx: ExtensionContext,
        ) => {
          const parsed = params as { summary: string };
          const goal = self.getGoal(sid);
          if (!goal) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "There is no active goal to complete.",
                },
              ],
              details: {},
            };
          }
          // 终态幂等：已 complete 的 goal 重复标记返回提示而非误导性错误
          if (goal.status === "complete" || goal.status === "blocked") {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Goal is already ${goal.status}.`,
                },
              ],
              details: {},
            };
          }
          if (
            goal.status !== "active" &&
            goal.status !== "budget_limited" &&
            goal.status !== "paused"
          ) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "There is no active goal to complete.",
                },
              ],
              details: {},
            };
          }
          self.checkpointElapsed(goal);
          goal.status = "complete";
          goal.endedAt = Date.now();
          self.setGoal(sid, goal);
          return {
            content: [
              {
                type: "text" as const,
                text: `Goal marked complete. Summary: ${parsed.summary}`,
              },
            ],
            details: {},
          };
        },
      };

      tools = [getGoal, updateGoal, goalComplete];
      this.goalTools.set(sid, tools);
    }
    return tools;
  }

  private showStatus(sessionId: string): CommandResult {
    const goal = this.getGoal(sessionId);
    if (!goal || goal.status === "cleared") {
      return { handled: true, message: msg("noActiveGoal") };
    }

    const parts: string[] = [];
    if (goal.tokenBudget) {
      parts.push(
        `token: ${Math.round(goal.tokensUsed).toLocaleString()} / ${goal.tokenBudget.toLocaleString()}`,
      );
    }
    if (goal.timeBudgetSeconds) {
      parts.push(
        `time: ${formatDuration(elapsedSeconds(goal))} / ${formatDuration(goal.timeBudgetSeconds)}`,
      );
    }
    const budgetStr = parts.length ? ` | ${parts.join(", ")}` : "";

    const statusMap: Record<GoalStatus, string> = {
      active: msg("statusActive", {
        n: goal.iteration,
        objective: goal.objective,
        budget: budgetStr,
      }),
      paused: msg("statusPaused", { objective: goal.objective }),
      complete: msg("statusComplete", { objective: goal.objective }),
      cleared: msg("noActiveGoal"),
      blocked: msg("statusBlocked", { objective: goal.objective }),
      budget_limited: msg("statusBudgetLimited", {
        objective: goal.objective,
        budget: budgetStr,
      }),
    };

    return {
      handled: true,
      message: statusMap[goal.status],
      goalStatus: this.goalStatusPayload(goal).goalStatus,
    };
  }

  private startGoal(
    sessionId: string,
    objective: string,
    tokenBudget?: number,
    timeBudgetSeconds?: number,
  ): CommandResult {
    const normalized = objective.trim();
    if (!normalized) {
      return { handled: true, message: msg("needObjective") };
    }

    const existing = this.getGoal(sessionId);
    if (existing?.status === "active") {
      // Overwrite active goal
    }

    const goal: GoalState = {
      objective: normalized,
      status: "active",
      iteration: 1,
      firstTurnDone: false,
      generation: 1,
      tokenBudget,
      tokensUsed: 0,
      timeBudgetSeconds,
      timeUsedSeconds: 0,
      startedAt: Date.now(),
    };
    this.setGoal(sessionId, goal);

    const firstTurnPrompt = buildStartPrompt(goal);
    const notes: string[] = [];
    if (tokenBudget)
      notes.push(`token budget: ${tokenBudget.toLocaleString()}`);
    if (timeBudgetSeconds)
      notes.push(`time budget: ${formatDuration(timeBudgetSeconds)}`);
    const budgetNote = notes.length ? ` (${notes.join(", ")})` : "";

    return {
      handled: true,
      message: msg("started", { objective: normalized, budget: budgetNote }),
      firstTurnPrompt,
      goalStatus: this.goalStatusPayload(goal).goalStatus,
    };
  }

  private pauseGoal(sessionId: string): CommandResult {
    const goal = this.getGoal(sessionId);
    if (!goal || goal.status !== "active") {
      return { handled: true, message: msg("noGoalToPause") };
    }
    this.checkpointElapsed(goal);
    goal.status = "paused";
    this.setGoal(sessionId, goal);
    return {
      handled: true,
      message: msg("paused", { objective: goal.objective }),
      goalStatus: this.goalStatusPayload(goal).goalStatus,
      clearAutoGenerated: true,
    };
  }

  private resumeGoal(sessionId: string): CommandResult {
    const goal = this.getGoal(sessionId);
    if (!goal) {
      return { handled: true, message: msg("noGoalToResume") };
    }
    if (goal.status === "complete" || goal.status === "cleared") {
      return {
        handled: true,
        message: msg("goalIsStatus", { status: goal.status }),
      };
    }
    const sessionIdle = !this.isSessionRunning?.(sessionId);
    if (goal.status === "active" && !sessionIdle) {
      return { handled: true, message: msg("alreadyActive") };
    }

    goal.status = "active";
    goal.generation++;
    goal.startedAt = Date.now();
    const atMaxCap = goal.iteration >= MAX_GOAL_ITERATIONS;
    // Reset the iteration cap on resume so continuation is not
    // immediately re-paused by the max-iterations guardrail.
    // Restart counting (at 1, never 0) and tell the user when the
    // cap was reached.
    if (atMaxCap) {
      goal.iteration = 1;
    }
    this.setGoal(sessionId, goal);
    // NOTE: the resume prompt shows the pre-increment value (turn #1);
    // the running turn's beforeSessionRun increments it to 2 — same
    // display off-by-one as "continuation #N", declared out of scope.
    const firstTurnPrompt = buildResumePrompt(goal);
    return {
      handled: true,
      message: atMaxCap
        ? msg("resumedAtCap", {
            objective: goal.objective,
            max: MAX_GOAL_ITERATIONS,
          })
        : msg("resumed", { objective: goal.objective }),
      firstTurnPrompt,
      goalStatus: this.goalStatusPayload(goal).goalStatus,
      clearAutoGenerated: true,
    };
  }

  private clearGoal(sessionId: string): CommandResult {
    const goal = this.getGoal(sessionId);
    if (!goal) {
      return { handled: true, message: msg("noGoalToClear") };
    }
    this.deleteGoal(sessionId);
    return {
      handled: true,
      message: msg("cleared"),
      goalStatus: { status: "cleared" },
      clearAutoGenerated: true,
    };
  }

  // ── public lifecycle hooks ───────────────────────────────────────

  async onCommand(context: CommandContext): Promise<CommandResult | void> {
    const { args, sessionId } = context;

    if (!args.trim()) {
      return this.showStatus(sessionId);
    }

    if (args.trim() === "pause") {
      return this.pauseGoal(sessionId);
    }

    if (args.trim() === "resume") {
      return this.resumeGoal(sessionId);
    }

    if (args.trim() === "clear") {
      return this.clearGoal(sessionId);
    }

    // Parse --time and --tokens flags (order-independent, both optional).
    // Extract all flags first, then consume remaining text as the objective.
    let objective = args.trim();
    let tokenBudget: number | undefined;
    let timeBudgetSeconds: number | undefined;

    // Loop to strip flags regardless of order.
    for (;;) {
      const tokensMatch = objective.match(
        /^--tokens\s+(\d+(?:\.?\d*)?[km]?)(?:\s+(.+))?/i,
      );
      if (tokensMatch) {
        tokenBudget = parseTokenBudget(tokensMatch[1]);
        objective = (tokensMatch[2] ?? "").trim();
        continue;
      }
      const timeMatch = objective.match(
        /^--time\s+(\d+(?:\.?\d*)?[smh])(?:\s+(.+))?/i,
      );
      if (timeMatch) {
        timeBudgetSeconds = parseTimeBudget(timeMatch[1]);
        objective = (timeMatch[2] ?? "").trim();
        continue;
      }
      break;
    }

    if (tokenBudget !== undefined || timeBudgetSeconds !== undefined) {
      return this.startGoal(
        sessionId,
        objective,
        tokenBudget,
        timeBudgetSeconds,
      );
    }

    return this.startGoal(sessionId, objective);
  }

  async beforeSessionRun(
    ctx: BeforeSessionRunContext,
  ): Promise<BeforeSessionRunResult | void> {
    const sessionId = ctx.session.id;

    // 工具全局常驻：无论有无 goal、无论 goal 状态，get_goal/update_goal
    // 始终注入。工具列表因此全局恒定——goal 的整个生命周期（启动/暂停/
    // 完成/清除）都不改变系统提示的工具列表，不触发 pi session 重建、
    // 不破坏提示词缓存（prompt cache 前缀匹配）。
    const tools = this.ensureGoalTools(sessionId);

    const goal = this.getGoal(sessionId);
    if (!goal || goal.status !== "active") {
      // 无 goal 或非 active（paused/budget_limited/complete/blocked）：
      // 只注入工具。get_goal 对无目标返回 "No active goal"，update_goal
      // 同样安全拒绝——模型可查询状态或收尾，目标永不悬死。
      return { customTools: tools };
    }

    // Increment iteration at the start of continuation turns.
    if (goal.firstTurnDone) {
      goal.iteration++;
    }
    goal.firstTurnDone = true;

    // Persist iteration / firstTurnDone for restart recovery
    this.setGoal(sessionId, goal);

    // Snapshot generation to detect pause/resume mid-turn
    this.sessionGenerations.set(sessionId, goal.generation);

    const promptPrefix = buildGoalSystemPrompt(goal);
    return { promptPrefix, customTools: tools };
  }

  async afterSessionRun(
    ctx: AfterSessionRunContext,
  ): Promise<AfterSessionRunResult | void> {
    const sessionId = ctx.session.id;
    const goal = this.getGoal(sessionId);

    if (!goal) return;

    // Update stats before any status check so complete/blocked summaries
    // have accurate data.
    this.updateGoalUsage(sessionId, ctx);

    // Roll the current active period into the accumulated counter so the
    // elapsed clock never double-counts paused or offline time.
    this.checkpointElapsed(goal);

    // Persist budget stats for restart recovery (skip if about to delete)
    if (goal.status === "active" || goal.status === "budget_limited") {
      this.setGoal(sessionId, goal);
    }

    if (goal.status !== "active") {
      if (goal.status === "complete" || goal.status === "blocked") {
        const payload = this.goalStatusPayload(goal);
        const summary = buildGoalSummaryMessage(goal);
        this.deleteGoal(sessionId);
        return { ...payload, summaryMessage: summary };
      }
      if (goal.status === "budget_limited") {
        // The final "summarize only" turn after budget exhaustion is done;
        // pause so the elapsed clock freezes. (Resuming from paused will
        // re-hit the budget guardrail; to continue with fresh budgets start a
        // new goal via /goal --tokens/--time <n> <objective>.)
        goal.status = "paused";
        this.setGoal(sessionId, goal);
        return this.goalStatusPayload(goal);
      }
      if (goal.status === "cleared") {
        this.deleteGoal(sessionId);
      }
      return;
    }

    // If goal was paused/resumed mid-turn, skip all continuation.
    const capturedGeneration = this.sessionGenerations.get(sessionId);
    if (
      capturedGeneration !== undefined &&
      capturedGeneration !== goal.generation
    ) {
      return this.goalStatusPayload(goal);
    }

    // ── Guardrail 1: max iterations ──
    if (goal.iteration >= MAX_GOAL_ITERATIONS) {
      goal.status = "paused";
      this.setGoal(sessionId, goal);
      return this.goalStatusPayload(goal);
    }

    // ── Guardrail 2: time budget ──
    if (
      goal.timeBudgetSeconds !== undefined &&
      goal.timeUsedSeconds >= goal.timeBudgetSeconds
    ) {
      goal.status = "budget_limited";
      this.setGoal(sessionId, goal);
      const continuePrompt = buildBudgetLimitedPrompt(goal, "time");
      return { continuePrompt, ...this.goalStatusPayload(goal) };
    }

    // ── Guardrail 3: token budget (budget_limited for one more turn, not immediate pause) ──
    if (goal.tokenBudget !== undefined && goal.tokensUsed >= goal.tokenBudget) {
      goal.status = "budget_limited";
      this.setGoal(sessionId, goal);
      const continuePrompt = buildBudgetLimitedPrompt(goal, "token");
      return { continuePrompt, ...this.goalStatusPayload(goal) };
    }

    if (goal.status !== "active") {
      return this.goalStatusPayload(goal);
    }

    const continuePrompt = buildContinuePrompt(goal);
    return { continuePrompt, ...this.goalStatusPayload(goal) };
  }

  async onSessionRunError(
    context: SessionRunErrorContext,
  ): Promise<AfterSessionRunResult | void> {
    const goal = this.getGoal(context.sessionId);
    if (!goal || goal.status !== "active") {
      return;
    }
    this.checkpointElapsed(goal);
    goal.status = "paused";
    this.setGoal(context.sessionId, goal);
    return this.goalStatusPayload(goal);
  }

  async onSessionDeleted(context: SessionDeletedContext): Promise<void> {
    this.deleteGoal(context.sessionId);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

function parseTokenBudget(raw: string): number | undefined {
  const normalized = raw.trim().toLowerCase();
  const num = parseFloat(normalized);
  if (isNaN(num)) return undefined;
  if (normalized.endsWith("k")) return Math.round(num * 1_000);
  if (normalized.endsWith("m")) return Math.round(num * 1_000_000);
  return Math.round(num);
}

function parseTimeBudget(raw: string): number | undefined {
  const normalized = raw.trim().toLowerCase();
  const num = parseFloat(normalized);
  if (isNaN(num)) return undefined;
  if (normalized.endsWith("s")) return Math.round(num);
  if (normalized.endsWith("m")) return Math.round(num * 60);
  if (normalized.endsWith("h")) return Math.round(num * 3600);
  return Math.round(num * 60); // default to minutes
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return m > 0 ? `${h}h${m}m` : `${h}h`;
}

function formatDurationNatural(seconds: number, locale: string): string {
  const s = Math.round(seconds);
  const isZh = locale.startsWith("zh");

  if (s < 60) {
    return isZh ? `${s} 秒` : s === 1 ? "1 second" : `${s} seconds`;
  }
  if (s < 3600) {
    const m = Math.round(s / 60);
    return isZh ? `${m} 分钟` : m === 1 ? "1 minute" : `${m} minutes`;
  }
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (m === 0) {
    return isZh ? `${h} 小时` : h === 1 ? "1 hour" : `${h} hours`;
  }
  return isZh ? `${h} 小时 ${m} 分钟` : `${h}h ${m}m`;
}

function formatTokens(count: number, locale: string): string {
  const rounded = Math.round(count);
  const isZh = locale.startsWith("zh");

  if (isZh) {
    if (rounded >= 10000) {
      // Use integer modulo to avoid floating-point edge cases with % 1
      if (rounded % 10000 === 0) {
        return `${rounded / 10000}万 tokens`;
      }
      return `${(rounded / 10000).toFixed(1)}万 tokens`;
    }
    return `${rounded.toLocaleString()} tokens`;
  }

  if (rounded >= 1000000) {
    if (rounded % 1000000 === 0) {
      return `${rounded / 1000000}M tokens`;
    }
    return `${(rounded / 1000000).toFixed(1)}M tokens`;
  }
  if (rounded >= 1000) {
    if (rounded % 1000 === 0) {
      return `${rounded / 1000}K tokens`;
    }
    return `${(rounded / 1000).toFixed(1)}K tokens`;
  }
  return `${rounded.toLocaleString()} tokens`;
}

function buildGoalSummaryMessage(goal: GoalState): string {
  const locale = getLocale();
  const timeStr = formatDurationNatural(goal.timeUsedSeconds, locale);
  const tokenStr = formatTokens(goal.tokensUsed, locale);
  const title =
    goal.status === "complete" ? msg("summaryComplete") : msg("summaryBlocked");
  const templates: Parameters<typeof msg>[1] = {
    n: goal.iteration,
    time: timeStr,
    tokens: tokenStr,
  };
  const stats =
    goal.status === "complete"
      ? msg("summaryCompleteStats", templates)
      : msg("summaryBlockedStats", templates);
  return [`> **${title}**`, `> **${goal.objective}**`, `> ${stats}`].join("\n");
}
