import * as fs from "fs";
import * as path from "path";
import { describe, it, expect } from "vitest";

const chatViewSource = fs.readFileSync(
  path.join(__dirname, "../../renderer/components/ChatView.tsx"),
  "utf8",
);
import {
  computeElapsedSeconds,
  isGoalTimeLive,
  resolveInputStatus,
} from "../../renderer/components/ChatInputStatusBar";

describe("resolveInputStatus", () => {
  const base = {
    isSending: false,
    isCompacting: false,
    compactionResult: null as "success" | "failed" | "aborted" | null,
    shouldShowThinkingIndicator: false,
    isResponding: false,
    backgroundAgentRows: [],
  };

  it("returns null when all inputs are inactive", () => {
    expect(resolveInputStatus(base)).toBeNull();
  });

  it("returns compacting when isCompacting is true", () => {
    expect(resolveInputStatus({ ...base, isCompacting: true })).toEqual({
      type: "compacting",
    });
  });

  it("returns sending when isSending is true", () => {
    expect(resolveInputStatus({ ...base, isSending: true })).toEqual({
      type: "sending",
    });
  });

  it("compacting wins over everything else", () => {
    expect(
      resolveInputStatus({
        ...base,
        isSending: true,
        isCompacting: true,
        compactionResult: "failed",
        shouldShowThinkingIndicator: true,
        isResponding: false,
      }),
    ).toEqual({ type: "compacting" });
  });

  it("returns compaction-failed when result is failed", () => {
    expect(resolveInputStatus({ ...base, compactionResult: "failed" })).toEqual(
      { type: "compaction-failed" },
    );
  });

  it("returns compaction-aborted for a cancelled compaction", () => {
    expect(
      resolveInputStatus({ ...base, compactionResult: "aborted" }),
    ).toEqual({ type: "compaction-aborted" });
  });

  it("returns thinking when shouldShowThinkingIndicator is true", () => {
    expect(
      resolveInputStatus({ ...base, shouldShowThinkingIndicator: true }),
    ).toEqual({ type: "thinking" });
  });

  it("returns responding when isResponding is true", () => {
    expect(resolveInputStatus({ ...base, isResponding: true })).toEqual({
      type: "responding",
    });
  });

  it("thinking wins over responding", () => {
    expect(
      resolveInputStatus({
        ...base,
        shouldShowThinkingIndicator: true,
        isResponding: true,
      }),
    ).toEqual({ type: "thinking" });
  });

  it("returns compaction-success only when nothing higher is active", () => {
    expect(
      resolveInputStatus({ ...base, compactionResult: "success" }),
    ).toEqual({ type: "compaction-success" });
  });

  it("compaction-success wins over thinking", () => {
    expect(
      resolveInputStatus({
        ...base,
        compactionResult: "success",
        shouldShowThinkingIndicator: true,
      }),
    ).toEqual({ type: "compaction-success" });
  });

  // ── backgroundAgentRows（面板行，含已完成的）──

  it("returns background-agent for a single running agent", () => {
    expect(
      resolveInputStatus({
        ...base,
        backgroundAgentRows: [
          {
            toolCallId: "a",
            type: "Explore",
            description: "search code",
            status: "running",
            stepCount: 1,
            durationMs: 100,
          },
        ],
      }),
    ).toEqual({
      type: "background-agent",
      count: 1,
      detail: "Explore · search code",
      done: false,
    });
  });

  it("returns background-agent with count for multiple agents", () => {
    expect(
      resolveInputStatus({
        ...base,
        backgroundAgentRows: [
          {
            toolCallId: "a",
            type: "Explore",
            description: "find bug",
            status: "running",
            stepCount: 1,
            durationMs: 100,
          },
          {
            toolCallId: "b",
            type: "Review",
            description: "check fix",
            status: "running",
            stepCount: 1,
            durationMs: 100,
          },
        ],
      }),
    ).toEqual({
      type: "background-agent",
      count: 2,
      detail: undefined,
      done: false,
    });
  });

  it("returns background-agent done when all agents completed", () => {
    expect(
      resolveInputStatus({
        ...base,
        backgroundAgentRows: [
          {
            toolCallId: "a",
            type: "Explore",
            description: "find bug",
            status: "completed",
            stepCount: 1,
            durationMs: 100,
          },
        ],
      }),
    ).toEqual({
      type: "background-agent",
      count: 1,
      detail: undefined,
      done: true,
    });
  });

  it("全部结束但有失败时带上 hasError（不把失败说成已完成）", () => {
    expect(
      resolveInputStatus({
        ...base,
        backgroundAgentRows: [
          {
            toolCallId: "a",
            type: "Explore",
            description: "find bug",
            status: "completed",
            stepCount: 1,
            durationMs: 100,
          },
          {
            toolCallId: "b",
            type: "Plan",
            description: "draft",
            status: "error",
            stepCount: 0,
            durationMs: 10,
          },
        ],
      }),
    ).toEqual({
      type: "background-agent",
      count: 2,
      detail: undefined,
      done: true,
      hasError: true,
    });
  });

  it("thinking wins over background-agent", () => {
    expect(
      resolveInputStatus({
        ...base,
        shouldShowThinkingIndicator: true,
        backgroundAgentRows: [
          {
            toolCallId: "a",
            type: "Explore",
            description: "search",
            status: "running",
            stepCount: 1,
            durationMs: 100,
          },
        ],
      }),
    ).toEqual({ type: "thinking" });
  });

  it("responding wins over background-agent", () => {
    expect(
      resolveInputStatus({
        ...base,
        isResponding: true,
        backgroundAgentRows: [
          {
            toolCallId: "a",
            type: "Explore",
            description: "search",
            status: "running",
            stepCount: 1,
            durationMs: 100,
          },
        ],
      }),
    ).toEqual({ type: "responding" });
  });

  // ── goal elapsed time helpers ──

  const activeStatus = {
    type: "goal-active",
    objective: "fix login",
    iteration: 1,
    timeUsedSeconds: 0,
    activePeriodStartedAt: 0,
  } as const;
  const pausedStatus = {
    type: "goal-paused",
    objective: "fix login",
    iteration: 3,
    timeUsedSeconds: 120,
  } as const;
  const completeStatus = {
    type: "goal-complete",
    objective: "fix login",
    iteration: 5,
    timeUsedSeconds: 300,
  } as const;
  const budgetLimitedStatus = {
    type: "goal-budget-limited",
    objective: "fix login",
    iteration: 4,
    timeUsedSeconds: 240,
    timeBudgetSeconds: 600,
  } as const;

  it("preserves the active-period anchor when resolving Goal status", () => {
    const goalStatus = {
      status: "active" as const,
      objective: "fix login",
      iteration: 1,
      timeUsedSeconds: 120,
      activePeriodStartedAt: 1_000_000_000_000,
    };
    const resolved = resolveInputStatus({
      ...base,
      goalStatus,
    });

    expect(resolved).toMatchObject({
      type: "goal-active",
      activePeriodStartedAt: 1_000_000_000_000,
    });
  });

  it("isGoalTimeLive: only active and budget-limited keep ticking", () => {
    expect(isGoalTimeLive(activeStatus)).toBe(true);
    expect(isGoalTimeLive(budgetLimitedStatus)).toBe(true);
    expect(isGoalTimeLive(pausedStatus)).toBe(false);
    expect(isGoalTimeLive(completeStatus)).toBe(false);
    expect(isGoalTimeLive(null)).toBe(false);
  });

  it("uses the authoritative active period start", () => {
    const status = {
      ...activeStatus,
      timeUsedSeconds: 120,
      activePeriodStartedAt: 1_000_000_000_000,
    };

    expect(computeElapsedSeconds(status, 1_000_000_063_000)).toBe(183);
  });

  it("does not extrapolate an active status without an anchor", () => {
    const status = {
      ...activeStatus,
      timeUsedSeconds: 120,
      activePeriodStartedAt: undefined,
    };

    expect(computeElapsedSeconds(status, 1_000_000_063_000)).toBe(120);
  });

  it("extrapolates live elapsed from the snapshot plus active-period delta", () => {
    expect(computeElapsedSeconds(activeStatus, 0)).toBe(0);
    expect(computeElapsedSeconds(activeStatus, 60_000)).toBe(60);
    expect(
      computeElapsedSeconds(
        {
          ...activeStatus,
          timeUsedSeconds: 120,
          activePeriodStartedAt: 10_000,
        },
        40_000,
      ),
    ).toBe(150);
    expect(
      computeElapsedSeconds(
        { ...budgetLimitedStatus, activePeriodStartedAt: 0 },
        30_000,
      ),
    ).toBe(270);
  });

  it("freezes paused and final states at the snapshot value", () => {
    expect(computeElapsedSeconds(pausedStatus, 300_000)).toBe(120);
    expect(computeElapsedSeconds(completeStatus, 300_000)).toBe(300);
  });

  it("never extrapolates backwards", () => {
    expect(
      computeElapsedSeconds(
        { ...activeStatus, activePeriodStartedAt: 50_000 },
        10_000,
      ),
    ).toBe(0);
  });
});

describe("ChatView optimistic goal clock updates", () => {
  it("rebases the clock when pausing and resuming", () => {
    expect(chatViewSource).toContain('status: "paused"');
    expect(chatViewSource).toContain("activePeriodStartedAt: undefined");
    expect(chatViewSource).toContain("computeElapsedSeconds");
    expect(chatViewSource).toContain('status: "active"');
  });
});
