import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// 每个测试重建的临时 userData 目录（electron mock 的 getPath 返回它）
let currentUserDataDir: string;

vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    getPath: () => currentUserDataDir,
    getVersion: () => "0.0.0",
  },
}));

vi.mock("electron-store", () => {
  class MockStore<T extends Record<string, unknown>> {
    public store: Record<string, unknown>;
    public path = "/tmp/mock.json";
    constructor(options: { defaults?: Record<string, unknown> }) {
      this.store = { ...(options?.defaults || {}) };
    }
    get<K extends keyof T>(key: K): T[K] {
      return this.store[key as string] as T[K];
    }
    set(key: string | Record<string, unknown>, value?: unknown): void {
      if (typeof key === "string") this.store[key] = value;
      else this.store = { ...this.store, ...key };
    }
  }
  return { default: MockStore };
});

vi.mock("../src/main/agent/agent-runner", () => ({
  AgentRunner: class {
    run = vi.fn();
    cancel = vi.fn();
    handleQuestionResponse = vi.fn();
  },
}));
vi.mock("../src/main/mcp/mcp-config-store", () => ({
  mcpConfigStore: { getEnabledServers: () => [] },
}));

import { SessionManager } from "../src/main/session/session-manager";
import type { DatabaseInstance } from "../src/main/db/database";
import type { Session } from "../src/renderer/types";

function makeDb(overrides: Partial<DatabaseInstance> = {}): DatabaseInstance {
  return {
    sessions: {
      create: vi.fn(),
      get: vi.fn(() => null),
      getAll: vi.fn(() => []),
      update: vi.fn(),
      delete: vi.fn(),
    },
    messages: {
      create: vi.fn(),
      getBySessionId: vi.fn(() => []),
      deleteBySessionId: vi.fn(),
      update: vi.fn(),
    },
    ...(overrides as object),
  } as unknown as DatabaseInstance;
}

// loadSession 期望 DB row 形状（snake_case 字段）
function srcSessionRow(): Record<string, unknown> {
  return {
    id: "sess-src",
    title: "登录页设计",
    deskwand_session_id: null,
    openai_thread_id: null,
    status: "completed",
    cwd: "/tmp/proj",
    mounted_paths: JSON.stringify([{ virtual: "/mnt/proj", real: "/tmp/proj" }]),
    allowed_tools: JSON.stringify(["read", "write", "bash"]),
    memory_enabled: 1,
    is_project_mode: 1,
    provider_profile_key: "openai",
    model: "gpt-5.4",
    thinking_level: "high",
    archived: 0,
    archived_at: null,
    pi_session_file: "/tmp/proj/src.jsonl",
    created_at: 1,
    updated_at: 2,
  };
}

const srcMsgRows = [
  { id: "msg1", session_id: "sess-src", role: "user", content: JSON.stringify([{ type: "text", text: "帮我设计登录页" }]), timestamp: 1, turn_id: "u1" },
  { id: "msg2", session_id: "sess-src", role: "assistant", content: JSON.stringify([{ type: "text", text: "方案如下" }]), timestamp: 2, turn_id: "a1" },
  { id: "msg3", session_id: "sess-src", role: "user", content: JSON.stringify([{ type: "text", text: "改用 OAuth" }]), timestamp: 3, turn_id: "u2" },
  { id: "msg4", session_id: "sess-src", role: "assistant", content: JSON.stringify([{ type: "tool_use", id: "call_1", name: "bash", input: { command: "ls" } }, { type: "text", text: "完成" }]), timestamp: 4, turn_id: "a2" },
  // 工具结果独立行
  { id: "msg-tr", session_id: "sess-src", role: "assistant", content: JSON.stringify([{ type: "tool_result", toolUseId: "call_1", content: "src\npackage.json" }]), timestamp: 5, turn_id: "tr1" },
  { id: "msg5", session_id: "sess-src", role: "user", content: JSON.stringify([{ type: "text", text: "再想想" }]), timestamp: 6, turn_id: "u3" },
];

let manager: SessionManager;
let db: DatabaseInstance;
let savedRows: Record<string, unknown>[];
let createdSessions: Session[];

beforeEach(async () => {
  currentUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "fork-userdata-"));
  savedRows = [];
  createdSessions = [];
  db = makeDb({
    sessions: {
      create: vi.fn((s: Session) => { createdSessions.push(s); }),
      get: vi.fn(() => srcSessionRow()),
      getAll: vi.fn(() => []),
      update: vi.fn(),
      delete: vi.fn(),
    },
    messages: {
      create: vi.fn((row: Record<string, unknown>) => { savedRows.push(row); }),
      getBySessionId: vi.fn(() => srcMsgRows),
      deleteBySessionId: vi.fn(),
      update: vi.fn(),
    },
  });
  manager = new SessionManager(db, vi.fn());
});

afterEach(() => {
  fs.rmSync(currentUserDataDir, { recursive: true, force: true });
});

describe("SessionManager.forkSession", () => {
  it("在 msg2（第一条助手消息）分叉：复制分叉点及之前消息，设置全部继承，status idle", async () => {
    const fork = await manager.forkSession("sess-src", "msg2", "（分叉）");
    expect(fork.id).not.toBe("sess-src");
    expect(fork.title).toBe("登录页设计（分叉）");
    expect(fork.status).toBe("idle");
    expect(fork.piSessionFile).toBeUndefined();
    expect(fork.cwd).toBe("/tmp/proj");
    expect(fork.mountedPaths).toEqual([{ virtual: "/mnt/proj", real: "/tmp/proj" }]);
    expect(fork.allowedTools).toEqual(["read", "write", "bash"]);
    expect(fork.memoryEnabled).toBe(true);
    expect(fork.providerProfileKey).toBe("openai");
    expect(fork.model).toBe("gpt-5.4");
    expect(fork.thinkingLevel).toBe("high");
    expect(fork.isProjectMode).toBe(true);

    // 复制 msg1 + msg2，content/timestamp/turnId 原样，id 重生成
    expect(savedRows).toHaveLength(2);
    expect(savedRows[0].session_id).toBe(fork.id);
    expect(JSON.parse(savedRows[0].content as string)).toEqual([{ type: "text", text: "帮我设计登录页" }]);
    expect(savedRows[0].timestamp).toBe(1);
    expect(savedRows[0].turn_id).toBe("u1");
    expect(JSON.parse(savedRows[1].content as string)).toEqual([{ type: "text", text: "方案如下" }]);
    expect(savedRows[1].timestamp).toBe(2);
    expect(savedRows[1].turn_id).toBe("a1");
    expect(savedRows[0].id).not.toBe("msg1");
  });

  it("在最后一条助手消息 a2 分叉：包含 tool_use 块（原样复制，不含其后消息）", async () => {
    const fork = await manager.forkSession("sess-src", "msg4", "（分叉）");
    // msg1..msg4 共 4 条（不含 msg-tr 之后的 msg5）
    expect(savedRows.map((r) => r.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(JSON.parse(savedRows[3].content as string)).toEqual([
      { type: "tool_use", id: "call_1", name: "bash", input: { command: "ls" } },
      { type: "text", text: "完成" },
    ]);
    expect(savedRows[3].turn_id).toBe("a2");
    expect(fork.piSessionFile).toBeUndefined();
  });

  it("工具结果独立行（tool_result 块）分叉 → 抛错，不创建会话", async () => {
    await expect(manager.forkSession("sess-src", "msg-tr", "（分叉）")).rejects.toThrow("仅支持从助手消息分叉");
    expect(db.sessions.create).not.toHaveBeenCalled();
  });

  it("用户消息分叉 → 抛错，不创建会话", async () => {
    await expect(manager.forkSession("sess-src", "msg1", "（分叉）")).rejects.toThrow("仅支持从助手消息分叉");
    expect(db.sessions.create).not.toHaveBeenCalled();
  });

  it("复制中途失败（saveMessage 抛错）→ 删除新会话记录，无半成品", async () => {
    db.messages.create = vi.fn(() => { throw new Error("db down"); });
    await expect(manager.forkSession("sess-src", "msg2", "（分叉）")).rejects.toThrow("db down");
    expect(db.sessions.delete).toHaveBeenCalledTimes(1);
  });

  it("源会话完全不被修改（DB 读取之外无任何写入）", async () => {
    await manager.forkSession("sess-src", "msg4", "（分叉）");
    // 源会话只被 get 读取；sessions.update / messages.update / deleteBySessionId 均未被调用
    expect((db.sessions.update as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
    expect((db.messages.update as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });
});
