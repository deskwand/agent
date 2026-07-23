import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockConfigState = vi.hoisted(() => ({
  config: {
    provider: "openrouter",
    apiKey: "",
    baseUrl: "https://openrouter.ai/api/v1",
    customProtocol: "anthropic",
    model: "anthropic/claude-sonnet-4-6",
    activeProfileKey: "openrouter",
    activeProviderKey: "openrouter",
    profiles: {},
    providers: {},
    deskWandCodePath: "",
    defaultWorkdir: "",
    enableDevLogs: false,
    theme: "light",
    sandboxEnabled: false,
    memoryEnabled: true,
    memoryRuntime: {
      llm: {
        inheritFromActive: true,
        apiKey: "",
        baseUrl: "",
        model: "",
        timeoutMs: 180000,
      },
      embedding: {
        inheritFromActive: true,
        apiKey: "",
        baseUrl: "",
        model: "text-embedding-3-small",
        timeoutMs: 180000,
      },
      useEmbedding: false,
      maxNavSteps: 2,
      ingestionConcurrency: 2,
      storageRoot: "",
    },
    enableThinking: false,
    isConfigured: true,
  } as Record<string, unknown>,
}));

vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    getPath: () => "/tmp",
    getVersion: () => "0.0.0-test",
    getAppPath: () => "/tmp/deskwand-test-app",
  },
}));

vi.mock("../../main/config/config-store", () => {
  const configStore = {
    getAll: () => ({ ...mockConfigState.config }),
    get: (key: string) => mockConfigState.config[key],
    update: (updates: Record<string, unknown>) => {
      mockConfigState.config = { ...mockConfigState.config, ...updates };
    },
    set: (key: string, value: unknown) => {
      mockConfigState.config = { ...mockConfigState.config, [key]: value };
    },
  };
  return {
    configStore,
    PROVIDER_PRESETS: {},
  };
});

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  DatabaseInstance,
  MessageRow,
  SessionRow,
} from "../../main/db/database";
import type {
  MemoryCompletionRequest,
  MemoryLLMClientLike,
} from "../../main/memory/memory-llm-client";
import { MemoryService } from "../../main/memory/memory-service";
import { configStore } from "../../main/config/config-store";

class SmokeMemoryLLM implements MemoryLLMClientLike {
  async complete(request: MemoryCompletionRequest): Promise<{ text: string }> {
    if (request.systemPrompt.includes("Memory Profiler")) {
      return {
        text: JSON.stringify({
          actions: request.userPrompt.includes("中文")
            ? [
                {
                  op: "upsert",
                  category: "preferences",
                  key: "response_language",
                  value: "中文",
                },
              ]
            : [],
        }),
      };
    }

    if (
      request.systemPrompt.includes("experience memory extraction system") ||
      request.systemPrompt.includes("memory extraction system")
    ) {
      const isWorkspaceA = request.userPrompt.includes("workspace A");
      return {
        text: JSON.stringify({
          session_summary: isWorkspaceA
            ? "workspace A 的 gateway token rotation 经验"
            : "workspace B 的其他经验",
          session_keywords: isWorkspaceA ? ["gateway", "rotation"] : ["other"],
          chunks: [
            {
              summary: isWorkspaceA
                ? "workspace A 中关于 gateway token rotation 的结论"
                : "workspace B 中不相关的总结",
              details: isWorkspaceA
                ? "在 workspace A 中完成 gateway token rotation，并保留后续整理说明。"
                : "这条记录属于另一个 workspace。",
              keywords: isWorkspaceA ? ["gateway", "rotation"] : ["other"],
              source_turns: [1, 2, 3, 4],
            },
          ],
        }),
      };
    }

    if (request.systemPrompt.includes("memory retrieval navigator")) {
      return {
        text: JSON.stringify({
          sufficient: true,
          reason: "summaries_are_enough",
          actions: [],
        }),
      };
    }

    return { text: "{}" };
  }

  async embed(): Promise<number[]> {
    return [];
  }
}

function createSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      deskwand_session_id TEXT,
      openai_thread_id TEXT,
      status TEXT NOT NULL,
      cwd TEXT,
      mounted_paths TEXT NOT NULL DEFAULT '[]',
      allowed_tools TEXT NOT NULL DEFAULT '[]',
      memory_enabled INTEGER NOT NULL DEFAULT 1,
      model TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      token_usage TEXT,
      execution_time_ms INTEGER
    );
  `);
}

function createDatabaseInstance(db: DatabaseSync): DatabaseInstance {
  return {
    raw: db,
    sessions: {
      create: vi.fn(),
      update: vi.fn(),
      get: vi.fn(
        (id: string) =>
          db.prepare("SELECT * FROM sessions WHERE id = ? LIMIT 1").get(id) as
            | SessionRow
            | undefined,
      ),
      getAll: vi.fn(
        () =>
          db
            .prepare("SELECT * FROM sessions ORDER BY created_at ASC")
            .all() as unknown as SessionRow[],
      ),
      delete: vi.fn(),
    },
    messages: {
      create: vi.fn(),
      update: vi.fn(),
      getBySessionId: vi.fn(
        (sessionId: string) =>
          db
            .prepare(
              "SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp ASC",
            )
            .all(sessionId) as unknown as MessageRow[],
      ),
      delete: vi.fn(),
      deleteBySessionId: vi.fn(),
    },
    traceSteps: {
      create: vi.fn(),
      update: vi.fn(),
      getBySessionId: vi.fn(() => []),
      deleteBySessionId: vi.fn(),
    },
    scheduledTasks: {
      create: vi.fn(),
      update: vi.fn(),
      get: vi.fn(),
      getAll: vi.fn(() => []),
      delete: vi.fn(),
    },
    goals: {
      upsert: vi.fn(),
      get: vi.fn(),
      getAll: vi.fn(() => []),
      delete: vi.fn(),
    },
    prepare: (sql: string) => db.prepare(sql),
    exec: (sql: string) => db.exec(sql),
    close: () => db.close(),
  };
}

function makeMessages(
  sessionId: string,
  items: Array<{ role: "user" | "assistant"; text: string; timestamp: number }>,
) {
  return items.map((item, index) => ({
    id: `${sessionId}-${index}`,
    sessionId,
    role: item.role,
    content: [{ type: "text" as const, text: item.text }],
    timestamp: item.timestamp,
  }));
}

describe("memory smoke harness", () => {
  let rawDb: DatabaseSync;
  let service: MemoryService;
  let storageRoot: string;

  beforeEach(() => {
    storageRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "deskwand-memory-smoke-"),
    );
    rawDb = new DatabaseSync(":memory:");
    createSchema(rawDb);
    service = new MemoryService(createDatabaseInstance(rawDb), {
      llmClient: new SmokeMemoryLLM(),
    });
    configStore.update({
      memoryEnabled: true,
      memoryRuntime: {
        llm: {
          inheritFromActive: true,
          apiKey: "",
          baseUrl: "",
          model: "",
          timeoutMs: 180000,
        },
        embedding: {
          inheritFromActive: true,
          apiKey: "",
          baseUrl: "",
          model: "text-embedding-3-small",
          timeoutMs: 180000,
        },
        useEmbedding: false,
        maxNavSteps: 2,
        ingestionConcurrency: 2,
        storageRoot: path.join(storageRoot, "memory-root"),
      },
    });
  });

  afterEach(() => {
    rawDb.close();
    fs.rmSync(storageRoot, { recursive: true, force: true });
  });

  it("supports explicit writes and ten-turn selective background learning", async () => {
    const session = {
      id: "selective-review",
      title: "Selective review",
      status: "idle" as const,
      cwd: "/repo/workspace-a",
      mountedPaths: [],
      allowedTools: [],
      memoryEnabled: true,
      isProjectMode: true,
      createdAt: 1000,
      updatedAt: 1000,
    };
    const messages = makeMessages(
      session.id,
      Array.from({ length: 10 }, (_, index) => [
        {
          role: "user" as const,
          text: index === 0 ? "请用中文回答。" : `user-${index + 1}`,
          timestamp: index * 2 + 1,
        },
        {
          role: "assistant" as const,
          text: `assistant-${index + 1}`,
          timestamp: index * 2 + 2,
        },
      ]).flat(),
    );

    await service.upsertCoreMemory(
      "preferences",
      "response_style",
      "回答保持简洁",
    );
    await service.enqueueIngestion({
      session,
      prompt: "turn 9",
      messages: messages.slice(0, 18),
    });
    expect(service.getOverview().coreCount).toBe(1);

    await service.enqueueIngestion({
      session,
      prompt: "turn 10",
      messages,
    });

    const overview = service.getOverview(session.cwd);
    expect(overview.coreCount).toBe(2);
    expect(overview.experienceSessionCount).toBe(0);
    expect(overview.experienceChunkCount).toBe(0);
    expect(
      service.search({ query: "中文", scope: "global", limit: 5 }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "core",
          title: "preferences.response_language",
        }),
      ]),
    );
  });

  it("exposes read and explicit write tools together", () => {
    expect(
      service.getTools("/repo/workspace-a").map((tool) => tool.name),
    ).toEqual([
      "memory_search",
      "memory_read",
      "memory_upsert",
      "memory_delete",
    ]);
  });
});
