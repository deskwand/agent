import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const paths = vi.hoisted(() => ({ userData: "" }));
vi.mock("electron", async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return {
    ...original,
    app: { ...(original.app as object), getPath: () => paths.userData },
  };
});

import {
  initDatabase,
  closeDatabase,
  type SessionRow,
} from "../../main/db/database";

beforeEach(() => {
  closeDatabase();
  paths.userData = mkdtempSync(join(tmpdir(), "session-completed-db-"));
});

afterEach(() => {
  closeDatabase();
  rmSync(paths.userData, { recursive: true, force: true });
});

function sessionRow(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: "s1",
    title: "会话",
    deskwand_session_id: null,
    openai_thread_id: null,
    status: "idle",
    cwd: null,
    mounted_paths: "[]",
    allowed_tools: "[]",
    memory_enabled: 0,
    is_project_mode: 0,
    provider_profile_key: null,
    model: null,
    thinking_level: "medium",
    archived: 0,
    archived_at: null,
    completed_at: null,
    pi_session_file: null,
    created_at: 1_000,
    updated_at: 1_000,
    ...overrides,
  };
}

it("老库缺 completed_at 时自动补列，旧会话读出来是 null", () => {
  const dir = join(paths.userData, "data");
  mkdirSync(dir, { recursive: true });
  const legacy = new DatabaseSync(join(dir, "cowork.db"));
  try {
    legacy.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT NOT NULL, deskwand_session_id TEXT, status TEXT NOT NULL DEFAULT 'idle', cwd TEXT, mounted_paths TEXT NOT NULL DEFAULT '[]', allowed_tools TEXT NOT NULL DEFAULT '[]', memory_enabled INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    INSERT INTO sessions (id,title,created_at,updated_at) VALUES ('old','旧会话',1,1);`);
  } finally {
    legacy.close();
  }

  const db = initDatabase();

  expect(db.sessions.get("old")?.completed_at).toBeNull();
  db.sessions.setCompletedAt("old", 1_700_000_000_000);
  expect(db.sessions.get("old")?.completed_at).toBe(1_700_000_000_000);
});

it("标记完成 / 取消完成都不改 updated_at", () => {
  const db = initDatabase();
  db.sessions.create(sessionRow());

  db.sessions.setCompletedAt("s1", 1_700_000_000_000);
  expect(db.sessions.get("s1")?.completed_at).toBe(1_700_000_000_000);
  expect(db.sessions.get("s1")?.updated_at).toBe(1_000);

  db.sessions.setCompletedAt("s1", null);
  expect(db.sessions.get("s1")?.completed_at).toBeNull();
  expect(db.sessions.get("s1")?.updated_at).toBe(1_000);
});

it("标记完成后列表顺序不变（列表按 updated_at 倒序）", () => {
  const db = initDatabase();
  db.sessions.create(
    sessionRow({ id: "old", created_at: 1_000, updated_at: 1_000 }),
  );
  db.sessions.create(
    sessionRow({ id: "new", created_at: 2_000, updated_at: 2_000 }),
  );

  // 标的是**更旧**的那条：如果实现顺手刷了 updated_at，它会被顶到最前，
  // 这条断言就会红。标最新的那条则"没跳上去"恒真，测不出东西。
  db.sessions.setCompletedAt("old", 3_000);

  expect(db.sessions.getAll().map((row) => row.id)).toEqual(["new", "old"]);
});

it("通用 update 会刷新 updated_at —— 这正是标记不能走它的原因", () => {
  const db = initDatabase();
  db.sessions.create(sessionRow({ updated_at: 1_000 }));

  db.sessions.update("s1", { status: "idle" });

  // 谁把 setCompletedAt 改成走 update()，上面第二条测试会红；谁把 update() 改成
  // 不再刷 updated_at，这条会红。两条一起把"标记不碰时间戳"钉成不可协商的事实。
  expect(db.sessions.get("s1")?.updated_at).toBeGreaterThan(1_000);
});

it("create 会把 completed_at 写下去（不是靠默认值）", () => {
  const db = initDatabase();
  db.sessions.create(sessionRow({ completed_at: 7 }));

  expect(db.sessions.get("s1")?.completed_at).toBe(7);
});
