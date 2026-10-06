/**
 * SQLite database implementation using node:sqlite (Node.js built-in)
 * Provides persistent storage for sessions, messages, and other data
 */

import {
  DatabaseSync,
  type StatementSync,
  type SQLInputValue,
} from "node:sqlite";
import { app } from "electron";
import { join } from "path";
import type { SessionKind } from "../../shared/session-kind";
import {
  existsSync,
  mkdirSync,
  statSync,
  renameSync,
  openSync,
  readSync,
  closeSync,
} from "fs";
import { log, logError, logWarn } from "../utils/logger";
import { createUsageSchema } from "../usage/usage-store";

export interface DatabaseInstance {
  // Raw database access (for advanced queries)
  raw: DatabaseSync;

  // Session operations
  sessions: {
    create: (session: SessionRow) => void;
    update: (id: string, updates: Partial<SessionRow>) => void;
    get: (id: string) => SessionRow | undefined;
    getAll: () => SessionRow[];
    delete: (id: string) => void;
  };

  traceSteps: {
    create: (step: TraceStepRow) => void;
    update: (id: string, updates: Partial<TraceStepRow>) => void;
    getBySessionId: (sessionId: string) => TraceStepRow[];
    deleteBySessionId: (sessionId: string) => void;
  };

  scheduledTasks: {
    create: (task: ScheduledTaskRow) => void;
    update: (id: string, updates: Partial<ScheduledTaskRow>) => void;
    get: (id: string) => ScheduledTaskRow | undefined;
    getAll: () => ScheduledTaskRow[];
    delete: (id: string) => void;
  };

  goals: {
    upsert: (goal: GoalRow) => void;
    get: (sessionId: string) => GoalRow | undefined;
    getAll: () => GoalRow[];
    delete: (sessionId: string) => void;
  };

  feedItems: {
    insert: (row: FeedItemRow) => void;
    get: (id: string) => FeedItemRow | null;
    listVisible: (limit: number) => FeedItemRow[];
    unreadCount: () => number;
    markRead: (id: string, ts: number) => void;
    markAllRead: (ts: number) => void;
    dismiss: (id: string, ts: number) => void;
    countAll: () => number;
    deleteAll: () => void;
    deleteOlderThan: (ts: number) => number;
    pruneToMax: (count: number) => number;
    listImageFileNames: () => string[];
    /** 全表的 url_key（**含已移除的**）—— 跨天去重靠它（设计 §6.3）。 */
    listUrlKeys: () => string[];
  };

  feedRuns: {
    insert: (row: FeedRunRow) => void;
    finish: (id: string, patch: FeedRunPatch) => void;
    setMeta: (
      id: string,
      meta: { queries: string; topics: string; candidate_count: number },
    ) => void;
    delete: (id: string) => void;
    latest: () => FeedRunRow | null;
    lastSuccessAt: () => number | null;
    /** 任何状态的最后一次尝试时间；连续失败封顶后靠它算间隔。 */
    lastAttemptAt: () => number | null;
    markInterrupted: (ts: number) => number;
    countConsecutiveFailures: () => number;
    pruneOlderThan: (ts: number) => number;
  };

  // For compatibility with old interface
  prepare: (sql: string) => StatementSync;
  exec: (sql: string) => void;
  close: () => void;
}

import type {
  FeedItemRow,
  FeedRunPatch,
  FeedRunRow,
  FeedRunStatus,
} from "../../shared/feed";

export type {
  FeedBodyStatus,
  FeedImageStatus,
  FeedItemRow,
  FeedRunPatch,
  FeedRunRow,
  FeedRunStatus,
  FeedTrigger,
} from "../../shared/feed";

export interface SessionRow {
  session_kind?: SessionKind;
  id: string;
  title: string;
  deskwand_session_id: string | null;
  openai_thread_id: string | null;
  status: string;
  cwd: string | null;
  mounted_paths: string; // JSON string
  allowed_tools: string; // JSON string
  memory_enabled: number;
  is_project_mode: number;
  provider_profile_key: string | null;
  model: string | null;
  thinking_level: string;
  archived: number;
  archived_at: number | null;
  pi_session_file: string | null;
  created_at: number;
  updated_at: number;
}

export interface TraceStepRow {
  id: string;
  session_id: string;
  type: string;
  status: string;
  title: string;
  content: string | null;
  tool_name: string | null;
  tool_input: string | null; // JSON string
  tool_output: string | null;
  is_error: number | null;
  timestamp: number;
  duration: number | null;
}

export interface ScheduledTaskRow {
  id: string;
  title: string;
  prompt: string;
  cwd: string;
  run_at: number;
  next_run_at: number | null;
  schedule_config: string | null;
  repeat_every: number | null;
  repeat_unit: string | null;
  enabled: number;
  last_run_at: number | null;
  last_run_session_id: string | null;
  last_error: string | null;
  created_at: number;
  updated_at: number;
}

export interface GoalRow {
  session_id: string;
  objective: string;
  status: string;
  iteration: number;
  first_turn_done: number;
  generation: number;
  token_budget: number | null;
  tokens_used: number;
  time_budget_seconds: number | null;
  time_used_seconds: number;
  started_at: number;
  ended_at: number | null;
}

let db: DatabaseInstance | null = null;
const SQLITE_HEADER = Buffer.from("SQLite format 3\0", "utf8");

function buildBackupPath(targetPath: string, suffix: string): string {
  return `${targetPath}.${suffix}-${Date.now()}`;
}

function moveIfExists(sourcePath: string, destinationPath: string): void {
  if (!existsSync(sourcePath)) {
    return;
  }
  renameSync(sourcePath, destinationPath);
}

function ensureDirectory(pathToEnsure: string, label: string): void {
  if (!existsSync(pathToEnsure)) {
    mkdirSync(pathToEnsure, { recursive: true });
    return;
  }

  const stats = statSync(pathToEnsure);
  if (stats.isDirectory()) {
    return;
  }

  const backupPath = buildBackupPath(pathToEnsure, "backup");
  renameSync(pathToEnsure, backupPath);
  logWarn(
    `[Database] ${label} path is not a directory, moved to backup:`,
    backupPath,
  );
  mkdirSync(pathToEnsure, { recursive: true });
}

function isSqliteFile(filePath: string): boolean {
  let fd: number | null = null;
  try {
    fd = openSync(filePath, "r");
    const buffer = Buffer.alloc(SQLITE_HEADER.length);
    const bytesRead = readSync(fd, buffer, 0, SQLITE_HEADER.length, 0);
    if (bytesRead < SQLITE_HEADER.length) {
      return false;
    }
    return buffer.equals(SQLITE_HEADER);
  } catch {
    return false;
  } finally {
    if (fd !== null) {
      closeSync(fd);
    }
  }
}

function prepareDatabaseDirectory(userDataPath: string): string {
  ensureDirectory(userDataPath, "userData");

  const dbDir = join(userDataPath, "data");
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
    return dbDir;
  }

  const stats = statSync(dbDir);
  if (stats.isDirectory()) {
    return dbDir;
  }

  const preservedPath = buildBackupPath(
    dbDir,
    isSqliteFile(dbDir) ? "legacy-db" : "conflict",
  );
  renameSync(dbDir, preservedPath);
  mkdirSync(dbDir, { recursive: true });

  if (isSqliteFile(preservedPath)) {
    const recoveredDbPath = join(dbDir, "cowork.db");
    renameSync(preservedPath, recoveredDbPath);
    moveIfExists(`${dbDir}-wal`, `${recoveredDbPath}-wal`);
    moveIfExists(`${dbDir}-shm`, `${recoveredDbPath}-shm`);
    logWarn("[Database] Recovered legacy SQLite file into:", recoveredDbPath);
  } else {
    logWarn(
      "[Database] Database directory path was occupied by a file, moved to backup:",
      preservedPath,
    );
  }

  return dbDir;
}

/**
 * Get the database file path
 */
function getDatabasePath(): string {
  // Use electron's userData path for persistent storage
  const userDataPath = app.getPath("userData");
  const dbDir = prepareDatabaseDirectory(userDataPath);
  const dbPath = join(dbDir, "cowork.db");

  if (existsSync(dbPath) && statSync(dbPath).isDirectory()) {
    const backupPath = buildBackupPath(dbPath, "dir-backup");
    renameSync(dbPath, backupPath);
    logWarn(
      "[Database] Database file path is a directory, moved to backup:",
      backupPath,
    );
  }

  return dbPath;
}

/**
 * Initialize the database schema
 */
function initializeSchema(database: DatabaseSync): void {
  try {
    // Enable WAL mode for better performance
    database.exec("PRAGMA journal_mode = WAL");

    // Create sessions table
    database.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      deskwand_session_id TEXT,
      openai_thread_id TEXT,
      status TEXT NOT NULL DEFAULT 'idle',
      cwd TEXT,
      mounted_paths TEXT NOT NULL DEFAULT '[]',
      allowed_tools TEXT NOT NULL DEFAULT '[]',
      memory_enabled INTEGER NOT NULL DEFAULT 0,
      provider_profile_key TEXT,
      thinking_level TEXT NOT NULL DEFAULT 'medium',
      is_project_mode INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

    // Migration: rename claude_session_id → deskwand_session_id for existing databases
    const sessionCols = database
      .prepare("PRAGMA table_info(sessions)")
      .all() as Array<{ name: string }>;
    if (sessionCols.some((c) => c.name === "claude_session_id")) {
      database.exec(
        "ALTER TABLE sessions RENAME COLUMN claude_session_id TO deskwand_session_id",
      );
      log(
        "[Database] Migrated sessions.claude_session_id → deskwand_session_id",
      );
    }

    ensureColumn(
      database,
      "sessions",
      "openai_thread_id",
      "openai_thread_id TEXT",
    );
    ensureColumn(
      database,
      "sessions",
      "provider_profile_key",
      "provider_profile_key TEXT",
    );
    ensureColumn(database, "sessions", "model", "model TEXT");
    ensureColumn(
      database,
      "sessions",
      "session_kind",
      "session_kind TEXT NOT NULL DEFAULT 'ordinary'",
    );
    ensureColumn(
      database,
      "sessions",
      "thinking_level",
      "thinking_level TEXT NOT NULL DEFAULT 'medium'",
    );
    ensureColumn(
      database,
      "sessions",
      "archived",
      "archived INTEGER NOT NULL DEFAULT 0",
    );
    ensureColumn(database, "sessions", "archived_at", "archived_at INTEGER");
    ensureColumn(
      database,
      "sessions",
      "is_project_mode",
      "is_project_mode INTEGER NOT NULL DEFAULT 0",
    );
    ensureColumn(
      database,
      "sessions",
      "pi_session_file",
      "pi_session_file TEXT",
    );

    // Create trace steps table
    database.exec(`
    CREATE TABLE IF NOT EXISTS trace_steps (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT,
      tool_name TEXT,
      tool_input TEXT,
      tool_output TEXT,
      is_error INTEGER,
      timestamp INTEGER NOT NULL,
      duration INTEGER,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `);

    // Create index for faster message queries
    database.exec(`
    CREATE INDEX IF NOT EXISTS idx_trace_steps_session_id
    ON trace_steps(session_id)
  `);

    database.exec(`
    CREATE INDEX IF NOT EXISTS idx_trace_steps_timestamp
    ON trace_steps(session_id, timestamp)
  `);

    // Create memory_entries table (for future use)
    database.exec(`
    CREATE TABLE IF NOT EXISTS memory_entries (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `);

    // Create skills table (for future use)
    database.exec(`
    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      type TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      config TEXT,
      created_at INTEGER NOT NULL
    )
  `);

    database.exec(`
    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      cwd TEXT NOT NULL,
      run_at INTEGER NOT NULL,
      next_run_at INTEGER,
      schedule_config TEXT,
      repeat_every INTEGER,
      repeat_unit TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_run_at INTEGER,
      last_run_session_id TEXT,
      last_error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
    ensureColumn(
      database,
      "scheduled_tasks",
      "schedule_config",
      "schedule_config TEXT",
    );

    database.exec(`
    CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_next_run
    ON scheduled_tasks(enabled, next_run_at)
  `);

    // Feed（动态）：条目与每次生成的记录
    database.exec(`
    CREATE TABLE IF NOT EXISTS feed_items (
      id            TEXT PRIMARY KEY,
      run_id        TEXT NOT NULL,
      title         TEXT NOT NULL,
      summary       TEXT,
      url           TEXT NOT NULL,
      url_key       TEXT NOT NULL,
      source_host   TEXT NOT NULL,
      topic         TEXT,
      relevance     TEXT,
      body          TEXT,
      body_status   TEXT NOT NULL,
      image_url     TEXT,
      image_file    TEXT,
      image_status  TEXT NOT NULL DEFAULT 'none',
      created_at    INTEGER NOT NULL,
      read_at       INTEGER,
      dismissed_at  INTEGER,
      unprocessed   INTEGER NOT NULL DEFAULT 0
    )
  `);
    database.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_feed_items_url_key ON feed_items(url_key)",
    );
    database.exec(
      "CREATE INDEX IF NOT EXISTS idx_feed_items_created ON feed_items(created_at DESC)",
    );

    database.exec(`
    CREATE TABLE IF NOT EXISTS feed_runs (
      id              TEXT PRIMARY KEY,
      started_at      INTEGER NOT NULL,
      finished_at     INTEGER,
      status          TEXT NOT NULL,
      trigger         TEXT NOT NULL,
      error           TEXT,
      queries         TEXT,
      topics          TEXT,
      candidate_count INTEGER NOT NULL DEFAULT 0,
      item_count      INTEGER NOT NULL DEFAULT 0
    )
  `);

    // Create goals table
    database.exec(`
    CREATE TABLE IF NOT EXISTS goals (
      session_id          TEXT PRIMARY KEY,
      objective           TEXT NOT NULL,
      status              TEXT NOT NULL DEFAULT 'active',
      iteration           INTEGER NOT NULL DEFAULT 0,
      first_turn_done     INTEGER NOT NULL DEFAULT 0,
      generation          INTEGER NOT NULL DEFAULT 1,
      token_budget        REAL,
      tokens_used         REAL NOT NULL DEFAULT 0,
      time_budget_seconds REAL,
      time_used_seconds   REAL NOT NULL DEFAULT 0,
      started_at          INTEGER NOT NULL,
      ended_at            INTEGER,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `);

    // Local usage stats: append-only counter rows (see
    // design-docs/2026-09-13-local-usage-stats-design.md).
    createUsageSchema(database);

    log("[Database] Schema initialized");
  } catch (error) {
    logError("[Database] Schema initialization failed:", error);
    throw error;
  }
}

function validateIdentifier(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Invalid SQL identifier: ${name}`);
  }
  return name;
}

const ALLOWED_COLUMN_TYPES = [
  "TEXT NOT NULL DEFAULT",
  "INTEGER DEFAULT",
  "TEXT",
  "INTEGER",
  "REAL",
  "BLOB",
] as const;

function ensureColumn(
  database: DatabaseSync,
  table: string,
  column: string,
  definition: string,
): void {
  validateIdentifier(table);
  validateIdentifier(column);

  // Reconstruct definition from validated parts to prevent SQL injection.
  // The definition format is: "<column> <TYPE_SUFFIX>" — extract the type
  // suffix that follows the column name and validate it against an allowlist.
  const prefix = column + " ";
  if (!definition.startsWith(prefix)) {
    throw new Error(
      `Column definition must start with column name: ${definition}`,
    );
  }
  const typeSuffix = definition.slice(prefix.length).trim().toUpperCase();
  const matchedType = ALLOWED_COLUMN_TYPES.find(
    (t) => typeSuffix === t || typeSuffix.startsWith(t + " "),
  );
  if (!matchedType) {
    throw new Error(`Unsupported column type in definition: ${typeSuffix}`);
  }
  // Use only the validated column name + original (non-uppercased) suffix so
  // that default value tokens are preserved exactly as authored.
  const originalSuffix = definition.slice(prefix.length).trim();
  const safeDefinition = `${column} ${originalSuffix}`;

  const rows = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>;
  const exists = rows.some((row) => row.name === column);
  if (exists) {
    return;
  }
  database.exec(`ALTER TABLE ${table} ADD COLUMN ${safeDefinition}`);
}

/**
 * Initialize the database
 */
export function initDatabase(dbPathOverride?: string): DatabaseInstance {
  if (db) return db;

  const dbPath = dbPathOverride ?? getDatabasePath();
  log("[Database] Opening database at:", dbPath);

  let rawDb: DatabaseSync;
  try {
    rawDb = new DatabaseSync(dbPath, { enableForeignKeyConstraints: true });
  } catch (error) {
    logError("[Database] Failed to open database at:", dbPath, error);
    throw error;
  }

  // Initialize schema
  initializeSchema(rawDb);

  // Prepare statements for better performance
  const insertSession = rawDb.prepare(`
    INSERT OR REPLACE INTO sessions
    (id, title, deskwand_session_id, openai_thread_id, status, cwd, mounted_paths, allowed_tools, memory_enabled, provider_profile_key, model, thinking_level, is_project_mode, archived, archived_at, created_at, updated_at, session_kind)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Note: Dynamic update queries are built in sessions.update() for flexibility
  // const updateSessionStmt = rawDb.prepare(`
  //   UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?
  // `);

  const getSessionStmt = rawDb.prepare(`
    SELECT * FROM sessions WHERE id = ?
  `);

  const getAllSessionsStmt = rawDb.prepare(`
    SELECT * FROM sessions ORDER BY updated_at DESC
  `);

  const deleteSessionStmt = rawDb.prepare(`
    DELETE FROM sessions WHERE id = ?
  `);

  const feedItemInsert = rawDb.prepare(`
    INSERT INTO feed_items (
      id, run_id, title, summary, url, url_key, source_host, topic, relevance,
      body, body_status, image_url, image_file, image_status, created_at,
      read_at, dismissed_at, unprocessed
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const feedItemGet = rawDb.prepare("SELECT * FROM feed_items WHERE id = ?");
  const feedItemListVisible = rawDb.prepare(
    "SELECT * FROM feed_items WHERE dismissed_at IS NULL ORDER BY created_at DESC LIMIT ?",
  );
  const feedItemUnread = rawDb.prepare(
    "SELECT COUNT(*) AS n FROM feed_items WHERE read_at IS NULL AND dismissed_at IS NULL",
  );
  const feedItemMarkRead = rawDb.prepare(
    "UPDATE feed_items SET read_at = ? WHERE id = ? AND read_at IS NULL",
  );
  const feedItemMarkAllRead = rawDb.prepare(
    "UPDATE feed_items SET read_at = ? WHERE read_at IS NULL",
  );
  const feedItemDismiss = rawDb.prepare(
    "UPDATE feed_items SET dismissed_at = ?, read_at = COALESCE(read_at, ?) WHERE id = ?",
  );
  const feedItemCount = rawDb.prepare("SELECT COUNT(*) AS n FROM feed_items");
  const feedItemDeleteAll = rawDb.prepare("DELETE FROM feed_items");
  const feedItemDeleteOlder = rawDb.prepare(
    "DELETE FROM feed_items WHERE created_at < ?",
  );
  const feedItemImageFiles = rawDb.prepare(
    "SELECT image_file FROM feed_items WHERE image_file IS NOT NULL",
  );
  const feedItemUrlKeys = rawDb.prepare("SELECT url_key FROM feed_items");
  const feedItemPrune = rawDb.prepare(
    `DELETE FROM feed_items WHERE id IN (
       SELECT id FROM feed_items ORDER BY created_at DESC LIMIT -1 OFFSET ?
     )`,
  );
  const feedRunInsert = rawDb.prepare(`
    INSERT INTO feed_runs (
      id, started_at, finished_at, status, trigger, error, queries, topics,
      candidate_count, item_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const feedRunFinish = rawDb.prepare(`
    UPDATE feed_runs
    SET status = ?, finished_at = ?, error = ?, candidate_count = ?, item_count = ?
    WHERE id = ?
  `);
  const feedRunSetMeta = rawDb.prepare(
    "UPDATE feed_runs SET queries = ?, topics = ?, candidate_count = ? WHERE id = ?",
  );
  const feedRunDelete = rawDb.prepare("DELETE FROM feed_runs WHERE id = ?");
  const feedRunLatest = rawDb.prepare(
    "SELECT * FROM feed_runs ORDER BY started_at DESC LIMIT 1",
  );
  const feedRunLastSuccess = rawDb.prepare(
    "SELECT MAX(started_at) AS ts FROM feed_runs WHERE status IN ('ok','partial')",
  );
  const feedRunLastAttempt = rawDb.prepare(
    "SELECT MAX(started_at) AS ts FROM feed_runs",
  );
  const feedRunMarkInterrupted = rawDb.prepare(
    "UPDATE feed_runs SET status = 'failed', finished_at = ?, error = 'interrupted' WHERE finished_at IS NULL",
  );
  // SQLite 没有「连续」这个概念：取最近的若干行，在 JS 里数
  const feedRunRecentStatuses = rawDb.prepare(
    "SELECT status FROM feed_runs ORDER BY started_at DESC LIMIT 10",
  );
  const feedRunPrune = rawDb.prepare(
    "DELETE FROM feed_runs WHERE started_at < ?",
  );

  const insertTraceStep = rawDb.prepare(`
    INSERT OR REPLACE INTO trace_steps (
      id, session_id, type, status, title, content, tool_name, tool_input, tool_output, is_error, timestamp, duration
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const getTraceStepsBySessionStmt = rawDb.prepare(`
    SELECT * FROM trace_steps WHERE session_id = ? ORDER BY timestamp ASC
  `);

  const deleteTraceStepsBySessionStmt = rawDb.prepare(`
    DELETE FROM trace_steps WHERE session_id = ?
  `);

  const insertScheduledTask = rawDb.prepare(`
    INSERT OR REPLACE INTO scheduled_tasks (
      id, title, prompt, cwd, run_at, next_run_at, schedule_config, repeat_every, repeat_unit, enabled, last_run_at, last_run_session_id, last_error, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const getScheduledTaskStmt = rawDb.prepare(`
    SELECT * FROM scheduled_tasks WHERE id = ?
  `);

  const getAllScheduledTasksStmt = rawDb.prepare(`
    SELECT * FROM scheduled_tasks ORDER BY created_at ASC
  `);

  const deleteScheduledTaskStmt = rawDb.prepare(`
    DELETE FROM scheduled_tasks WHERE id = ?
  `);

  const upsertGoal = rawDb.prepare(`
    INSERT OR REPLACE INTO goals
    (session_id, objective, status, iteration, first_turn_done, generation,
     token_budget, tokens_used, time_budget_seconds, time_used_seconds,
     started_at, ended_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const getGoalStmt = rawDb.prepare(`
    SELECT * FROM goals WHERE session_id = ?
  `);

  const getAllGoalsStmt = rawDb.prepare(`
    SELECT * FROM goals ORDER BY started_at ASC
  `);

  const deleteGoalStmt = rawDb.prepare(`
    DELETE FROM goals WHERE session_id = ?
  `);

  db = {
    raw: rawDb,

    sessions: {
      create: (session: SessionRow) => {
        insertSession.run(
          session.id,
          session.title,
          session.deskwand_session_id,
          session.openai_thread_id,
          session.status,
          session.cwd,
          session.mounted_paths,
          session.allowed_tools,
          session.memory_enabled,
          session.provider_profile_key,
          session.model,
          session.thinking_level,
          session.is_project_mode,
          session.archived,
          session.archived_at,
          session.created_at,
          session.updated_at,
          session.session_kind ?? "ordinary",
        );
      },

      update: (id: string, updates: Partial<SessionRow>) => {
        // Columns that must never be overwritten after insert
        const IMMUTABLE_COLUMNS = new Set(["id", "created_at"]);

        // Build dynamic update query
        const setClauses: string[] = [];
        const values: unknown[] = [];

        for (const [key, value] of Object.entries(updates)) {
          if (value !== undefined) {
            if (IMMUTABLE_COLUMNS.has(key)) continue;
            validateIdentifier(key);
            setClauses.push(`${key} = ?`);
            values.push(value);
          }
        }

        if (setClauses.length === 0) return;

        // Always update updated_at
        setClauses.push("updated_at = ?");
        values.push(Date.now());
        values.push(id);

        const sql = `UPDATE sessions SET ${setClauses.join(", ")} WHERE id = ?`;
        rawDb
          .prepare(sql)
          .run(...(values as [SQLInputValue, ...SQLInputValue[]]));
      },

      get: (id: string): SessionRow | undefined => {
        return getSessionStmt.get(id) as SessionRow | undefined;
      },

      getAll: (): SessionRow[] => {
        return getAllSessionsStmt.all() as unknown as SessionRow[];
      },

      delete: (id: string) => {
        // Messages will be deleted automatically due to ON DELETE CASCADE
        deleteSessionStmt.run(id);
      },
    },

    traceSteps: {
      create: (step: TraceStepRow) => {
        insertTraceStep.run(
          step.id,
          step.session_id,
          step.type,
          step.status,
          step.title,
          step.content,
          step.tool_name,
          step.tool_input,
          step.tool_output,
          step.is_error,
          step.timestamp,
          step.duration,
        );
      },

      update: (id: string, updates: Partial<TraceStepRow>) => {
        const setClauses: string[] = [];
        const values: unknown[] = [];

        for (const [key, value] of Object.entries(updates)) {
          if (value !== undefined) {
            validateIdentifier(key);
            setClauses.push(`${key} = ?`);
            values.push(value);
          }
        }

        if (setClauses.length === 0) return;

        values.push(id);
        const sql = `UPDATE trace_steps SET ${setClauses.join(", ")} WHERE id = ?`;
        rawDb
          .prepare(sql)
          .run(...(values as [SQLInputValue, ...SQLInputValue[]]));
      },

      getBySessionId: (sessionId: string): TraceStepRow[] => {
        return getTraceStepsBySessionStmt.all(
          sessionId,
        ) as unknown as TraceStepRow[];
      },

      deleteBySessionId: (sessionId: string) => {
        deleteTraceStepsBySessionStmt.run(sessionId);
      },
    },

    scheduledTasks: {
      create: (task: ScheduledTaskRow) => {
        insertScheduledTask.run(
          task.id,
          task.title,
          task.prompt,
          task.cwd,
          task.run_at,
          task.next_run_at,
          task.schedule_config,
          task.repeat_every,
          task.repeat_unit,
          task.enabled,
          task.last_run_at,
          task.last_run_session_id,
          task.last_error,
          task.created_at,
          task.updated_at,
        );
      },

      update: (id: string, updates: Partial<ScheduledTaskRow>) => {
        const setClauses: string[] = [];
        const values: unknown[] = [];

        for (const [key, value] of Object.entries(updates)) {
          if (value !== undefined) {
            validateIdentifier(key);
            setClauses.push(`${key} = ?`);
            values.push(value);
          }
        }

        if (setClauses.length === 0) return;

        setClauses.push("updated_at = ?");
        values.push(Date.now());
        values.push(id);

        const sql = `UPDATE scheduled_tasks SET ${setClauses.join(", ")} WHERE id = ?`;
        rawDb
          .prepare(sql)
          .run(...(values as [SQLInputValue, ...SQLInputValue[]]));
      },

      get: (id: string): ScheduledTaskRow | undefined => {
        return getScheduledTaskStmt.get(id) as ScheduledTaskRow | undefined;
      },

      getAll: (): ScheduledTaskRow[] => {
        return getAllScheduledTasksStmt.all() as unknown as ScheduledTaskRow[];
      },

      delete: (id: string) => {
        deleteScheduledTaskStmt.run(id);
      },
    },

    goals: {
      upsert: (goal: GoalRow) => {
        upsertGoal.run(
          goal.session_id,
          goal.objective,
          goal.status,
          goal.iteration,
          goal.first_turn_done,
          goal.generation,
          goal.token_budget,
          goal.tokens_used,
          goal.time_budget_seconds,
          goal.time_used_seconds,
          goal.started_at,
          goal.ended_at,
        );
      },

      get: (sessionId: string): GoalRow | undefined => {
        return getGoalStmt.get(sessionId) as GoalRow | undefined;
      },

      getAll: (): GoalRow[] => {
        return getAllGoalsStmt.all() as unknown as GoalRow[];
      },

      delete: (sessionId: string) => {
        deleteGoalStmt.run(sessionId);
      },
    },

    feedItems: {
      insert: (row: FeedItemRow) => {
        feedItemInsert.run(
          row.id,
          row.run_id,
          row.title,
          row.summary,
          row.url,
          row.url_key,
          row.source_host,
          row.topic,
          row.relevance,
          row.body,
          row.body_status,
          row.image_url,
          row.image_file,
          row.image_status,
          row.created_at,
          row.read_at,
          row.dismissed_at,
          row.unprocessed,
        );
      },
      get: (id: string) =>
        (feedItemGet.get(id) as unknown as FeedItemRow | undefined) ?? null,
      listVisible: (limit: number) =>
        (feedItemListVisible.all(limit) as unknown as FeedItemRow[]) ?? [],
      unreadCount: () =>
        Number((feedItemUnread.get() as { n: number } | undefined)?.n ?? 0),
      markRead: (id: string, ts: number) => {
        feedItemMarkRead.run(ts, id);
      },
      markAllRead: (ts: number) => {
        feedItemMarkAllRead.run(ts);
      },
      dismiss: (id: string, ts: number) => {
        feedItemDismiss.run(ts, ts, id);
      },
      countAll: () =>
        Number((feedItemCount.get() as { n: number } | undefined)?.n ?? 0),
      deleteAll: () => {
        feedItemDeleteAll.run();
      },
      deleteOlderThan: (ts: number) =>
        Number(feedItemDeleteOlder.run(ts).changes),
      pruneToMax: (count: number) => Number(feedItemPrune.run(count).changes),
      listImageFileNames: () =>
        (feedItemImageFiles.all() as unknown as { image_file: string }[]).map(
          (row) => row.image_file,
        ),
      listUrlKeys: () =>
        (feedItemUrlKeys.all() as unknown as { url_key: string }[]).map(
          (row) => row.url_key,
        ),
    },

    feedRuns: {
      insert: (row: FeedRunRow) => {
        feedRunInsert.run(
          row.id,
          row.started_at,
          row.finished_at,
          row.status,
          row.trigger,
          row.error,
          row.queries,
          row.topics,
          row.candidate_count,
          row.item_count,
        );
      },
      finish: (id: string, patch: FeedRunPatch) => {
        feedRunFinish.run(
          patch.status,
          patch.finished_at,
          patch.error,
          patch.candidate_count,
          patch.item_count,
          id,
        );
      },
      setMeta: (id, meta) => {
        feedRunSetMeta.run(meta.queries, meta.topics, meta.candidate_count, id);
      },
      delete: (id: string) => {
        feedRunDelete.run(id);
      },
      latest: () =>
        (feedRunLatest.get() as unknown as FeedRunRow | undefined) ?? null,
      lastSuccessAt: () => {
        const row = feedRunLastSuccess.get() as
          | { ts: number | null }
          | undefined;
        return row?.ts ?? null;
      },
      lastAttemptAt: () => {
        const row = feedRunLastAttempt.get() as
          | { ts: number | null }
          | undefined;
        return row?.ts ?? null;
      },
      markInterrupted: (ts: number) =>
        Number(feedRunMarkInterrupted.run(ts).changes),
      countConsecutiveFailures: () => {
        const rows = feedRunRecentStatuses.all() as unknown as {
          status: FeedRunStatus;
        }[];
        let count = 0;
        for (const row of rows) {
          if (row.status !== "failed") break;
          count += 1;
        }
        return count;
      },
      pruneOlderThan: (ts: number) => Number(feedRunPrune.run(ts).changes),
    },

    // Compatibility layer for old interface
    prepare: (sql: string) => rawDb.prepare(sql),
    exec: (sql: string) => rawDb.exec(sql),
    close: () => {
      rawDb.close();
      db = null;
    },
  };

  log("[Database] SQLite database initialized successfully");
  return db!;
}

/**
 * Get the existing database instance
 */
export function getDatabase(): DatabaseInstance {
  if (!db) {
    throw new Error("Database not initialized. Call initDatabase() first.");
  }
  return db;
}

/**
 * Close the database connection
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
    log("[Database] Database closed");
  }
}
