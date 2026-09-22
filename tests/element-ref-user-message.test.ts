import { describe, expect, it, vi } from "vitest";
import type { DatabaseInstance } from "../src/main/db/database";

vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    getPath: () => "/tmp",
    getVersion: () => "0.0.0",
  },
}));

vi.mock("electron-store", () => {
  class MockStore<T extends Record<string, unknown>> {
    public store: Record<string, unknown>;
    public path = "/tmp/mock-element-ref-config-store.json";

    constructor(options: { defaults?: Record<string, unknown> }) {
      this.store = { ...(options?.defaults || {}) };
    }

    get<K extends keyof T>(key: K): T[K] {
      return this.store[key as string] as T[K];
    }

    set(key: string | Record<string, unknown>, value?: unknown): void {
      if (typeof key === "string") {
        this.store[key] = value;
        return;
      }
      this.store = { ...this.store, ...key };
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
  mcpConfigStore: {
    getEnabledServers: () => [],
  },
}));

import { SessionManager } from "../src/main/session/session-manager";

function makeDb(): DatabaseInstance {
  return {
    sessions: {
      create: vi.fn(),
      // id 感知：processQueue 会用 loadSession(id) 取"最新会话"，返回固定 id 会让
      // 新会话的消息被存到别人的 id 下（写这条测试时真踩了一次）。
      // 刻意**不给 cwd**：ensureSandboxInitialized 见到没有工作目录会直接跳过
      // （"No workspace directory, skipping sandbox init"），测试因此不需要沙盒。
      get: vi.fn((id: string) => ({
        id,
        title: "t",
        status: "idle",
        mounted_paths: "[]",
        allowed_tools: "[]",
        memory_enabled: 0,
      })),
      getAll: vi.fn(() => []),
      update: vi.fn(),
      delete: vi.fn(),
    },
    messages: {
      create: vi.fn(),
      getBySessionId: vi.fn(() => []),
      delete: vi.fn(),
      deleteBySessionId: vi.fn(),
    },
    traceSteps: {
      create: vi.fn(),
      update: vi.fn(),
      getBySessionId: vi.fn(() => []),
      deleteBySessionId: vi.fn(),
    },
  } as unknown as DatabaseInstance;
}

const refs = [
  {
    pageUrl: "http://fixture/",
    tag: "button",
    classes: ["primary"],
    text: "开始使用",
    selector: "button.primary",
    selectorUnique: true,
    width: 132,
    height: 40,
  },
];

describe("element refs on the host user message", () => {
  it("continueSession 把引用写进宿主 user 消息", async () => {
    const manager = new SessionManager(makeDb(), vi.fn());
    manager.setEntriesReader(() => []);

    await manager.continueSession(
      "s1",
      "改圆角",
      [{ type: "text", text: "改圆角" }],
      undefined,
      undefined,
      "t1",
      refs,
    );

    // 排队是异步的（既有做法见 tests/session-manager-queue-concurrency.test.ts）
    await vi.waitFor(() => {
      expect(
        manager.getMessages("s1").some((m) => m.elSelections?.length),
      ).toBe(true);
    });
    expect(
      manager.getMessages("s1").find((m) => m.role === "user")?.elSelections,
    ).toEqual(refs);
  });

  it("startSession 同样带上", async () => {
    const manager = new SessionManager(makeDb(), vi.fn());
    manager.setEntriesReader(() => []);

    const session = await manager.startSession(
      "t",
      "改圆角",
      undefined,
      undefined,
      [{ type: "text", text: "改圆角" }],
      undefined,
      undefined,
      undefined,
      undefined,
      "t2",
      refs,
    );

    await vi.waitFor(() => {
      expect(
        manager.getMessages(session.id).some((m) => m.elSelections?.length),
      ).toBe(true);
    });
    expect(
      manager.getMessages(session.id).find((m) => m.role === "user")
        ?.elSelections,
    ).toEqual(refs);
  });

  // 注意：这里直接传 undefined，等价于生产里 `elementRefsOf()` 在无选中时给出的事。
  // 真正的"空数组不得写进消息"由 main/index.ts 的 elementRefsOf 保证（它把 [] 折成 undefined）。
  it("不带引用时字段保持 undefined（不写空数组）", async () => {
    const manager = new SessionManager(makeDb(), vi.fn());
    manager.setEntriesReader(() => []);

    await manager.continueSession(
      "s1",
      "普通消息",
      [{ type: "text", text: "普通消息" }],
      undefined,
      undefined,
      "t3",
    );

    await vi.waitFor(() => {
      expect(manager.getMessages("s1").some((m) => m.role === "user")).toBe(
        true,
      );
    });
    expect(
      manager.getMessages("s1").find((m) => m.role === "user")?.elSelections,
    ).toBeUndefined();
  });
});
