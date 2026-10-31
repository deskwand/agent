import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";

const paths = vi.hoisted(() => ({ userData: "" }));

vi.mock("electron", async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return {
    ...original,
    app: { ...(original.app as object), getPath: () => paths.userData },
  };
});

vi.mock("electron-store", () => {
  class MockStore {
    public store: Record<string, unknown>;
    constructor(options: { defaults?: Record<string, unknown> }) {
      this.store = { ...options.defaults };
    }

    set(value: Record<string, unknown>): void {
      this.store = { ...this.store, ...value };
    }
  }

  return { default: MockStore };
});

import { closeDatabase, initDatabase } from "../../main/db/database";
import { SessionManager } from "../../main/session/session-manager";
import { buildForkAnchor } from "../../shared/fork-anchor";
import type { Message } from "../../renderer/types";

const SESSION_ID = "session-1";

function messageEntry(
  id: string,
  parentId: string | null,
  role: "user" | "assistant",
  text: string,
): SessionEntry {
  return {
    type: "message",
    id,
    parentId,
    timestamp: "2026-10-30T00:00:00.000Z",
    message: {
      role,
      content: [{ type: "text", text }],
      timestamp: 1,
    },
  } as SessionEntry;
}

const entries: SessionEntry[] = [
  messageEntry("u1", null, "user", "第一轮提问"),
  messageEntry("a1", "u1", "assistant", "第一轮回答"),
  messageEntry("u2", "a1", "user", "第二轮提问"),
  messageEntry("a2", "u2", "assistant", "第二轮回答"),
];

function createManager() {
  const db = initDatabase();
  db.sessions.create({
    id: SESSION_ID,
    title: "hello",
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
    created_at: 1,
    updated_at: 1,
  });
  db.sessions.update(SESSION_ID, { pi_session_file: "/tmp/source.jsonl" });
  const manager = new SessionManager(db, vi.fn());
  // 模拟主进程已完成截断：文件只剩前 keepCount 条
  const state = { entries };
  manager.setEntriesReader(() => state.entries);
  const rewindSessionFile = vi.fn(
    async (
      _sessionId: string,
      _file: string,
      keepEntryId: string,
    ): Promise<{ backupPath: string; keptEntries: number }> => {
      const keepCount =
        state.entries.findIndex((entry) => entry.id === keepEntryId) + 1;
      state.entries = state.entries.slice(0, keepCount);
      return {
        backupPath: "/tmp/source.jsonl.rewind-1.bak",
        keptEntries: keepCount,
      };
    },
  );
  (manager as unknown as { agentRunner: unknown }).agentRunner = {
    rewindSessionFile,
  };
  return { manager, rewindSessionFile, state };
}

beforeEach(() => {
  closeDatabase();
  paths.userData = mkdtempSync(join(tmpdir(), "rewind-session-"));
});

afterEach(() => {
  closeDatabase();
  rmSync(paths.userData, { recursive: true, force: true });
});

it("keeps the target message itself for a user point", async () => {
  const { manager, rewindSessionFile } = createManager();

  const result = await manager.rewindSession(SESSION_ID, "u2");

  expect(rewindSessionFile).toHaveBeenCalledWith(
    SESSION_ID,
    "/tmp/source.jsonl",
    "u2",
  );
  expect(result.droppedCount).toBe(1); // a2
  expect(result.messages.map((m) => m.id)).toEqual(["u1", "a1", "u2"]);
});

it("keeps the target message itself for an assistant point", async () => {
  const { manager, rewindSessionFile } = createManager();

  const result = await manager.rewindSession(SESSION_ID, "a1");

  expect(rewindSessionFile).toHaveBeenCalledWith(
    SESSION_ID,
    "/tmp/source.jsonl",
    "a1",
  );
  expect(result.droppedCount).toBe(2); // u2, a2
  expect(result.messages.map((m) => m.id)).toEqual(["u1", "a1"]);
});

it("resolves a live uuid through the anchor and keeps the entry id", async () => {
  const { manager, rewindSessionFile } = createManager();

  // 渲染层拿到的是流式期间的 uuidv4，JSONL 里只有 entry id
  const live = {
    id: "live-uuid",
    sessionId: SESSION_ID,
    role: "assistant",
    content: [{ type: "text", text: "第一轮回答" }],
    timestamp: 1,
  } as Message;
  await manager.rewindSession(
    SESSION_ID,
    "live-uuid",
    buildForkAnchor(live),
    live.timestamp,
  );

  expect(rewindSessionFile).toHaveBeenCalledWith(
    SESSION_ID,
    "/tmp/source.jsonl",
    "a1",
  );
});

it("rejects a point that only exists in the live cache", async () => {
  const { manager, rewindSessionFile } = createManager();
  // 实时缓存里多一条被取消的回合（uuidv4 id，pi 从未落盘）；entries 列表里没有它
  manager.saveMessage({
    id: "live-1",
    sessionId: SESSION_ID,
    role: "assistant",
    content: [{ type: "text", text: "半截就被取消了" }],
    timestamp: Date.now(),
  } as Message);

  await expect(
    manager.rewindSession(SESSION_ID, "live-1", null, null),
  ).rejects.toThrow();
  expect(rewindSessionFile).not.toHaveBeenCalled();
});

it("rejects while the session is running", async () => {
  const { manager, rewindSessionFile } = createManager();
  (
    manager as unknown as { activeSessions: Map<string, unknown> }
  ).activeSessions.set(SESSION_ID, {});

  await expect(manager.rewindSession(SESSION_ID, "a1")).rejects.toThrow();
  expect(rewindSessionFile).not.toHaveBeenCalled();
});

it("rejects a tool_result row", async () => {
  const { manager, rewindSessionFile } = createManager();
  manager.setEntriesReader(() => [
    ...entries,
    {
      type: "message",
      id: "t1",
      parentId: "a2",
      timestamp: "2026-10-30T00:00:03.000Z",
      message: {
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "bash",
        content: [{ type: "text", text: "ok" }],
        timestamp: 3,
      },
    } as unknown as SessionEntry,
  ]);

  await expect(manager.rewindSession(SESSION_ID, "t1")).rejects.toThrow();
  expect(rewindSessionFile).not.toHaveBeenCalled();
});

it("rejects a point that leaves a tool_use without its result", async () => {
  const { manager, rewindSessionFile } = createManager();
  manager.setEntriesReader(() => [
    messageEntry("u1", null, "user", "跑一下测试"),
    {
      type: "message",
      id: "a1",
      parentId: "u1",
      timestamp: "2026-10-30T00:00:01.000Z",
      message: {
        role: "assistant",
        content: [
          { type: "toolCall", id: "call-1", name: "bash", arguments: {} },
        ],
        timestamp: 2,
      },
    } as unknown as SessionEntry,
  ]);

  await expect(manager.rewindSession(SESSION_ID, "a1")).rejects.toThrow();
  expect(rewindSessionFile).not.toHaveBeenCalled();
});

it("allows rewinding past an earlier aborted tool_use", async () => {
  const { manager, rewindSessionFile } = createManager();
  // pi 会落盘被中止的 assistant 消息：带 toolCall、没有对应 toolResult
  manager.setEntriesReader(() => [
    messageEntry("u1", null, "user", "跑一下测试"),
    {
      type: "message",
      id: "a1",
      parentId: "u1",
      timestamp: "2026-10-30T00:00:01.000Z",
      message: {
        role: "assistant",
        content: [
          { type: "toolCall", id: "call-1", name: "bash", arguments: {} },
        ],
        timestamp: 2,
      },
    } as unknown as SessionEntry,
    messageEntry("u2", "a1", "user", "算了，换个方向"),
    messageEntry("a2", "u2", "assistant", "好"),
  ]);

  const result = await manager.rewindSession(SESSION_ID, "a2");

  expect(rewindSessionFile).toHaveBeenCalledWith(
    SESSION_ID,
    "/tmp/source.jsonl",
    "a2",
  );
  expect(result.droppedCount).toBe(0);
});

it("refuses a new prompt while a rewind is in flight", async () => {
  const { manager, state } = createManager();
  let release: () => void = () => {};
  (
    manager as unknown as {
      agentRunner: { rewindSessionFile: unknown };
    }
  ).agentRunner.rewindSessionFile = vi.fn(
    () =>
      new Promise((resolve) => {
        release = () => {
          state.entries = state.entries.slice(0, 2);
          resolve({ backupPath: "/tmp/bak", keptEntries: 2 });
        };
      }),
  );

  const pending = manager.rewindSession(SESSION_ID, "a1");
  await expect(manager.continueSession(SESSION_ID, "继续")).rejects.toThrow();
  release();
  await pending;
});

it("rejects a second concurrent rewind", async () => {
  const { manager, rewindSessionFile } = createManager();

  const first = manager.rewindSession(SESSION_ID, "a1");
  await expect(manager.rewindSession(SESSION_ID, "a1")).rejects.toThrow();
  await first;

  expect(rewindSessionFile).toHaveBeenCalledTimes(1);
});
