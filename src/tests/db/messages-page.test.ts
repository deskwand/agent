import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { queryMessagesPage } from "../../main/db/database";

function createDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:", {
    enableForeignKeyConstraints: true,
  });
  db.exec(`
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      token_usage TEXT,
      turn_id TEXT,
      execution_time_ms INTEGER
    );
    CREATE INDEX idx_messages_session_id ON messages(session_id);
    CREATE INDEX idx_messages_timestamp ON messages(session_id, timestamp);
  `);
  return db;
}

function insert(
  db: DatabaseSync,
  sessionId: string,
  id: string,
  ts: number,
  role = "user",
): void {
  db.prepare(
    "INSERT INTO messages (id, session_id, role, content, timestamp) VALUES (?, ?, ?, '[]', ?)",
  ).run(id, sessionId, role, ts);
}

describe("queryMessagesPage", () => {
  it("returns the tail page (newest messages, ascending order) with hasMore", () => {
    const db = createDb();
    for (let i = 1; i <= 10; i++) insert(db, "s1", `m${i}`, 1000 + i);
    const page = queryMessagesPage(db, "s1", null, 4);
    expect(page.hasMore).toBe(true);
    expect(page.rows.map((r) => r.id)).toEqual(["m7", "m8", "m9", "m10"]);
  });

  it("pages backward without duplicates or gaps using id cursor", () => {
    const db = createDb();
    for (let i = 1; i <= 10; i++) insert(db, "s1", `m${i}`, 1000 + i);
    const page1 = queryMessagesPage(db, "s1", null, 4);
    const page2 = queryMessagesPage(db, "s1", page1.rows[0].id, 4);
    expect(page2.rows.map((r) => r.id)).toEqual(["m3", "m4", "m5", "m6"]);
    const page3 = queryMessagesPage(db, "s1", page2.rows[0].id, 4);
    expect(page3.rows.map((r) => r.id)).toEqual(["m1", "m2"]);
    expect(page3.hasMore).toBe(false);
  });

  it("orders messages with equal timestamps by rowid (insertion order)", () => {
    const db = createDb();
    insert(db, "s1", "a", 1000);
    insert(db, "s1", "b", 1000);
    insert(db, "s1", "c", 1000);
    const page = queryMessagesPage(db, "s1", null, 10);
    // Ascending: a,b,c (insertion order). Cursor at "c" yields a,b —
    // no duplicate, no skip.
    expect(page.rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
    const next = queryMessagesPage(db, "s1", "c", 10);
    expect(next.rows.map((r) => r.id)).toEqual(["a", "b"]);
    expect(next.hasMore).toBe(false);
  });

  it("returns empty page for unknown cursor and empty session", () => {
    const db = createDb();
    expect(queryMessagesPage(db, "s1", null, 10)).toEqual({
      rows: [],
      hasMore: false,
    });
    insert(db, "s1", "m1", 1000);
    expect(queryMessagesPage(db, "s1", "ghost-id", 10)).toEqual({
      rows: [],
      hasMore: false,
    });
  });

  it("does not cross session boundaries", () => {
    const db = createDb();
    insert(db, "s1", "m1", 1000);
    insert(db, "s2", "other", 1000);
    const page = queryMessagesPage(db, "s1", null, 10);
    expect(page.rows.map((r) => r.id)).toEqual(["m1"]);
    expect(page.hasMore).toBe(false);
  });

  it("returns hasMore=false when limit exceeds remaining rows", () => {
    const db = createDb();
    for (let i = 1; i <= 3; i++) insert(db, "s1", `m${i}`, 1000 + i);
    const page = queryMessagesPage(db, "s1", null, 5);
    expect(page.rows).toHaveLength(3);
    expect(page.hasMore).toBe(false);
  });
});

function insertTurn(
  db: DatabaseSync,
  sessionId: string,
  n: number,
  base = 1000,
): void {
  insert(db, sessionId, `u${n}`, base + n * 2, "user");
  insert(db, sessionId, `a${n}`, base + n * 2 + 1, "assistant");
}

describe("queryMessagesPage turn-aligned pages", () => {
  it("extends the page start backward so it begins at a user message", () => {
    const db = createDb();
    // 60 个回合（120 条），尾部页 limit=5
    for (let i = 1; i <= 60; i++) insertTurn(db, "s1", i);
    const page = queryMessagesPage(db, "s1", null, 5);
    const ids = page.rows.map((r) => r.id);
    // 原始 5 条 = [a58, u59, a59, u60, a60]（起点 assistant）→ 增量扩展 51 条，
    // 页首对齐到最近的 user 边界 u33（奇数批保证交替数据一轮到位）。
    expect(ids.slice(-5)).toEqual(["a58", "u59", "a59", "u60", "a60"]);
    expect(ids[0]).toBe("u33");
    expect(
      ids.filter((id) => id.startsWith("u")).length,
    ).toBeGreaterThanOrEqual(2);
    expect(page.hasMore).toBe(true);
  });

  it("extends cursor pages so consecutive pages never overlap and each starts at a user", () => {
    const db = createDb();
    for (let i = 1; i <= 200; i++) insertTurn(db, "s1", i);
    const page1 = queryMessagesPage(db, "s1", null, 5);
    expect(page1.rows[0].id.startsWith("u")).toBe(true);
    expect(page1.hasMore).toBe(true);
    const page2 = queryMessagesPage(db, "s1", page1.rows[0].id, 5);
    expect(page2.rows[0].id.startsWith("u")).toBe(true);
    expect(
      page2.rows.filter((r) => r.role === "user").length,
    ).toBeGreaterThanOrEqual(2);
    // 无重叠：page2 全部早于 page1
    const page1FirstTs = page1.rows[0].timestamp;
    expect(page2.rows[page2.rows.length - 1].timestamp).toBeLessThan(
      page1FirstTs,
    );
    // 拼接后严格升序无重复
    const all = [...page2.rows, ...page1.rows].map((r) => r.id);
    expect(new Set(all).size).toBe(all.length);
  });

  it("handles a page that can never reach two users (history start)", () => {
    const db = createDb();
    // 只有 1 个 user 的会话
    insert(db, "s1", "u1", 100);
    insert(db, "s1", "a1", 101);
    insert(db, "s1", "a2", 102);
    const page = queryMessagesPage(db, "s1", null, 10);
    expect(page.rows.map((r) => r.id)).toEqual(["u1", "a1", "a2"]);
    expect(page.hasMore).toBe(false);
  });
});
