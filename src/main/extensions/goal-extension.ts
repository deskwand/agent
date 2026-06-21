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
} from "./agent-runtime-extension";

// ─── Types ───────────────────────────────────────────────────────────

const MAX_GOAL_ITERATIONS = 50;

type GoalStatus = "active" | "paused" | "complete" | "cleared" | "blocked" | "budget_limited";

interface GoalState {
  objective: string;
  status: GoalStatus;
  iteration: number;
  firstTurnDone: boolean;
  tokenBudget?: number;
  tokensUsed: number;
  timeBudgetSeconds?: number;
  timeUsedSeconds: number;
  startedAt: number;
  endedAt?: number;
}

// ─── Prompt templates ────────────────────────────────────────────────

function buildGoalSystemPrompt(goal: GoalState): string {
  const lines = [`## Active Goal`];
  lines.push(`Objective: ${goal.objective}`);
  if (goal.tokenBudget) {
    lines.push(`Token used: ${Math.round(goal.tokensUsed).toLocaleString()} / ${goal.tokenBudget.toLocaleString()}`);
  }
  if (goal.timeBudgetSeconds) {
    const elapsed = (Date.now() - goal.startedAt) / 1000;
    lines.push(`Time used: ${formatDuration(elapsed)} / ${formatDuration(goal.timeBudgetSeconds)}`);
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

function buildBudgetLimitedPrompt(goal: GoalState, reason: "token" | "time"): string {
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

function buildResumePrompt(goal: GoalState): string {
  return `Resume working toward the active goal: ${goal.objective}
This is turn #${goal.iteration}. Pick up where you left off.`;
}

// ─── Goal tools ─────────────────────────────────────────────────────

const UpdateGoalSchema = Type.Object({
  status: Type.String({
    description: "New goal status. Only 'complete' or 'blocked' allowed.",
  }),
  summary: Type.String({
    description: "Brief summary of what was accomplished (complete) or what blocks progress (blocked).",
  }),
});

type UpdateGoalInput = { status: "complete" | "blocked"; summary: string };

// ─── Extension ───────────────────────────────────────────────────────

export class GoalExtension implements AgentRuntimeExtension {
  readonly name = "goal";

  /** Goal state keyed by sessionId, so multiple sessions do not interfere. */
  private goals: Map<string, GoalState> = new Map();

  /** Per-session goal tools (get_goal, update_goal). */
  private goalTools: Map<string, AgentRuntimeCustomTool[]> = new Map();

  // ── helpers ──────────────────────────────────────────────────────

  private getGoal(sessionId: string): GoalState | undefined {
    return this.goals.get(sessionId);
  }

  private setGoal(sessionId: string, goal: GoalState): void {
    this.goals.set(sessionId, goal);
  }

  private deleteGoal(sessionId: string): void {
    this.goals.delete(sessionId);
    this.goalTools.delete(sessionId);
  }

  private updateGoalUsage(sessionId: string, ctx: AfterSessionRunContext): void {
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

  private goalStatusPayload(
    goal?: GoalState,
  ): { goalStatus: NonNullable<AfterSessionRunResult["goalStatus"]> } {
    if (!goal) {
      return { goalStatus: { status: "cleared" } };
    }
    return {
      goalStatus: {
        status: goal.status,
        objective: goal.objective,
        iteration: goal.iteration,
        tokensUsed: goal.tokensUsed,
        tokenBudget: goal.tokenBudget,
        timeUsedSeconds: goal.timeUsedSeconds,
        timeBudgetSeconds: goal.timeBudgetSeconds,
      },
    };
  }

  /** Ensure per-session goal tools exist, creating them if needed.
   *  Exposes `get_goal` and `update_goal` to the model. */
  private ensureGoalTools(sessionId: string): AgentRuntimeCustomTool[] {
    let tools = this.goalTools.get(sessionId);
    if (!tools) {
      const sid = sessionId;
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
          if (!goal) return { content: [{ type: "text" as const, text: "No active goal." }], details: {} };
          const remaining = goal.tokenBudget ? Math.max(0, goal.tokenBudget - goal.tokensUsed).toString() : "unlimited";
          const info = [
            `Objective: ${goal.objective}`,
            `Status: ${goal.status}`,
            `Turn: ${goal.iteration}`,
            `Tokens used: ${Math.round(goal.tokensUsed).toLocaleString()}${goal.tokenBudget ? ` / ${goal.tokenBudget.toLocaleString()} (${remaining} remaining)` : " (no budget)"}`,
            `Time used: ${formatDuration(goal.timeUsedSeconds)}${goal.timeBudgetSeconds ? ` / ${formatDuration(goal.timeBudgetSeconds)}` : " (no budget)"}`,
          ];
          return { content: [{ type: "text" as const, text: info.join("\n") }], details: {} };
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
          if (!goal || (goal.status !== "active" && goal.status !== "budget_limited")) {
            return { content: [{ type: "text" as const, text: "There is no active goal to update." }], details: {} };
          }
          if (parsed.status === "complete") {
            goal.status = "complete";
            goal.endedAt = Date.now();
            return { content: [{ type: "text" as const, text: `Goal marked complete. Summary: ${parsed.summary}` }], details: {} };
          }
          if (parsed.status === "blocked") {
            goal.status = "blocked";
            goal.endedAt = Date.now();
            return { content: [{ type: "text" as const, text: `Goal marked blocked. Reason: ${parsed.summary}` }], details: {} };
          }
          return { content: [{ type: "text" as const, text: `Invalid status: ${parsed.status}. Only 'complete' or 'blocked' allowed.` }], details: {} };
        },
      };

      // ── goal_complete (backward compat, delegates to update_goal logic) ──
      const goalComplete: AgentRuntimeCustomTool = {
        name: "goal_complete",
        label: "Goal Complete",
        description:
          "Mark the active goal as complete. Prefer update_goal with status 'complete' instead.",
        parameters: Type.Object({
          summary: Type.String({ description: "Brief summary of what was accomplished." }),
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
          if (!goal || (goal.status !== "active" && goal.status !== "budget_limited")) {
            return { content: [{ type: "text" as const, text: "There is no active goal to complete." }], details: {} };
          }
          goal.status = "complete";
          goal.endedAt = Date.now();
          return { content: [{ type: "text" as const, text: `Goal marked complete. Summary: ${parsed.summary}` }], details: {} };
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
      return { handled: true, message: "No active goal." };
    }

    const parts: string[] = [];
    if (goal.tokenBudget) {
      parts.push(`token: ${Math.round(goal.tokensUsed).toLocaleString()} / ${goal.tokenBudget.toLocaleString()}`);
    }
    if (goal.timeBudgetSeconds) {
      parts.push(`time: ${formatDuration(goal.timeUsedSeconds)} / ${formatDuration(goal.timeBudgetSeconds)}`);
    }
    const budgetStr = parts.length ? ` | ${parts.join(", ")}` : "";

    const statusMap: Record<GoalStatus, string> = {
      active: `🎯 Goal active (turn ${goal.iteration}): ${goal.objective}${budgetStr}`,
      paused: `⏸ Goal paused: ${goal.objective}`,
      complete: `✅ Goal complete: ${goal.objective}`,
      cleared: "No active goal.",
      blocked: `🚫 Goal blocked: ${goal.objective}`,
      budget_limited: `💸 Goal budget exhausted: ${goal.objective}${budgetStr}`,
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
      return { handled: true, message: "Please provide a goal objective." };
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
      tokenBudget,
      tokensUsed: 0,
      timeBudgetSeconds,
      timeUsedSeconds: 0,
      startedAt: Date.now(),
    };
    this.setGoal(sessionId, goal);

    const firstTurnPrompt = buildStartPrompt(goal);
    const notes: string[] = [];
    if (tokenBudget) notes.push(`token budget: ${tokenBudget.toLocaleString()}`);
    if (timeBudgetSeconds) notes.push(`time budget: ${formatDuration(timeBudgetSeconds)}`);
    const budgetNote = notes.length ? ` (${notes.join(", ")})` : "";

    return {
      handled: true,
      message: `Goal started: ${normalized}${budgetNote}`,
      firstTurnPrompt,
      goalStatus: this.goalStatusPayload(goal).goalStatus,
    };
  }

  private pauseGoal(sessionId: string): CommandResult {
    const goal = this.getGoal(sessionId);
    if (!goal || goal.status !== "active") {
      return { handled: true, message: "No active goal to pause." };
    }
    goal.status = "paused";
    return {
      handled: true,
      message: `Goal paused: ${goal.objective}`,
      goalStatus: this.goalStatusPayload(goal).goalStatus,
    };
  }

  private resumeGoal(sessionId: string): CommandResult {
    const goal = this.getGoal(sessionId);
    if (!goal) {
      return { handled: true, message: "No goal to resume." };
    }
    if (goal.status === "complete" || goal.status === "cleared") {
      return {
        handled: true,
        message: `Goal is ${goal.status}; start a new one with /goal <objective>.`,
      };
    }
    if (goal.status === "active") {
      return { handled: true, message: "Goal is already active." };
    }

    goal.status = "active";
    const firstTurnPrompt = buildResumePrompt(goal);
    return {
      handled: true,
      message: `Goal resumed: ${goal.objective}`,
      firstTurnPrompt,
      goalStatus: this.goalStatusPayload(goal).goalStatus,
    };
  }

  private clearGoal(sessionId: string): CommandResult {
    const goal = this.getGoal(sessionId);
    if (!goal) {
      return { handled: true, message: "No goal to clear." };
    }
    this.deleteGoal(sessionId);
    return {
      handled: true,
      message: `Goal cleared.`,
      goalStatus: { status: "cleared" },
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
      const tokensMatch = objective.match(/^--tokens\s+(\d+(?:\.?\d*)?[km]?)(?:\s+(.+))?/i);
      if (tokensMatch) {
        tokenBudget = parseTokenBudget(tokensMatch[1]);
        objective = (tokensMatch[2] ?? "").trim();
        continue;
      }
      const timeMatch = objective.match(/^--time\s+(\d+(?:\.?\d*)?[smh])(?:\s+(.+))?/i);
      if (timeMatch) {
        timeBudgetSeconds = parseTimeBudget(timeMatch[1]);
        objective = (timeMatch[2] ?? "").trim();
        continue;
      }
      break;
    }

    if (tokenBudget !== undefined || timeBudgetSeconds !== undefined) {
      return this.startGoal(sessionId, objective, tokenBudget, timeBudgetSeconds);
    }

    return this.startGoal(sessionId, objective);
  }

  async beforeSessionRun(
    ctx: BeforeSessionRunContext,
  ): Promise<BeforeSessionRunResult | void> {
    const sessionId = ctx.session.id;
    const goal = this.getGoal(sessionId);
    if (!goal || goal.status !== "active") {
      return;
    }

    // Increment iteration at the start of continuation turns.
    if (goal.firstTurnDone) {
      goal.iteration++;
    }
    goal.firstTurnDone = true;

    const promptPrefix = buildGoalSystemPrompt(goal);
    const tools = this.ensureGoalTools(sessionId);
    return { promptPrefix, customTools: tools };
  }

  async afterSessionRun(
    ctx: AfterSessionRunContext,
  ): Promise<AfterSessionRunResult | void> {
    const sessionId = ctx.session.id;
    const goal = this.getGoal(sessionId);

    if (!goal || goal.status !== "active") {
      if (goal?.status === "complete" || goal?.status === "blocked") {
        const payload = this.goalStatusPayload(goal);
        this.deleteGoal(sessionId);
        return payload;
      }
      if (goal?.status === "cleared") {
        this.deleteGoal(sessionId);
      }
      return;
    }

    this.updateGoalUsage(sessionId, ctx);
    // Update wall-clock time
    goal.timeUsedSeconds = (Date.now() - goal.startedAt) / 1000;

    // ── Guardrail 1: max iterations ──
    if (goal.iteration >= MAX_GOAL_ITERATIONS) {
      goal.status = "paused";
      return this.goalStatusPayload(goal);
    }

    // ── Guardrail 2: time budget ──
    if (
      goal.timeBudgetSeconds !== undefined &&
      goal.timeUsedSeconds >= goal.timeBudgetSeconds
    ) {
      goal.status = "budget_limited";
      const continuePrompt = buildBudgetLimitedPrompt(goal, "time");
      return { continuePrompt, ...this.goalStatusPayload(goal) };
    }

    // ── Guardrail 3: token budget (budget_limited for one more turn, not immediate pause) ──
    if (
      goal.tokenBudget !== undefined &&
      goal.tokensUsed >= goal.tokenBudget
    ) {
      goal.status = "budget_limited";
      const continuePrompt = buildBudgetLimitedPrompt(goal, "token");
      return { continuePrompt, ...this.goalStatusPayload(goal) };
    }

    if (goal.status !== "active") {
      return this.goalStatusPayload(goal);
    }

    const continuePrompt = buildContinuePrompt(goal);
    return { continuePrompt, ...this.goalStatusPayload(goal) };
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
