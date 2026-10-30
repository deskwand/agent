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
  // insertSession 不绑定 pi_session_file，分叉需要它指向的源 JSONL
  db.sessions.update(SESSION_ID, { pi_session_file: "/tmp/source.jsonl" });
  const manager = new SessionManager(db, vi.fn());
  const forkSessionFile = vi.fn(async () => "/tmp/forked.jsonl");
  // 只用 fork 需要的两件事替换 runner：真 AgentRunner 会建 pi 会话与工具
  (manager as unknown as { agentRunner: unknown }).agentRunner = {
    forkSessionFile,
  };
  manager.setEntriesReader(() => entries);
  return { manager, forkSessionFile };
}

beforeEach(() => {
  closeDatabase();
  paths.userData = mkdtempSync(join(tmpdir(), "fork-anchor-"));
});

afterEach(() => {
  closeDatabase();
  rmSync(paths.userData, { recursive: true, force: true });
});

it("forks the right entry when the renderer id is a live uuid that main lost", async () => {
  const { manager, forkSessionFile } = createManager();
  // 主进程缓存以 entries 重建（会话停止 / 缓存淘汰后的常态），
  // 渲染层手里却还是流式那条消息的 uuidv4 id
  manager.getMessages(SESSION_ID);

  const anchor = buildForkAnchor({
    content: [{ type: "text", text: "第二轮回答" }],
  });
  const forked = await manager.forkSession(
    SESSION_ID,
    "9f1d8c3e-live-uuid-not-in-entries",
    " (分叉)",
    anchor,
  );

  expect(forked.title).toBe("hello (分叉)");
  expect(forkSessionFile).toHaveBeenCalledWith(
    "/tmp/source.jsonl",
    forked.id,
    undefined,
    "a2",
  );
});

it("keeps the entry id exact when the cache holds a live-only message before it", async () => {
  const { manager, forkSessionFile } = createManager();
  const fromEntries = manager.getMessages(SESSION_ID);
  const cache = (manager as unknown as { messageCache: Map<string, Message[]> })
    .messageCache;
  // 缓存里夹着一条没落盘的消息（错误气泡是运行时才有的），它会把序号整体推后
  const liveOnly: Message = {
    id: "live-error-bubble",
    sessionId: SESSION_ID,
    role: "assistant",
    content: [{ type: "text", text: "Error: 404" }],
    timestamp: 2,
    turnId: "u2",
  };
  cache.set(SESSION_ID, [
    ...fromEntries.slice(0, 3),
    liveOnly,
    { ...fromEntries[3], id: "live-uuid-second-answer" },
  ]);

  const anchor = buildForkAnchor({
    content: [{ type: "text", text: "第二轮回答" }],
  });
  const forked = await manager.forkSession(
    SESSION_ID,
    "live-uuid-second-answer",
    " (分叉)",
    anchor,
    fromEntries[3].timestamp,
  );

  expect(forkSessionFile).toHaveBeenCalledWith(
    "/tmp/source.jsonl",
    forked.id,
    undefined,
    "a2",
  );
});

it("still forks by id when the message is in the current list", async () => {
  const { manager, forkSessionFile } = createManager();
  manager.getMessages(SESSION_ID);

  const forked = await manager.forkSession(SESSION_ID, "a1", " (分叉)");

  expect(forkSessionFile).toHaveBeenCalledWith(
    "/tmp/source.jsonl",
    forked.id,
    undefined,
    "a1",
  );
});

it("reports a missing fork point when neither id nor anchor match", async () => {
  const { manager, forkSessionFile } = createManager();
  manager.getMessages(SESSION_ID);

  await expect(
    manager.forkSession(
      SESSION_ID,
      "unknown-id",
      " (分叉)",
      buildForkAnchor({ content: [{ type: "text", text: "不存在的回答" }] }),
    ),
  ).rejects.toThrow(/fork point message not found|分叉点消息不存在/i);
  expect(forkSessionFile).not.toHaveBeenCalled();
});
