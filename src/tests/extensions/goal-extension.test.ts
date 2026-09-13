import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../../main/i18n";
import type { GoalRow } from "../../main/db/database";
import {
  GoalExtension,
  buildResumePrompt,
  elapsedSeconds,
  MAX_GOAL_ITERATIONS,
} from "../../main/extensions/goal-extension";
import type { GoalState } from "../../main/extensions/goal-extension";

function createMockDb(rows: GoalRow[] = []) {
  return {
    goals: {
      upsert: vi.fn(),
      get: vi.fn(),
      getAll: vi.fn(() => rows),
      delete: vi.fn(),
    },
  };
}

describe("GoalExtension persistence", () => {
  it("start goal calls db.goals.upsert", async () => {
    const db = createMockDb();
    const ext = new GoalExtension(db as never);

    await ext.onCommand({
      command: "goal",
      args: "test objective",
      sessionId: "s1",
    });

    expect(db.goals.upsert).toHaveBeenCalled();
    const call = db.goals.upsert.mock.calls[0][0];
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(call.session_id).toBe("s1");
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(call.objective).toBe("test objective");
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(call.status).toBe("active");
  });

  it("start goal payload includes its active period start", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000_000_000);
    try {
      const db = createMockDb();
      const ext = new GoalExtension(db as never);
      const result = await ext.onCommand({
        command: "goal",
        args: "test",
        sessionId: "s1",
      });
      const snapshot = result?.goalStatus as
        | { activePeriodStartedAt?: number; timeUsedSeconds?: number }
        | undefined;

      expect(snapshot?.activePeriodStartedAt).toBe(1_000_000_000_000);
      expect(snapshot?.timeUsedSeconds).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps live snapshots as a base plus active-period anchor", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000_000_000);
    try {
      const db = createMockDb();
      const ext = new GoalExtension(db as never);
      await ext.onCommand({
        command: "goal",
        args: "test",
        sessionId: "s1",
      });

      vi.setSystemTime(1_000_000_060_000);
      const result = await ext.onCommand({
        command: "goal",
        args: "",
        sessionId: "s1",
      });
      const snapshot = result?.goalStatus as
        | { activePeriodStartedAt?: number; timeUsedSeconds?: number }
        | undefined;

      expect(snapshot?.activePeriodStartedAt).toBe(1_000_000_000_000);
      expect(snapshot?.timeUsedSeconds).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("restarts the active period when replacing a goal in one session", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000_000_000);
    try {
      const db = createMockDb();
      const ext = new GoalExtension(db as never);
      await ext.onCommand({
        command: "goal",
        args: "first goal",
        sessionId: "s1",
      });

      vi.setSystemTime(1_000_000_060_000);
      const result = await ext.onCommand({
        command: "goal",
        args: "second goal",
        sessionId: "s1",
      });
      const snapshot = result?.goalStatus as
        | { activePeriodStartedAt?: number; timeUsedSeconds?: number }
        | undefined;

      expect(snapshot?.activePeriodStartedAt).toBe(1_000_000_060_000);
      expect(snapshot?.timeUsedSeconds).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("pause goal persists status to DB", async () => {
    const db = createMockDb();
    const ext = new GoalExtension(db as never);

    await ext.onCommand({ command: "goal", args: "test", sessionId: "s1" });
    // Reset call count so we only assert on the pause upsert
    db.goals.upsert.mockClear();

    await ext.onCommand({ command: "goal", args: "pause", sessionId: "s1" });

    expect(db.goals.upsert).toHaveBeenCalled();
    const call = db.goals.upsert.mock.calls[0][0];
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(call.session_id).toBe("s1");
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(call.status).toBe("paused");
  });

  it("resume goal persists status to DB", async () => {
    const db = createMockDb();
    const ext = new GoalExtension(db as never);

    await ext.onCommand({ command: "goal", args: "test", sessionId: "s1" });
    await ext.onCommand({ command: "goal", args: "pause", sessionId: "s1" });
    db.goals.upsert.mockClear();

    await ext.onCommand({ command: "goal", args: "resume", sessionId: "s1" });

    expect(db.goals.upsert).toHaveBeenCalled();
    const call = db.goals.upsert.mock.calls[0][0];
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(call.status).toBe("active");
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(call.generation).toBe(2);
  });

  it("deleteGoal calls db.goals.delete", async () => {
    const db = createMockDb();
    const ext = new GoalExtension(db as never);

    await ext.onCommand({ command: "goal", args: "test", sessionId: "s1" });
    await ext.onCommand({
      command: "goal",
      args: "clear",
      sessionId: "s1",
    });

    expect(db.goals.delete).toHaveBeenCalledWith("s1");
  });

  it("recoverGoals restores active goals and clears terminal states", () => {
    const db = createMockDb([
      {
        session_id: "s1",
        objective: "active goal",
        status: "active",
        iteration: 5,
        first_turn_done: 1,
        generation: 1,
        token_budget: 10000,
        tokens_used: 3000,
        time_budget_seconds: null,
        time_used_seconds: 120,
        started_at: Date.now(),
        ended_at: null,
      },
      {
        session_id: "s2",
        objective: "completed goal",
        status: "complete",
        iteration: 3,
        first_turn_done: 1,
        generation: 1,
        token_budget: null,
        tokens_used: 500,
        time_budget_seconds: null,
        time_used_seconds: 30,
        started_at: Date.now(),
        ended_at: Date.now(),
      },
    ]);

    const ext = new GoalExtension(db as never);
    const recovered = ext.recoverGoals();

    expect(recovered).toHaveLength(1);
    expect(recovered[0].sessionId).toBe("s1");
    expect(recovered[0].goal.status).toBe("active");
    expect(recovered[0].goal.iteration).toBe(5);
    expect(recovered[0].goal.tokenBudget).toBe(10000);

    // Terminal states cleaned up
    expect(db.goals.delete).toHaveBeenCalledWith("s2");
  });

  it("recoverGoals returns empty when DB fails", () => {
    const db = createMockDb();
    db.goals.getAll.mockImplementation(() => {
      throw new Error("DB error");
    });
    const ext = new GoalExtension(db as never);
    const recovered = ext.recoverGoals();
    expect(recovered).toEqual([]);
  });

  it("recoverGoals handles paused goals from DB", () => {
    const db = createMockDb([
      {
        session_id: "s1",
        objective: "paused goal",
        status: "paused",
        iteration: 2,
        first_turn_done: 1,
        generation: 2,
        token_budget: null,
        tokens_used: 100,
        time_budget_seconds: null,
        time_used_seconds: 10,
        started_at: Date.now(),
        ended_at: null,
      },
    ]);

    const ext = new GoalExtension(db as never);
    const recovered = ext.recoverGoals();

    expect(recovered).toHaveLength(1);
    expect(recovered[0].goal.status).toBe("paused");
  });

  it("buildResumePrompt generates resume message", () => {
    const prompt = buildResumePrompt({
      objective: "build a calculator",
      iteration: 5,
      status: "active",
      firstTurnDone: true,
      generation: 1,
      tokensUsed: 0,
      timeUsedSeconds: 0,
      startedAt: Date.now(),
    } as GoalState);
    expect(prompt).toContain("build a calculator");
    expect(prompt).toContain("#5");
  });

  it("deleteGoal public method works for orphan cleanup", () => {
    const db = createMockDb();
    const ext = new GoalExtension(db as never);

    ext.deleteGoal("orphan-session");
    expect(db.goals.delete).toHaveBeenCalledWith("orphan-session");
  });

  it("budget_limited goal is restored", () => {
    const db = createMockDb([
      {
        session_id: "s1",
        objective: "budgeted goal",
        status: "budget_limited",
        iteration: 10,
        first_turn_done: 1,
        generation: 1,
        token_budget: 1000,
        tokens_used: 1000,
        time_budget_seconds: null,
        time_used_seconds: 60,
        started_at: Date.now(),
        ended_at: null,
      },
    ]);

    const ext = new GoalExtension(db as never);
    const recovered = ext.recoverGoals();

    expect(recovered).toHaveLength(1);
    expect(recovered[0].goal.status).toBe("budget_limited");
  });
});

describe("GoalExtension error handling & resume semantics", () => {
  function startGoal(ext: GoalExtension) {
    return ext.onCommand({
      command: "goal",
      args: "test objective",
      sessionId: "s1",
    });
  }

  function goalOf(ext: GoalExtension): GoalState {
    const goals = (ext as unknown as { goals: Map<string, GoalState> }).goals;
    const goal = goals.get("s1");
    if (!goal) throw new Error("goal not found");
    return goal;
  }

  it("onSessionRunError pauses an active goal and reports status", async () => {
    const db = createMockDb();
    const ext = new GoalExtension(db as never);
    await startGoal(ext);
    db.goals.upsert.mockClear();

    const result = await ext.onSessionRunError({
      sessionId: "s1",
      error: new Error("network down"),
    });

    expect(goalOf(ext).status).toBe("paused");
    expect(result?.goalStatus?.status).toBe("paused");
    expect(db.goals.upsert).toHaveBeenCalled();
    const call = db.goals.upsert.mock.calls[0][0] as Record<string, unknown>;
    expect(call.status).toBe("paused");
  });

  it("onSessionRunError is a no-op without an active goal", async () => {
    const db = createMockDb();
    const ext = new GoalExtension(db as never);
    const result = await ext.onSessionRunError({
      sessionId: "s1",
      error: new Error("x"),
    });
    expect(result).toBeUndefined();
  });

  it("resume restarts an active goal when session is idle", async () => {
    const db = createMockDb();
    const ext = new GoalExtension(db as never);
    ext.setSessionStateProvider(() => false); // session idle
    await startGoal(ext);

    const result = await ext.onCommand({
      command: "goal",
      args: "resume",
      sessionId: "s1",
    });

    expect(result?.firstTurnPrompt).toContain("Resume working toward");
    expect(result?.goalStatus?.status).toBe("active");
    // Below the cap: plain resume message, no cap notice
    expect(result?.message).toContain("Goal resumed:");
    expect(result?.message).not.toContain("cap");
  });

  it("resume rejects with alreadyActive when session is running", async () => {
    const db = createMockDb();
    const ext = new GoalExtension(db as never);
    ext.setSessionStateProvider(() => true); // session running
    await startGoal(ext);

    const result = await ext.onCommand({
      command: "goal",
      args: "resume",
      sessionId: "s1",
    });

    expect(result?.firstTurnPrompt).toBeUndefined();
    expect(result?.message).toBeTruthy(); // alreadyActive 文案
  });

  it("resume resets iteration to 1 and explains the cap when at the max-iteration cap", async () => {
    const db = createMockDb();
    const ext = new GoalExtension(db as never);
    ext.setSessionStateProvider(() => false);
    await startGoal(ext);
    goalOf(ext).iteration = MAX_GOAL_ITERATIONS;
    goalOf(ext).status = "paused";
    db.goals.upsert.mockClear();

    const result = await ext.onCommand({
      command: "goal",
      args: "resume",
      sessionId: "s1",
    });

    // New cycle restarts counting; never shows turn 0
    expect(goalOf(ext).iteration).toBe(1);
    // Persisted row carries the restarted counter (restart-recovery path)
    const call = db.goals.upsert.mock.calls[0][0];
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(call.iteration).toBe(1);
    expect(result?.firstTurnPrompt).toContain("This is turn #1");
    expect(result?.firstTurnPrompt).not.toContain("turn #0");
    // Resume response tells the user the cap was reached
    // (unit tests run with electron mock locale "en")
    expect(result?.message).toContain("50-turn cap");
  });

  it("getAllGoals returns in-memory goals keyed by session", async () => {
    const db = createMockDb();
    const ext = new GoalExtension(db as never);
    await startGoal(ext);

    const all = ext.getAllGoals();
    expect(all).toHaveLength(1);
    expect(all[0].sessionId).toBe("s1");
    expect(all[0].goal.status).toBe("active");
  });
});

describe("GoalExtension elapsed-time accounting", () => {
  function startGoal(ext: GoalExtension) {
    return ext.onCommand({
      command: "goal",
      args: "test objective",
      sessionId: "s1",
    });
  }

  function goalOf(ext: GoalExtension): GoalState {
    const goals = (ext as unknown as { goals: Map<string, GoalState> }).goals;
    const goal = goals.get("s1");
    if (!goal) throw new Error("goal not found");
    return goal;
  }

  it("pause freezes elapsed time; resume does not count paused time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000_000_000);
    try {
      const db = createMockDb();
      const ext = new GoalExtension(db as never);
      await startGoal(ext);

      // 10s of active run, then pause.
      vi.setSystemTime(1_000_000_000_000 + 10_000);
      const paused = await ext.onCommand({
        command: "goal",
        args: "pause",
        sessionId: "s1",
      });
      expect(paused?.goalStatus?.timeUsedSeconds).toBe(10);
      expect(goalOf(ext).timeUsedSeconds).toBe(10);

      // 60s pass while paused, then resume.
      vi.setSystemTime(1_000_000_000_000 + 70_000);
      const resumed = await ext.onCommand({
        command: "goal",
        args: "resume",
        sessionId: "s1",
      });
      // Elapsed must NOT include the 60s pause.
      expect(resumed?.goalStatus?.timeUsedSeconds).toBe(10);
      expect(resumed?.goalStatus?.activePeriodStartedAt).toBe(
        1_000_000_000_000 + 70_000,
      );
      expect(goalOf(ext).startedAt).toBe(1_000_000_000_000 + 70_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("recoverGoals resets the active period so offline time is not counted", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000_000_000);
    try {
      const db = createMockDb([
        {
          session_id: "s1",
          objective: "active goal",
          status: "active",
          iteration: 2,
          first_turn_done: 1,
          generation: 1,
          token_budget: null,
          tokens_used: 100,
          time_budget_seconds: null,
          time_used_seconds: 30,
          started_at: 1_000_000_000_000 - 86_400_000, // a day ago
          ended_at: null,
        },
      ]);
      const ext = new GoalExtension(db as never);
      const recovered = ext.recoverGoals();

      expect(recovered).toHaveLength(1);
      expect(recovered[0].goal.timeUsedSeconds).toBe(30);
      // Active period restarts now, not a day ago.
      expect(recovered[0].goal.startedAt).toBe(1_000_000_000_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("mid-turn pause does not count the in-flight turn's remaining time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000_000_000);
    try {
      const db = createMockDb();
      const ext = new GoalExtension(db as never);
      await startGoal(ext);

      // 10s of active run, then pause mid-turn.
      vi.setSystemTime(1_000_000_000_000 + 10_000);
      await ext.onCommand({ command: "goal", args: "pause", sessionId: "s1" });
      expect(goalOf(ext).timeUsedSeconds).toBe(10);

      // The in-flight turn completes 30s later while still paused.
      vi.setSystemTime(1_000_000_000_000 + 40_000);
      await ext.afterSessionRun!({
        session: { id: "s1" } as never,
        prompt: "",
        messages: [],
      });

      // The 30s post-pause tail must not be counted.
      expect(goalOf(ext).timeUsedSeconds).toBe(10);
    } finally {
      vi.useRealTimers();
    }
  });

  it("budget_limited transitions to paused after the final summarize turn", async () => {
    const db = createMockDb();
    const ext = new GoalExtension(db as never);
    await startGoal(ext);
    goalOf(ext).status = "budget_limited";

    const result = await ext.afterSessionRun!({
      session: { id: "s1" } as never,
      prompt: "",
      messages: [],
    });

    expect(goalOf(ext).status).toBe("paused");
    expect(result?.goalStatus?.status).toBe("paused");
  });

  it("elapsedSeconds extrapolates live for active/budget_limited, frozen otherwise", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000_000_000);
    try {
      const base = (status: GoalState["status"]): GoalState => ({
        objective: "x",
        status,
        iteration: 1,
        firstTurnDone: true,
        generation: 1,
        tokensUsed: 0,
        timeUsedSeconds: 100,
        startedAt: 1_000_000_000_000 - 5_000, // 5s ago
      });

      expect(elapsedSeconds(base("active"))).toBe(105);
      expect(elapsedSeconds(base("budget_limited"))).toBe(105);
      expect(elapsedSeconds(base("paused"))).toBe(100);
      expect(elapsedSeconds(base("complete"))).toBe(100);
      expect(elapsedSeconds(base("blocked"))).toBe(100);
      expect(elapsedSeconds(base("cleared"))).toBe(100);
    } finally {
      vi.useRealTimers();
    }
  });

  it("update_goal complete while paused does not count the paused tail", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000_000_000);
    try {
      const db = createMockDb();
      const ext = new GoalExtension(db as never);
      await startGoal(ext);
      // Create the per-session goal tools (get_goal/update_goal/goal_complete).
      await ext.beforeSessionRun!({
        session: { id: "s1" } as never,
        prompt: "",
        existingMessages: [],
        isColdStart: false,
      });

      // 10s of active run, then pause mid-turn.
      vi.setSystemTime(1_000_000_000_000 + 10_000);
      await ext.onCommand({ command: "goal", args: "pause", sessionId: "s1" });
      expect(goalOf(ext).timeUsedSeconds).toBe(10);

      // The model completes the goal 30s later, while still paused.
      vi.setSystemTime(1_000_000_000_000 + 40_000);
      const tools = (
        ext as unknown as {
          goalTools: Map<
            string,
            Array<{
              name: string;
              execute: (id: string, params: unknown) => Promise<unknown>;
            }>
          >;
        }
      ).goalTools.get("s1");
      const updateGoal = tools?.find((t) => t.name === "update_goal");
      if (!updateGoal) throw new Error("update_goal tool not found");
      await updateGoal.execute("id", { status: "complete", summary: "done" });

      // The 30s paused tail must not be counted immediately or after the turn closes.
      expect(goalOf(ext).timeUsedSeconds).toBe(10);
      expect(goalOf(ext).status).toBe("complete");
      const after = await ext.afterSessionRun!({
        session: { id: "s1" } as never,
        prompt: "",
        messages: [],
      });
      expect(after?.goalStatus?.timeUsedSeconds).toBe(10);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("goal messages follow the main-process locale", () => {
  afterEach(() => {
    setLocale(undefined);
  });

  it('returns the zh started message after setLocale("zh")', async () => {
    const db = createMockDb();
    const ext = new GoalExtension(db as never);
    setLocale("zh");

    const result = await ext.onCommand({
      command: "goal",
      args: "测试目标",
      sessionId: "s1",
    });

    expect(result?.message).toContain("目标已启动: 测试目标");
  });

  it("returns the en started message by default", async () => {
    // Do not rely on the other describe block's afterEach having run.
    setLocale(undefined);
    const db = createMockDb();
    const ext = new GoalExtension(db as never);

    const result = await ext.onCommand({
      command: "goal",
      args: "test objective",
      sessionId: "s1",
    });

    expect(result?.message).toContain("Goal started: test objective");
  });
});
