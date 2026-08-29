import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";

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

const forkSessionFileMock = vi.fn();
vi.mock("../src/main/agent/agent-runner", () => ({
  AgentRunner: class {
    run = vi.fn();
    cancel = vi.fn();
    handleQuestionResponse = vi.fn();
    forkSessionFile = forkSessionFileMock;
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
    traceSteps: {
      create: vi.fn(),
      update: vi.fn(),
      getBySessionId: vi.fn(() => []),
      deleteBySessionId: vi.fn(),
    },
    ...(overrides as object),
  } as unknown as DatabaseInstance;
}

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

const entries: SessionEntry[] = [
  { type: "message", id: "msg1", parentId: null, timestamp: "t1", message: { role: "user", content: [{ type: "text", text: "帮我设计登录页" }], timestamp: 1 } },
  { type: "message", id: "msg2", parentId: "msg1", timestamp: "t2", message: { role: "assistant", content: [{ type: "text", text: "方案如下" }], timestamp: 2 } },
  { type: "message", id: "msg3", parentId: "msg2", timestamp: "t3", message: { role: "user", content: [{ type: "text", text: "改用 OAuth" }], timestamp: 3 } },
  { type: "message", id: "msg4", parentId: "msg3", timestamp: "t4", message: { role: "assistant", content: [{ type: "toolCall", id: "call_1", name: "bash", arguments: { command: "ls" } }, { type: "text", text: "完成" }], timestamp: 4 } },
  { type: "message", id: "msg-tr", parentId: "msg4", timestamp: "t5", message: { role: "toolResult", toolCallId: "call_1", toolName: "bash", content: [{ type: "text", text: "src" }], isError: false, timestamp: 5 } },
] as SessionEntry[];

let manager: SessionManager;
let db: DatabaseInstance;
let createdSessions: Session[];

beforeEach(async () => {
  currentUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "fork-userdata-"));
  forkSessionFileMock.mockReset();
  forkSessionFileMock.mockResolvedValue("/tmp/forked.jsonl");
  createdSessions = [];
  db = makeDb({
    sessions: {
      create: vi.fn((s: Session) => { createdSessions.push(s); }),
      get: vi.fn(() => srcSessionRow()),
      getAll: vi.fn(() => []),
      update: vi.fn(),
      delete: vi.fn(),
    },
  });
  manager = new SessionManager(db, vi.fn());
  manager.setEntriesReader(() => entries);
});

afterEach(() => {
  fs.rmSync(currentUserDataDir, { recursive: true, force: true });
});

describe("SessionManager.forkSession (JSONL forkFrom)", () => {
  it("在 msg2（第一条助手消息）分叉：调 forkSessionFile、继承设置、status idle", async () => {
    const fork = await manager.forkSession("sess-src", "msg2", "（分叉）");
    expect(fork.id).not.toBe("sess-src");
    expect(fork.title).toBe("登录页设计（分叉）");
    expect(fork.status).toBe("idle");
    expect(fork.cwd).toBe("/tmp/proj");
    expect(fork.mountedPaths).toEqual([{ virtual: "/mnt/proj", real: "/tmp/proj" }]);
    expect(fork.allowedTools).toEqual(["read", "write", "bash"]);
    expect(fork.memoryEnabled).toBe(true);
    expect(fork.providerProfileKey).toBe("openai");
    expect(fork.model).toBe("gpt-5.4");
    expect(fork.thinkingLevel).toBe("high");
    expect(fork.isProjectMode).toBe(true);

    expect(forkSessionFileMock).toHaveBeenCalledWith(
      "/tmp/proj/src.jsonl",
      fork.id,
      "/tmp/proj",
      "msg2",
    );
    expect(db.sessions.update).toHaveBeenCalledWith(fork.id, { pi_session_file: "/tmp/forked.jsonl" });
  });

  it("在助手消息 msg4（含 tool_use 块）分叉", async () => {
    const fork = await manager.forkSession("sess-src", "msg4", "（分叉）");
    expect(forkSessionFileMock).toHaveBeenCalledWith(
      "/tmp/proj/src.jsonl",
      fork.id,
      "/tmp/proj",
      "msg4",
    );
  });

  it("工具结果（tool_result 块）分叉 → 抛错，不创建会话", async () => {
    await expect(manager.forkSession("sess-src", "msg-tr", "（分叉）")).rejects.toThrow("仅支持从助手消息分叉");
    expect(db.sessions.create).not.toHaveBeenCalled();
    expect(forkSessionFileMock).not.toHaveBeenCalled();
  });

  it("用户消息分叉 → 抛错，不创建会话", async () => {
    await expect(manager.forkSession("sess-src", "msg1", "（分叉）")).rejects.toThrow("仅支持从助手消息分叉");
    expect(db.sessions.create).not.toHaveBeenCalled();
    expect(forkSessionFileMock).not.toHaveBeenCalled();
  });

  it("forkSessionFile 失败 → 删除新会话记录，无半成品", async () => {
    forkSessionFileMock.mockRejectedValue(new Error("fork failed"));
    await expect(manager.forkSession("sess-src", "msg2", "（分叉）")).rejects.toThrow("fork failed");
    expect(db.sessions.delete).toHaveBeenCalledTimes(1);
  });

  it("源会话完全不被修改（仅读 + forkFrom）", async () => {
    await manager.forkSession("sess-src", "msg4", "（分叉）");
    expect((db.sessions.update as ReturnType<typeof vi.fn>).mock.calls.length).toBeLessThanOrEqual(1);
    // 唯一一次 update 是写入新会话的 pi_session_file
    const updates = (db.sessions.update as ReturnType<typeof vi.fn>).mock.calls;
    const newSessionId = createdSessions[0]?.id;
    expect(updates.length === 0 || updates[0][0] === newSessionId).toBe(true);
  });
});
