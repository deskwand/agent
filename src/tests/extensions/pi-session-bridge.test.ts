import { describe, it, expect, vi } from "vitest";
import { PiSessionBridge } from "../../main/extensions/pi-session-bridge";

describe("PiSessionBridge", () => {
  it("waitForIdle delegates to the agent session", async () => {
    const waitForIdle = vi.fn().mockResolvedValue(undefined);
    const bridge = new PiSessionBridge(
      { waitForIdle } as never,
      { onSessionShutdownCleanup: () => {} },
      "/tmp/proj",
    );
    await bridge.buildCommandContextActions().waitForIdle();
    expect(waitForIdle).toHaveBeenCalledTimes(1);
  });

  it("reload delegates to the agent session", async () => {
    const reload = vi.fn().mockResolvedValue(undefined);
    const bridge = new PiSessionBridge(
      { reload } as never,
      { onSessionShutdownCleanup: () => {} },
      "/tmp/proj",
    );
    await bridge.buildCommandContextActions().reload();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("unimplemented session actions report cancelled", async () => {
    const bridge = new PiSessionBridge(
      {} as never,
      { onSessionShutdownCleanup: () => {} },
      "/tmp/proj",
    );
    const actions = bridge.buildCommandContextActions();
    expect((await actions.newSession()).cancelled).toBe(true);
    expect((await actions.fork("entry-1")).cancelled).toBe(true);
    expect((await actions.navigateTree("entry-1")).cancelled).toBe(true);
    expect((await actions.switchSession("/tmp/x.jsonl")).cancelled).toBe(true);
  });
});

describe("PiSessionBridge newSession", () => {
  it("creates a deskwand session and runs withSession", async () => {
    const createSession = vi.fn().mockResolvedValue({
      piSessionManager: { appendMessage: vi.fn() },
      replacedContext: { sendUserMessage: vi.fn(), ui: { setEditorText: () => {} } },
    });
    const bridge = new PiSessionBridge(
      {} as never,
      { createDeskWandSession: createSession } as never,
      "/tmp/proj",
    );
    const withSession = vi.fn();
    const result = await bridge
      .buildCommandContextActions()
      .newSession({ withSession });
    expect(result.cancelled).toBe(false);
    expect(createSession).toHaveBeenCalledWith({
      cwd: "/tmp/proj",
      title: "Extension session",
    });
    expect(withSession).toHaveBeenCalledTimes(1);
  });

  it("runs setup against the new pi session manager", async () => {
    const setup = vi.fn();
    const bridge = new PiSessionBridge(
      {} as never,
      {
        createDeskWandSession: async () => ({
          piSessionManager: { marker: "pm" },
          replacedContext: { sendUserMessage: vi.fn(), ui: { setEditorText: () => {} } },
        }),
      } as never,
      "/tmp/proj",
    );
    const result = await bridge.buildCommandContextActions().newSession({ setup });
    expect(result.cancelled).toBe(false);
    expect(setup).toHaveBeenCalledTimes(1);
  });

  it("reports cancelled when no session factory is available", async () => {
    const bridge = new PiSessionBridge(
      {} as never,
      { onSessionShutdownCleanup: () => {} },
      "/tmp/proj",
    );
    const result = await bridge.buildCommandContextActions().newSession();
    expect(result.cancelled).toBe(true);
  });
});

describe("PiSessionBridge fork", () => {
  it("forks from a user message entry and materializes branch messages", async () => {
    // 真实 Pi session 文件：创建 → 写入消息 → open
    const { SessionManager: PiSessionManager } = await import("@earendil-works/pi-coding-agent");
    const base = (await import("node:fs")).mkdtempSync(
      (await import("node:os")).tmpdir() + "/pi-fork-",
    );
    const sessionDir = base + "/sessions";
    (await import("node:fs")).mkdirSync(sessionDir, { recursive: true });
    const pm = PiSessionManager.create(base + "/proj", sessionDir);
    pm.appendMessage({
      role: "user",
      content: [{ type: "text", text: "first question" }],
      timestamp: Date.now(),
    });
    pm.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "first answer" }],
      timestamp: Date.now(),
    } as never);
    pm.appendMessage({
      role: "user",
      content: [{ type: "text", text: "second question" }],
      timestamp: Date.now(),
    });
    const sessionFile = pm.getSessionFile() as string;

    // 找到第二条 user 消息的 entry id
    const branch = pm.getBranch();
    const targetEntry = branch.find(
      (e) =>
        e.type === "message" &&
        e.message.role === "user" &&
        (e.message.content as Array<{ text?: string }>)[0]?.text === "second question",
    ) as { id: string };

    const materialized: unknown[] = [];
    const bridge = new PiSessionBridge(
      {
        sessionManager: pm,
        sessionFile,
      } as never,
      {
        createDeskWandSession: async ({
          piSessionFile,
        }: {
          piSessionFile?: string;
        }) => {
          const forked = PiSessionManager.open(piSessionFile as string, sessionDir);
          return {
            sessionId: "fork-session-1",
            piSessionManager: forked,
            replacedContext: { sendUserMessage: () => Promise.resolve(), ui: { setEditorText: () => {} } },
          };
        },
        materializeMessages: async (
          _sid: string,
          entries: unknown[],
        ) => {
          materialized.push(...entries);
        },
      } as never,
      base + "/proj",
    );

    const result = await bridge
      .buildCommandContextActions()
      .fork(targetEntry.id, { position: "before" });

    expect(result.cancelled).toBe(false);
    expect((result as { selectedText?: string }).selectedText).toBe(
      "second question",
    );
    // 物化消息包含 fork 点之前的历史
    expect(materialized.length).toBeGreaterThanOrEqual(2);
  });

  it("rejects before-position fork on assistant message", async () => {
    const { SessionManager: PiSessionManager } = await import("@earendil-works/pi-coding-agent");
    const base = (await import("node:fs")).mkdtempSync(
      (await import("node:os")).tmpdir() + "/pi-fork2-",
    );
    const sessionDir = base + "/sessions";
    (await import("node:fs")).mkdirSync(sessionDir, { recursive: true });
    const pm = PiSessionManager.create(base + "/proj", sessionDir);
    pm.appendMessage({
      role: "user",
      content: [{ type: "text", text: "q" }],
      timestamp: Date.now(),
    });
    pm.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "a" }],
      timestamp: Date.now(),
    } as never);
    const branch = pm.getBranch();
    const assistantEntry = branch.find(
      (e) => e.type === "message" && e.message.role === "assistant",
    ) as { id: string };

    const bridge = new PiSessionBridge(
      {
        sessionManager: pm,
        sessionFile: pm.getSessionFile(),
      } as never,
      {
        createDeskWandSession: async () => ({
          sessionId: "x",
          piSessionManager: pm,
          replacedContext: { sendUserMessage: () => Promise.resolve(), ui: { setEditorText: () => {} } },
        }),
      } as never,
      base + "/proj",
    );
    const result = await bridge
      .buildCommandContextActions()
      .fork(assistantEntry.id, { position: "before" });
    expect(result.cancelled).toBe(true);
  });
});

describe("PiSessionBridge switchSession", () => {
  it("activates an existing deskwand session by pi file", async () => {
    const activated: string[] = [];
    const bridge = new PiSessionBridge(
      {} as never,
      {
        createDeskWandSession: async () => ({
          sessionId: "new-id",
          piSessionManager: {} as never,
          replacedContext: { sendUserMessage: () => Promise.resolve(), ui: { setEditorText: () => {} } },
        }),
        findDeskWandSessionByPiFile: () => "existing-id",
        activateSession: (id: string) => activated.push(id),
      } as never,
      "/tmp/proj",
    );
    const result = await bridge
      .buildCommandContextActions()
      .switchSession("/tmp/session.jsonl");
    expect(result.cancelled).toBe(false);
    expect(activated).toEqual(["existing-id"]);
  });

  it("creates and activates a new session when no association exists", async () => {
    const { SessionManager: PiSessionManager } = await import(
      "@earendil-works/pi-coding-agent"
    );
    const base = (await import("node:fs")).mkdtempSync(
      (await import("node:os")).tmpdir() + "/pi-switch-",
    );
    const sessionDir = base + "/sessions";
    (await import("node:fs")).mkdirSync(sessionDir, { recursive: true });
    const pm = PiSessionManager.create(base + "/proj", sessionDir);
    pm.appendMessage({
      role: "user",
      content: [{ type: "text", text: "hello" }],
      timestamp: Date.now(),
    });
    const sessionFile = pm.getSessionFile() as string;
    // SDK 惰性写盘：手动创建文件模拟已存在的会话 JSONL
    (await import("node:fs")).writeFileSync(sessionFile, "");

    const activated: string[] = [];
    const created: string[] = [];
    const bridge = new PiSessionBridge(
      {} as never,
      {
        createDeskWandSession: async () => {
          created.push("create-called");
          return {
            sessionId: "new-id",
            piSessionManager: pm,
            replacedContext: {
              sendUserMessage: () => Promise.resolve(),
              ui: { setEditorText: () => {} },
            },
          };
        },
        findDeskWandSessionByPiFile: () => null,
        activateSession: (id: string) => activated.push(id),
        materializeMessages: async () => {},
      } as never,
      base + "/proj",
    );
    const result = await bridge
      .buildCommandContextActions()
      .switchSession(sessionFile);
    expect(result.cancelled).toBe(false);
    expect(created).toEqual(["create-called"]);
    expect(activated).toEqual(["new-id"]);
  });

  it("reports cancelled when target pi file does not exist", async () => {
    const bridge = new PiSessionBridge(
      {} as never,
      {
        createDeskWandSession: async () => ({
          sessionId: "x",
          piSessionManager: {} as never,
          replacedContext: {
            sendUserMessage: () => Promise.resolve(),
            ui: { setEditorText: () => {} },
          },
        }),
        findDeskWandSessionByPiFile: () => null,
      } as never,
      "/tmp/proj",
    );
    const result = await bridge
      .buildCommandContextActions()
      .switchSession("/tmp/does-not-exist.jsonl");
    expect(result.cancelled).toBe(true);
  });
});

describe("PiSessionBridge newSession setup materialization", () => {
  it("materializes setup entries into the deskwand session", async () => {
    const materialized: unknown[] = [];
    const bridge = new PiSessionBridge(
      {} as never,
      {
        createDeskWandSession: async () => ({
          sessionId: "sid-1",
          piSessionManager: {
            getBranch: () => [{ type: "message", message: { role: "user" } }],
          },
          replacedContext: {
            sendUserMessage: () => Promise.resolve(),
            ui: { setEditorText: () => {} },
          },
        }),
        materializeMessages: async (
          _sid: string,
          entries: unknown[],
        ) => {
          materialized.push(...entries);
        },
      } as never,
      "/tmp/proj",
    );
    const setup = vi.fn();
    const result = await bridge
      .buildCommandContextActions()
      .newSession({ setup });
    expect(result.cancelled).toBe(false);
    expect(setup).toHaveBeenCalledTimes(1);
    // setup 后 entries 被物化（不会写入孤儿 Pi 文件）
    expect(materialized).toHaveLength(1);
  });
});
