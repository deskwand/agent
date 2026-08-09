import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// 每个测试重建的临时 userData 目录（electron mock 的 getPath 返回它，避免并行测试共享 /tmp/pi-sessions）
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

// 一行一个 entry 的 JSONL 字符串
const SESSION_HEADER = `{"type":"session","version":3,"id":"sess-src","timestamp":"2026-08-08T10:00:00.000Z","cwd":"/tmp/proj"}`;
const ENTRIES = [
  `{"type":"model_change","id":"m1","parentId":null,"timestamp":"2026-08-08T10:00:00.000Z","provider":"openai","modelId":"gpt-5.4"}`,
  `{"type":"message","id":"u1","parentId":"m1","timestamp":"2026-08-08T10:00:01.000Z","message":{"role":"user","content":[{"type":"text","text":"帮我设计登录页"}]}}`,
  `{"type":"message","id":"a1","parentId":"u1","timestamp":"2026-08-08T10:00:02.000Z","message":{"role":"assistant","content":[{"type":"text","text":"方案如下"}]}}`,
  `{"type":"message","id":"tr1","parentId":"a1","timestamp":"2026-08-08T10:00:02.500Z","message":{"role":"toolResult","toolCallId":"call_1","toolName":"bash","content":[{"type":"text","text":"src\\npackage.json"}]}}`,
  `{"type":"message","id":"u2","parentId":"tr1","timestamp":"2026-08-08T10:00:03.000Z","message":{"role":"user","content":[{"type":"text","text":"改用 OAuth"}]}}`,
  `{"type":"message","id":"a2","parentId":"u2","timestamp":"2026-08-08T10:00:04.000Z","message":{"role":"assistant","content":[{"type":"toolCall","id":"call_1","name":"bash","arguments":{"command":"ls"}},{"type":"text","text":"完成"}]}}`,
];

// loadSession 期望 DB row 形状（snake_case 字段），转成 row
function srcSessionRow(piFile: string): Record<string, unknown> {
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
    pi_session_file: piFile,
    created_at: 1,
    updated_at: 2,
  };
}

let tmpDir: string;
let manager: SessionManager;
let db: DatabaseInstance;
let savedRows: Record<string, unknown>[];
let createdSessions: Session[];
let srcFileHash: string;

beforeEach(async () => {
  currentUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "fork-userdata-"));
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fork-test-"));
  const piFile = path.join(tmpDir, "src.jsonl");
  fs.writeFileSync(piFile, [SESSION_HEADER, ...ENTRIES].join("\n") + "\n");
  const srcRow = srcSessionRow(piFile);
  const srcMsgRows = [
    { id: "msg1", session_id: "sess-src", role: "user", content: JSON.stringify([{ type: "text", text: "帮我设计登录页" }]), timestamp: 1, turn_id: "u1" },
    { id: "msg2", session_id: "sess-src", role: "assistant", content: JSON.stringify([{ type: "text", text: "方案如下" }]), timestamp: 2, turn_id: "a1" },
    // 工具结果独立行：role=assistant + 单个 tool_result 块（对应 JSONL role=toolResult entry）
    { id: "msg-tr", session_id: "sess-src", role: "assistant", content: JSON.stringify([{ type: "tool_result", toolUseId: "call_1", content: "src\npackage.json" }]), timestamp: 2500, turn_id: "tr1" },
    { id: "msg3", session_id: "sess-src", role: "user", content: JSON.stringify([{ type: "text", text: "改用 OAuth" }]), timestamp: 3, turn_id: "u2" },
    { id: "msg4", session_id: "sess-src", role: "assistant", content: JSON.stringify([{ type: "tool_use", id: "call_1", name: "bash", input: { command: "ls" } }, { type: "text", text: "完成" }]), timestamp: 4, turn_id: "a2" },
  ];
  srcFileHash = fs.readFileSync(piFile, "utf8");
  savedRows = [];
  createdSessions = [];
  db = makeDb({
    sessions: {
      create: vi.fn((s: Session) => { createdSessions.push(s); }),
      get: vi.fn((id: string) => (id === "sess-src" ? srcRow : null)),
      getAll: vi.fn(() => []),
      update: vi.fn(),
      delete: vi.fn(),
    },
    messages: {
      create: vi.fn((row: Record<string, unknown>) => { savedRows.push(row); }),
      getBySessionId: vi.fn((sid: string) => (sid === "sess-src" ? srcMsgRows : [])),
      deleteBySessionId: vi.fn(),
      update: vi.fn(),
    },
  });
  manager = new SessionManager(db, vi.fn());
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.rmSync(currentUserDataDir, { recursive: true, force: true });
});

describe("SessionManager.forkSession", () => {
  it("在 a1（第一条助手消息）分叉：新会话消息 = 前 2 条，设置全部继承，status idle", async () => {
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
    expect(fs.existsSync(fork.piSessionFile!)).toBe(true);

    expect(savedRows.map((r) => r.role)).toEqual(["user", "assistant"]);
    expect(JSON.parse(savedRows[0].content as string)).toEqual([{ type: "text", text: "帮我设计登录页" }]);
    expect(JSON.parse(savedRows[1].content as string)).toEqual([{ type: "text", text: "方案如下" }]);
    expect(savedRows[1].turn_id).toBe("a1");

    // 分叉文件只含根到 a1：header + model_change + u1 + a1
    const lines = fs.readFileSync(fork.piSessionFile!, "utf8").trim().split("\n");
    const ids = lines.slice(1).map((l) => JSON.parse(l).id);
    expect(ids).toEqual(["m1", "u1", "a1"]);
  });

  it("在最后一条助手消息 a2 分叉：全保真包含 tool_use 块与 toolResult 物化行", async () => {
    const fork = await manager.forkSession("sess-src", "msg4", "（分叉）");
    // 物化：u1, a1, tr1(→tool_result 行), u2, a2 共 5 行
    expect(savedRows.map((r) => r.role)).toEqual(["user", "assistant", "assistant", "user", "assistant"]);
    expect(JSON.parse(savedRows[2].content as string)).toEqual([
      { type: "tool_result", toolUseId: "call_1", content: "src\npackage.json" },
    ]);
    expect(savedRows[2].turn_id).toBe("tr1");
    const last = savedRows[savedRows.length - 1];
    expect(JSON.parse(last.content as string)).toEqual([
      { type: "tool_use", id: "call_1", name: "bash", input: { command: "ls" } },
      { type: "text", text: "完成" },
    ]);
    const ids = fs
      .readFileSync(fork.piSessionFile!, "utf8")
      .trim().split("\n").slice(1).map((l) => JSON.parse(l).id);
    expect(ids).toEqual(["m1", "u1", "a1", "tr1", "u2", "a2"]);
  });

  it("工具结果独立行（tool_result 块）分叉 → 抛错", async () => {
    await expect(manager.forkSession("sess-src", "msg-tr", "（分叉）")).rejects.toThrow("仅支持从助手消息分叉");
    expect(db.sessions.create).not.toHaveBeenCalled();
  });

  it("原会话 JSONL 文件内容在分叉前后完全不变", async () => {
    await manager.forkSession("sess-src", "msg4", "（分叉）");
    expect(fs.readFileSync(path.join(tmpDir, "src.jsonl"), "utf8")).toBe(srcFileHash);
  });

  it("用户消息分叉 → 抛错", async () => {
    await expect(manager.forkSession("sess-src", "msg1", "（分叉）")).rejects.toThrow("仅支持从助手消息分叉");
    expect(db.sessions.create).not.toHaveBeenCalled();
  });

  it("无 piSessionFile → 抛错，不产生任何新会话", async () => {
    db.sessions.get = vi.fn(() => ({ ...srcSessionRow(path.join(tmpDir, "x.jsonl")), pi_session_file: null }));
    await expect(manager.forkSession("sess-src", "msg2", "（分叉）")).rejects.toThrow("暂不支持分叉");
    expect(db.sessions.create).not.toHaveBeenCalled();
  });

  it("DB 消息与 JSONL 文本不一致（定位失败）→ 抛错且清理", async () => {
    const rows = [
      { id: "msg2", session_id: "sess-src", role: "assistant", content: JSON.stringify([{ type: "text", text: "完全不同的文本" }]), timestamp: 2, turn_id: "a1" },
    ];
    db.messages.getBySessionId = vi.fn(() => rows);
    await expect(manager.forkSession("sess-src", "msg2", "（分叉）")).rejects.toThrow("无法在会话文件中定位分叉点");
  });

  it("物化失败（saveMessage 抛错）→ 删除新会话记录与目录", async () => {
    db.messages.create = vi.fn(() => { throw new Error("db down"); });
    await expect(manager.forkSession("sess-src", "msg2", "（分叉）")).rejects.toThrow("db down");
    expect(db.sessions.delete).toHaveBeenCalledTimes(1);
    // 新会话目录已被清理
    expect(
      fs.existsSync(path.join(currentUserDataDir, "pi-sessions", createdSessions[0].id)),
    ).toBe(false);
  });
});
