import { describe, expect, it, vi } from "vitest";
import type { GoalRow } from "../../main/db/database";
import {
  GoalExtension,
  buildResumePrompt,
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
