import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GoalExtension } from "../../main/extensions/goal-extension";

function createRealDb() {
  const tmpDir = mkdtempSync(join(tmpdir(), "goaltest-"));
  const dbPath = join(tmpDir, "cowork.db");
  const rawDb = new DatabaseSync(dbPath, {
    enableForeignKeyConstraints: true,
  });
  rawDb.exec("PRAGMA journal_mode = WAL");

  rawDb.exec(`CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'idle',
    cwd TEXT, mounted_paths TEXT NOT NULL DEFAULT '[]',
    allowed_tools TEXT NOT NULL DEFAULT '[]', memory_enabled INTEGER NOT NULL DEFAULT 0,
    provider_profile_key TEXT, model TEXT, thinking_level TEXT NOT NULL DEFAULT 'medium',
    is_project_mode INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0,
    archived_at INTEGER, pi_session_file TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  )`);
  rawDb.exec(`CREATE TABLE IF NOT EXISTS goals (
    session_id TEXT PRIMARY KEY, objective TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active', iteration INTEGER NOT NULL DEFAULT 0,
    first_turn_done INTEGER NOT NULL DEFAULT 0, generation INTEGER NOT NULL DEFAULT 1,
    token_budget REAL, tokens_used REAL NOT NULL DEFAULT 0,
    time_budget_seconds REAL, time_used_seconds REAL NOT NULL DEFAULT 0,
    started_at INTEGER NOT NULL, ended_at INTEGER,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  )`);

  const upsertGoal = rawDb.prepare(`INSERT OR REPLACE INTO goals
    (session_id, objective, status, iteration, first_turn_done, generation,
     token_budget, tokens_used, time_budget_seconds, time_used_seconds, started_at, ended_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const getGoal = rawDb.prepare("SELECT * FROM goals WHERE session_id = ?");
  const getAllGoals = rawDb.prepare(
    "SELECT * FROM goals ORDER BY started_at ASC",
  );
  const deleteGoalStmt = rawDb.prepare(
    "DELETE FROM goals WHERE session_id = ?",
  );

  const db = {
    raw: rawDb,
    goals: {
      upsert: (g: Record<string, unknown>) =>
        upsertGoal.run(
          g.session_id as string,
          g.objective as string,
          g.status as string,
          g.iteration as number,
          g.first_turn_done as number,
          g.generation as number,
          g.token_budget as number | null,
          g.tokens_used as number,
          g.time_budget_seconds as number | null,
          g.time_used_seconds as number,
          g.started_at as number,
          g.ended_at as number | null,
        ),
      get: (sid: string) => getGoal.get(sid) as Record<string, unknown> | undefined,
      getAll: () => getAllGoals.all() as Record<string, unknown>[],
      delete: (sid: string) => deleteGoalStmt.run(sid),
    },
  };

  return { db, rawDb, tmpDir };
}

describe("GoalExtension integration (real SQLite)", () => {
  it("full lifecycle: start → pause → resume → clear", async () => {
    const { db, rawDb, tmpDir } = createRealDb();
    const now = Date.now();

    rawDb
      .prepare(
        "INSERT INTO sessions (id, title, status, cwd, mounted_paths, allowed_tools, memory_enabled, thinking_level, is_project_mode, archived, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run("s1", "Test", "idle", "/tmp", "[]", "[]", 0, "medium", 0, 0, now, now);

    const ext = new GoalExtension(db as never);

    // Start
    await ext.onCommand({
      command: "goal",
      args: "build a calculator",
      sessionId: "s1",
    });
    let row = db.goals.get("s1");
    expect(row?.status).toBe("active");
    expect(row?.objective).toBe("build a calculator");

    // Pause
    await ext.onCommand({ command: "goal", args: "pause", sessionId: "s1" });
    row = db.goals.get("s1");
    expect(row?.status).toBe("paused");

    // Resume
    await ext.onCommand({ command: "goal", args: "resume", sessionId: "s1" });
    row = db.goals.get("s1");
    expect(row?.status).toBe("active");
    expect(row?.generation).toBe(2);

    // Clear
    await ext.onCommand({ command: "goal", args: "clear", sessionId: "s1" });
    row = db.goals.get("s1");
    expect(row).toBeUndefined();

    rawDb.close();
    rmSync(tmpDir, { recursive: true });
  });

  it("beforeSessionRun persists iteration and firstTurnDone", async () => {
    const { db, rawDb, tmpDir } = createRealDb();
    const now = Date.now();

    rawDb
      .prepare(
        "INSERT INTO sessions (id, title, status, cwd, mounted_paths, allowed_tools, memory_enabled, thinking_level, is_project_mode, archived, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run("s1", "Test", "idle", "/tmp", "[]", "[]", 0, "medium", 0, 0, now, now);

    const ext = new GoalExtension(db as never);

    await ext.onCommand({
      command: "goal",
      args: "task",
      sessionId: "s1",
    });

    await ext.beforeSessionRun!({
      session: { id: "s1" } as never,
      prompt: "",
      existingMessages: [],
      isColdStart: false,
    });

    const row = db.goals.get("s1");
    expect(row?.iteration).toBe(1);
    expect(row?.first_turn_done).toBe(1);

    rawDb.close();
    rmSync(tmpDir, { recursive: true });
  });

  it("afterSessionRun persists budget tracking", async () => {
    const { db, rawDb, tmpDir } = createRealDb();
    const now = Date.now();

    rawDb
      .prepare(
        "INSERT INTO sessions (id, title, status, cwd, mounted_paths, allowed_tools, memory_enabled, thinking_level, is_project_mode, archived, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run("s1", "Test", "idle", "/tmp", "[]", "[]", 0, "medium", 0, 0, now, now);

    const ext = new GoalExtension(db as never);

    await ext.onCommand({
      command: "goal",
      args: "task",
      sessionId: "s1",
    });

    await ext.beforeSessionRun!({
      session: { id: "s1" } as never,
      prompt: "",
      existingMessages: [],
      isColdStart: false,
    });

    await ext.afterSessionRun!({
      session: { id: "s1" } as never,
      prompt: "",
      messages: [
        { role: "assistant", tokenUsage: { input: 100, output: 50 } } as never,
      ],
    });

    const row = db.goals.get("s1");
    expect(row?.tokens_used).toBeGreaterThan(0);

    rawDb.close();
    rmSync(tmpDir, { recursive: true });
  });

  it("recoverGoals with real DB round-trip", async () => {
    const { db, rawDb, tmpDir } = createRealDb();
    const now = Date.now();

    rawDb
      .prepare(
        "INSERT INTO sessions (id, title, status, cwd, mounted_paths, allowed_tools, memory_enabled, thinking_level, is_project_mode, archived, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run("s1", "Test", "idle", "/tmp", "[]", "[]", 0, "medium", 0, 0, now, now);
    rawDb
      .prepare(
        "INSERT INTO sessions (id, title, status, cwd, mounted_paths, allowed_tools, memory_enabled, thinking_level, is_project_mode, archived, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run("s2", "Test2", "idle", "/tmp", "[]", "[]", 0, "medium", 0, 0, now, now);
    rawDb
      .prepare(
        "INSERT INTO sessions (id, title, status, cwd, mounted_paths, allowed_tools, memory_enabled, thinking_level, is_project_mode, archived, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run("s3", "Test3", "idle", "/tmp", "[]", "[]", 0, "medium", 0, 0, now, now);

    // Seed DB as if app was running before restart
    db.goals.upsert({
      session_id: "s1",
      objective: "active goal",
      status: "active",
      iteration: 5,
      first_turn_done: 1,
      generation: 1,
      token_budget: 5000,
      tokens_used: 2000,
      time_budget_seconds: null,
      time_used_seconds: 60,
      started_at: now,
      ended_at: null,
    });
    db.goals.upsert({
      session_id: "s2",
      objective: "paused goal",
      status: "paused",
      iteration: 3,
      first_turn_done: 1,
      generation: 2,
      token_budget: null,
      tokens_used: 100,
      time_budget_seconds: null,
      time_used_seconds: 15,
      started_at: now,
      ended_at: null,
    });
    db.goals.upsert({
      session_id: "s3",
      objective: "done",
      status: "complete",
      iteration: 1,
      first_turn_done: 1,
      generation: 1,
      token_budget: null,
      tokens_used: 50,
      time_budget_seconds: null,
      time_used_seconds: 5,
      started_at: now,
      ended_at: now,
    });

    const ext = new GoalExtension(db as never);
    const recovered = ext.recoverGoals();

    expect(recovered).toHaveLength(2);
    expect(
      recovered.find((r) => r.sessionId === "s1")?.goal.status,
    ).toBe("active");
    expect(
      recovered.find((r) => r.sessionId === "s2")?.goal.status,
    ).toBe("paused");

    // Complete goal should be cleaned up
    expect(db.goals.get("s3")).toBeUndefined();

    rawDb.close();
    rmSync(tmpDir, { recursive: true });
  });

  it("orphan goal deleted via SessionManager path", async () => {
    const { db, rawDb, tmpDir } = createRealDb();
    const now = Date.now();

    // Create session first then delete it to simulate orphan
    rawDb
      .prepare(
        "INSERT INTO sessions (id, title, status, cwd, mounted_paths, allowed_tools, memory_enabled, thinking_level, is_project_mode, archived, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run("orphan", "Orphan", "idle", "/tmp", "[]", "[]", 0, "medium", 0, 0, now, now);

    // No session for 'orphan' — simulate deleted session
    db.goals.upsert({
      session_id: "orphan",
      objective: "orphan goal",
      status: "active",
      iteration: 1,
      first_turn_done: 0,
      generation: 1,
      token_budget: null,
      tokens_used: 0,
      time_budget_seconds: null,
      time_used_seconds: 0,
      started_at: now,
      ended_at: null,
    });

    // Delete the session to create an orphan goal (disable FK so CASCADE doesn't fire)
    rawDb.exec("PRAGMA foreign_keys = OFF");
    rawDb.prepare("DELETE FROM sessions WHERE id = ?").run("orphan");
    rawDb.exec("PRAGMA foreign_keys = ON");

    const ext = new GoalExtension(db as never);

    // recoverGoals returns the orphan (cleanup is SessionManager's job)
    const recovered = ext.recoverGoals();
    expect(recovered.find((r) => r.sessionId === "orphan")).toBeTruthy();

    // SessionManager would call deleteGoal
    ext.deleteGoal("orphan");
    expect(db.goals.get("orphan")).toBeUndefined();

    rawDb.close();
    rmSync(tmpDir, { recursive: true });
  });
});
