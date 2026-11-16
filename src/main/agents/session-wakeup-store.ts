/**
 * @module main/agents/session-wakeup-store
 *
 * 普通会话自我唤醒的持久化（`session_wakeups` / `session_wakeup_chains`）。
 * 表结构由本模块自建（`CREATE TABLE IF NOT EXISTS`），不往 database.ts 里加访问器。
 *
 * 不建外键：本仓没有开启 `PRAGMA foreign_keys`，孤儿行靠 manager 的
 * `pruneOrphans` 与 `onSessionDeleted` 两处兜底。
 */
import type { DatabaseSync } from "node:sqlite";
import type { SessionWakeup } from "../../shared/session-wakeup";
import type { DatabaseInstance } from "../db/database";

export interface SessionWakeupStore {
  listBySession(sessionId: string): SessionWakeup[];
  /** 有预约的会话 id（去重），启动时用来逐个挂定时器。 */
  listSessionIds(): string[];
  insert(wakeup: SessionWakeup): void;
  deleteWakeup(sessionId: string, wakeupId: string): boolean;
  /** 删除并返回该会话 run_at <= now 的预约。 */
  takeDue(sessionId: string, now: number): SessionWakeup[];
  count(sessionId: string): number;
  deleteBySession(sessionId: string): void;
  /** 删掉会话已不存在的预约，返回清理掉的会话数。 */
  pruneOrphans(exists: (sessionId: string) => boolean): number;
  getChain(sessionId: string): number;
  setChain(sessionId: string, count: number): void;
  clearChain(sessionId: string): void;
}

interface WakeupRow {
  id: string;
  session_id: string;
  run_at: number;
  reason: string;
  created_at: number;
}

function ensureSchema(raw: DatabaseSync): void {
  raw.exec(`
    CREATE TABLE IF NOT EXISTS session_wakeups (
      id         TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      run_at     INTEGER NOT NULL,
      reason     TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_session_wakeups_session
      ON session_wakeups(session_id, run_at);
    CREATE TABLE IF NOT EXISTS session_wakeup_chains (
      session_id  TEXT PRIMARY KEY,
      chain_count INTEGER NOT NULL DEFAULT 0,
      updated_at  INTEGER NOT NULL
    );
  `);
}

function toWakeup(row: WakeupRow): SessionWakeup {
  return {
    id: row.id,
    sessionId: row.session_id,
    runAt: row.run_at,
    reason: row.reason,
    createdAt: row.created_at,
  };
}

export function createSessionWakeupStore(
  db: DatabaseInstance,
): SessionWakeupStore {
  const raw = db.raw;
  ensureSchema(raw);

  const selectBySession = raw.prepare(
    "SELECT * FROM session_wakeups WHERE session_id = ? ORDER BY run_at ASC",
  );
  const selectSessionIds = raw.prepare(
    "SELECT DISTINCT session_id FROM session_wakeups",
  );
  const selectDue = raw.prepare(
    "SELECT * FROM session_wakeups WHERE session_id = ? AND run_at <= ? ORDER BY run_at ASC",
  );
  const deleteDue = raw.prepare(
    "DELETE FROM session_wakeups WHERE session_id = ? AND run_at <= ?",
  );
  const insertStmt = raw.prepare(
    "INSERT INTO session_wakeups (id, session_id, run_at, reason, created_at) VALUES (?, ?, ?, ?, ?)",
  );
  const deleteOne = raw.prepare(
    "DELETE FROM session_wakeups WHERE session_id = ? AND id = ?",
  );
  const deleteAll = raw.prepare(
    "DELETE FROM session_wakeups WHERE session_id = ?",
  );
  const countStmt = raw.prepare(
    "SELECT COUNT(*) AS n FROM session_wakeups WHERE session_id = ?",
  );
  const selectChainSessionIds = raw.prepare(
    "SELECT session_id FROM session_wakeup_chains",
  );
  const selectChain = raw.prepare(
    "SELECT chain_count FROM session_wakeup_chains WHERE session_id = ?",
  );
  const upsertChain = raw.prepare(
    `INSERT INTO session_wakeup_chains (session_id, chain_count, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET
       chain_count = excluded.chain_count,
       updated_at = excluded.updated_at`,
  );
  const deleteChain = raw.prepare(
    "DELETE FROM session_wakeup_chains WHERE session_id = ?",
  );

  const deleteBySession = (sessionId: string): void => {
    deleteAll.run(sessionId);
    deleteChain.run(sessionId);
  };

  const existingSessionIds = (): string[] =>
    (selectSessionIds.all() as unknown as { session_id: string }[]).map(
      (row) => row.session_id,
    );

  return {
    listBySession: (sessionId) =>
      (selectBySession.all(sessionId) as unknown as WakeupRow[]).map(toWakeup),
    listSessionIds: existingSessionIds,
    insert: (wakeup) => {
      insertStmt.run(
        wakeup.id,
        wakeup.sessionId,
        wakeup.runAt,
        wakeup.reason,
        wakeup.createdAt,
      );
    },
    deleteWakeup: (sessionId, wakeupId) =>
      deleteOne.run(sessionId, wakeupId).changes > 0,
    takeDue: (sessionId, now) => {
      const due = (selectDue.all(sessionId, now) as unknown as WakeupRow[]).map(
        toWakeup,
      );
      if (due.length > 0) deleteDue.run(sessionId, now);
      return due;
    },
    count: (sessionId) => (countStmt.get(sessionId) as { n: number }).n,
    deleteBySession,
    pruneOrphans: (exists) => {
      // 预约与链计数各自可能单独存在（投递会删预约、但保留链），两张表都要扫
      const candidates = new Set<string>(existingSessionIds());
      for (const row of selectChainSessionIds.all() as unknown as {
        session_id: string;
      }[]) {
        candidates.add(row.session_id);
      }
      let removed = 0;
      for (const sessionId of candidates) {
        if (exists(sessionId)) continue;
        deleteBySession(sessionId);
        removed += 1;
      }
      return removed;
    },
    getChain: (sessionId) =>
      (selectChain.get(sessionId) as { chain_count: number } | undefined)
        ?.chain_count ?? 0,
    setChain: (sessionId, count) => {
      upsertChain.run(sessionId, count, Date.now());
    },
    clearChain: (sessionId) => {
      deleteChain.run(sessionId);
    },
  };
}
