/**
 * @module main/agents/persistent-agent-store
 *
 * 常驻智能体与其自主预约的持久化。表结构由本模块自建（`CREATE TABLE IF NOT EXISTS`），
 * 不往 database.ts 里加访问器：只有这个模块读写这两张表。
 */
import type { DatabaseSync } from "node:sqlite";
import type { DatabaseInstance } from "../db/database";
import type {
  AgentScheduleConfig,
  PersistentAgent,
  PersistentAgentWakeup,
} from "../../shared/persistent-agent";
import { DEFAULT_AGENT_HEARTBEAT } from "../../shared/persistent-agent";
import {
  ALL_RISKY_DISABLED,
  ALL_RISKY_ENABLED,
  RISKY_CAPABILITIES,
  type RiskyCapabilities,
} from "../../shared/agent-risky-capabilities";
import { logError } from "../utils/logger";

export interface PersistentAgentStore {
  list(): PersistentAgent[];
  get(id: string): PersistentAgent | null;
  getBySessionId(sessionId: string): PersistentAgent | null;
  insert(agent: PersistentAgent): void;
  update(
    id: string,
    patch: Partial<Omit<PersistentAgent, "id" | "createdAt">>,
  ): PersistentAgent | null;
  delete(id: string): boolean;
  listWakeups(agentId: string): PersistentAgentWakeup[];
  insertWakeup(wakeup: PersistentAgentWakeup): void;
  deleteWakeup(agentId: string, wakeupId: string): boolean;
  /** 删除并返回 run_at <= now 的预约。 */
  takeDueWakeups(agentId: string, now: number): PersistentAgentWakeup[];
  countWakeups(agentId: string): number;
}

interface AgentRow {
  id: string;
  name: string;
  instructions: string;
  cwd: string;
  session_id: string;
  avatar_seed: string | null;
  schedule_config: string;
  enabled: number;
  next_periodic_at: number | null;
  consecutive_failures: number;
  last_wakeup_at: number | null;
  last_error: string | null;
  created_at: number;
  updated_at: number;
  next_check_in_at: number | null;
  check_in_note: string | null;
  trusted_recipients: string | null;
  risky_capabilities: string | null;
}

interface WakeupRow {
  id: string;
  agent_id: string;
  run_at: number;
  reason: string;
  created_at: number;
}

const FALLBACK_SCHEDULE: AgentScheduleConfig = DEFAULT_AGENT_HEARTBEAT;

function ensureSchema(raw: DatabaseSync): void {
  raw.exec(`
    CREATE TABLE IF NOT EXISTS persistent_agents (
      id                   TEXT PRIMARY KEY,
      name                 TEXT NOT NULL,
      instructions         TEXT NOT NULL,
      cwd                  TEXT NOT NULL,
      session_id           TEXT NOT NULL,
      schedule_config      TEXT NOT NULL,
      enabled              INTEGER NOT NULL DEFAULT 1,
      next_periodic_at     INTEGER,
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      last_wakeup_at       INTEGER,
      last_error           TEXT,
      avatar_seed          TEXT,
      created_at           INTEGER NOT NULL,
      updated_at           INTEGER NOT NULL,
      next_check_in_at     INTEGER,
      check_in_note        TEXT,
      trusted_recipients   TEXT,
      risky_capabilities   TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_persistent_agents_session
      ON persistent_agents(session_id);
    CREATE TABLE IF NOT EXISTS persistent_agent_wakeups (
      id         TEXT PRIMARY KEY,
      agent_id   TEXT NOT NULL REFERENCES persistent_agents(id) ON DELETE CASCADE,
      run_at     INTEGER NOT NULL,
      reason     TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_persistent_agent_wakeups_agent
      ON persistent_agent_wakeups(agent_id, run_at);
  `);
  // 头像种子是后加的列：早期建的表没有它
  const columns = raw.prepare("PRAGMA table_info(persistent_agents)").all() as {
    name: string;
  }[];
  if (!columns.some((column) => column.name === "avatar_seed")) {
    raw.exec("ALTER TABLE persistent_agents ADD COLUMN avatar_seed TEXT");
  }
  // 签到是后加的两列
  if (!columns.some((column) => column.name === "next_check_in_at")) {
    raw.exec(
      "ALTER TABLE persistent_agents ADD COLUMN next_check_in_at INTEGER",
    );
  }
  if (!columns.some((column) => column.name === "check_in_note")) {
    raw.exec("ALTER TABLE persistent_agents ADD COLUMN check_in_note TEXT");
  }
  // 外发安全是后加的两列
  if (!columns.some((column) => column.name === "trusted_recipients")) {
    raw.exec(
      "ALTER TABLE persistent_agents ADD COLUMN trusted_recipients TEXT",
    );
  }
  if (!columns.some((column) => column.name === "risky_capabilities")) {
    raw.exec(
      "ALTER TABLE persistent_agents ADD COLUMN risky_capabilities TEXT",
    );
  }
}

function parseTrustedRecipients(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === "string");
    }
  } catch (error) {
    logError("[PersistentAgentStore] Bad trusted_recipients:", error);
  }
  return [];
}

/** 旧行（NULL，迁移前）保持原行为：全部开启；坏 JSON / 结构不符一律全部关闭（失败即关）。 */
function parseRiskyCapabilities(value: string | null): RiskyCapabilities {
  if (!value) return { ...ALL_RISKY_ENABLED };
  try {
    const parsed = JSON.parse(value) as Record<string, unknown> | null;
    if (
      parsed &&
      typeof parsed === "object" &&
      RISKY_CAPABILITIES.every((key) => typeof parsed[key] === "boolean")
    ) {
      return {
        shell: parsed.shell === true,
        browser: parsed.browser === true,
        computer: parsed.computer === true,
      };
    }
  } catch (error) {
    logError("[PersistentAgentStore] Bad risky_capabilities:", error);
  }
  return { ...ALL_RISKY_DISABLED };
}

function parseSchedule(value: string): AgentScheduleConfig {
  try {
    const parsed = JSON.parse(value) as AgentScheduleConfig;
    if (parsed && typeof parsed === "object" && "kind" in parsed) return parsed;
  } catch (error) {
    logError("[PersistentAgentStore] Bad schedule_config:", error);
  }
  return FALLBACK_SCHEDULE;
}

function toAgent(row: AgentRow): PersistentAgent {
  return {
    id: row.id,
    name: row.name,
    instructions: row.instructions,
    cwd: row.cwd,
    sessionId: row.session_id,
    avatarSeed: row.avatar_seed || row.id,
    schedule: parseSchedule(row.schedule_config),
    enabled: row.enabled === 1,
    nextPeriodicAt: row.next_periodic_at,
    consecutiveFailures: row.consecutive_failures,
    lastWakeupAt: row.last_wakeup_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    nextCheckInAt: row.next_check_in_at ?? null,
    checkInNote: row.check_in_note ?? null,
    trustedRecipients: parseTrustedRecipients(row.trusted_recipients),
    riskyCapabilities: parseRiskyCapabilities(row.risky_capabilities),
  };
}

function toRow(agent: PersistentAgent): AgentRow {
  return {
    id: agent.id,
    name: agent.name,
    instructions: agent.instructions,
    cwd: agent.cwd,
    session_id: agent.sessionId,
    avatar_seed: agent.avatarSeed,
    schedule_config: JSON.stringify(agent.schedule),
    enabled: agent.enabled ? 1 : 0,
    next_periodic_at: agent.nextPeriodicAt,
    consecutive_failures: agent.consecutiveFailures,
    last_wakeup_at: agent.lastWakeupAt,
    last_error: agent.lastError,
    created_at: agent.createdAt,
    updated_at: agent.updatedAt,
    next_check_in_at: agent.nextCheckInAt,
    check_in_note: agent.checkInNote,
    trusted_recipients: JSON.stringify(agent.trustedRecipients),
    risky_capabilities: JSON.stringify(agent.riskyCapabilities),
  };
}

function toWakeup(row: WakeupRow): PersistentAgentWakeup {
  return {
    id: row.id,
    agentId: row.agent_id,
    runAt: row.run_at,
    reason: row.reason,
    createdAt: row.created_at,
  };
}

export function createPersistentAgentStore(
  db: DatabaseInstance,
): PersistentAgentStore {
  const raw = db.raw;
  ensureSchema(raw);

  const selectAll = raw.prepare(
    "SELECT * FROM persistent_agents ORDER BY created_at ASC",
  );
  const selectById = raw.prepare(
    "SELECT * FROM persistent_agents WHERE id = ?",
  );
  const selectBySession = raw.prepare(
    "SELECT * FROM persistent_agents WHERE session_id = ?",
  );
  const insertAgent = raw.prepare(`
    INSERT INTO persistent_agents (
      id, name, instructions, cwd, session_id, schedule_config, enabled,
      next_periodic_at, consecutive_failures, last_wakeup_at, last_error,
      avatar_seed, created_at, updated_at, next_check_in_at, check_in_note,
      trusted_recipients, risky_capabilities
    ) VALUES (
      :id, :name, :instructions, :cwd, :session_id, :schedule_config, :enabled,
      :next_periodic_at, :consecutive_failures, :last_wakeup_at, :last_error,
      :avatar_seed, :created_at, :updated_at, :next_check_in_at, :check_in_note,
      :trusted_recipients, :risky_capabilities
    )
  `);
  const updateAgent = raw.prepare(`
    UPDATE persistent_agents SET
      name = :name, instructions = :instructions, cwd = :cwd,
      session_id = :session_id, schedule_config = :schedule_config,
      enabled = :enabled, next_periodic_at = :next_periodic_at,
      consecutive_failures = :consecutive_failures,
      last_wakeup_at = :last_wakeup_at, last_error = :last_error,
      avatar_seed = :avatar_seed, updated_at = :updated_at,
      next_check_in_at = :next_check_in_at, check_in_note = :check_in_note,
      trusted_recipients = :trusted_recipients,
      risky_capabilities = :risky_capabilities
    WHERE id = :id
  `);
  const deleteAgent = raw.prepare("DELETE FROM persistent_agents WHERE id = ?");
  const selectWakeups = raw.prepare(
    "SELECT * FROM persistent_agent_wakeups WHERE agent_id = ? ORDER BY run_at ASC",
  );
  const selectDueWakeups = raw.prepare(
    "SELECT * FROM persistent_agent_wakeups WHERE agent_id = ? AND run_at <= ? ORDER BY run_at ASC",
  );
  const deleteDueWakeups = raw.prepare(
    "DELETE FROM persistent_agent_wakeups WHERE agent_id = ? AND run_at <= ?",
  );
  const insertWakeupStmt = raw.prepare(
    "INSERT INTO persistent_agent_wakeups (id, agent_id, run_at, reason, created_at) VALUES (?, ?, ?, ?, ?)",
  );
  const deleteWakeupStmt = raw.prepare(
    "DELETE FROM persistent_agent_wakeups WHERE agent_id = ? AND id = ?",
  );
  const countWakeupsStmt = raw.prepare(
    "SELECT COUNT(*) AS n FROM persistent_agent_wakeups WHERE agent_id = ?",
  );

  const get = (id: string): PersistentAgent | null => {
    const row = selectById.get(id) as AgentRow | undefined;
    return row ? toAgent(row) : null;
  };

  return {
    list: () => (selectAll.all() as unknown as AgentRow[]).map(toAgent),
    get,
    getBySessionId: (sessionId) => {
      const row = selectBySession.get(sessionId) as AgentRow | undefined;
      return row ? toAgent(row) : null;
    },
    insert: (agent) => {
      insertAgent.run({ ...toRow(agent) });
    },
    update: (id, patch) => {
      const existing = get(id);
      if (!existing) return null;
      const next: PersistentAgent = {
        ...existing,
        ...patch,
        // 同一毫秒内连续写也要让 updatedAt 前进
        updatedAt: Math.max(Date.now(), existing.updatedAt + 1),
      };
      // UPDATE 语句没有 :created_at，多传命名参数 node:sqlite 会报错
      const row: Partial<AgentRow> = toRow(next);
      delete row.created_at;
      updateAgent.run({ ...row });
      return next;
    },
    delete: (id) => deleteAgent.run(id).changes > 0,
    listWakeups: (agentId) =>
      (selectWakeups.all(agentId) as unknown as WakeupRow[]).map(toWakeup),
    insertWakeup: (wakeup) => {
      insertWakeupStmt.run(
        wakeup.id,
        wakeup.agentId,
        wakeup.runAt,
        wakeup.reason,
        wakeup.createdAt,
      );
    },
    deleteWakeup: (agentId, wakeupId) =>
      deleteWakeupStmt.run(agentId, wakeupId).changes > 0,
    takeDueWakeups: (agentId, now) => {
      const due = (
        selectDueWakeups.all(agentId, now) as unknown as WakeupRow[]
      ).map(toWakeup);
      if (due.length > 0) deleteDueWakeups.run(agentId, now);
      return due;
    },
    countWakeups: (agentId) =>
      (countWakeupsStmt.get(agentId) as { n: number }).n,
  };
}
