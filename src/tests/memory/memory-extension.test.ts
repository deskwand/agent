import { describe, expect, it, vi } from "vitest";
import { MemoryExtension } from "../../main/memory/memory-extension";
import type { MemoryService } from "../../main/memory/memory-service";

function createSession() {
  return {
    id: "s1",
    title: "Test",
    status: "idle" as const,
    mountedPaths: [],
    allowedTools: [],
    memoryEnabled: true,
    isProjectMode: false,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("MemoryExtension", () => {
  it("returns policy and cwd-bound tools without reading saved memory", async () => {
    const getTools = vi.fn(() => []);
    const buildPromptPrefix = vi.fn();
    const memoryServiceMock = {
      isEnabled: () => true,
      getTools,
      buildPromptPrefix,
    } as unknown as MemoryService;
    const extension = new MemoryExtension(memoryServiceMock);
    const session = { ...createSession(), cwd: "/repo/a" };

    const result = await extension.beforeSessionRun!({
      session,
      prompt: "record a product video",
      existingMessages: [],
      isColdStart: true,
    });

    expect(result?.promptPrefix).toBeUndefined();
    expect(result?.systemPromptSuffix).toContain("<memory-policy>");
    expect(result?.systemPromptSuffix).toContain("No saved memory is loaded");
    expect(result?.systemPromptSuffix).toContain("memory-policy-v2");
    expect(result?.systemPromptSuffix).toContain("memory_upsert");
    expect(result?.systemPromptSuffix).toContain("memory_delete");
    expect(getTools).toHaveBeenCalledWith("/repo/a");
    expect(buildPromptPrefix).not.toHaveBeenCalled();
  });

  it("does not expose policy or tools when memory is disabled", async () => {
    const getTools = vi.fn(() => []);
    const memoryServiceMock = {
      isEnabled: () => false,
      getTools,
    } as unknown as MemoryService;
    const extension = new MemoryExtension(memoryServiceMock);

    const result = await extension.beforeSessionRun!({
      session: createSession(),
      prompt: "hello",
      existingMessages: [],
      isColdStart: true,
    });

    expect(result).toBeUndefined();
    expect(getTools).not.toHaveBeenCalled();
  });

  it("does not block session completion on pending memory ingestion", async () => {
    let resolveDeferred!: () => void;
    const deferred = new Promise<void>((resolve) => {
      resolveDeferred = resolve;
    });
    let enqueueCalls = 0;

    const memoryServiceMock = {
      isEnabled: () => true,
      enqueueIngestion: () => {
        enqueueCalls += 1;
        return deferred;
      },
      deleteSession: async () => {
        // no-op
      },
      buildPromptPrefix: async () => "",
    } as unknown as MemoryService;

    const extension = new MemoryExtension(memoryServiceMock);

    let settled = false;
    const afterRunPromise = extension
      .afterSessionRun({
        session: createSession(),
        prompt: "hello",
        messages: [],
      })
      .then(() => {
        settled = true;
      });

    await Promise.resolve();

    expect(enqueueCalls).toBe(1);
    expect(settled).toBe(true);

    resolveDeferred();
    await afterRunPromise;
  });

  it("does not throw when enqueueIngestion throws synchronously", async () => {
    const memoryServiceMock = {
      isEnabled: () => true,
      enqueueIngestion: () => {
        throw new Error("sync enqueue failure");
      },
      deleteSession: async () => {
        // no-op
      },
      buildPromptPrefix: async () => "",
    } as unknown as MemoryService;

    const extension = new MemoryExtension(memoryServiceMock);

    await expect(
      extension.afterSessionRun({
        session: createSession(),
        prompt: "hello",
        messages: [],
      }),
    ).resolves.toBeUndefined();
  });

  describe("teammate routing", () => {
    function mockService(enabled = true) {
      return {
        isEnabled: () => enabled,
        getTools: vi.fn(() => []),
        enqueueIngestion: vi.fn(async () => {}),
        deleteSession: vi.fn(async () => {}),
      };
    }
    function setup(agentId: string | null, globalEnabled = true) {
      const teammate = mockService();
      const global = mockService(globalEnabled);
      const getForAgent = vi.fn(() => teammate);
      const ext = new MemoryExtension(global as unknown as MemoryService, {
        registry: {
          getForAgent: getForAgent as unknown as () => MemoryService,
        },
        resolveAgentId: () => agentId,
      });
      return { teammate, global, getForAgent, ext };
    }
    const beforeCtx = (session: Record<string, unknown>) => ({
      session: session as never,
      prompt: "x",
      existingMessages: [],
      isColdStart: true,
    });

    it("routes agent sessions to the teammate service", async () => {
      const { teammate, global, ext } = setup("a1");
      await ext.beforeSessionRun!(
        beforeCtx({ ...createSession(), kind: "agent", cwd: "/w" }),
      );
      expect(teammate.getTools).toHaveBeenCalledWith("/w");
      expect(global.getTools).not.toHaveBeenCalled();
    });

    it("gives an orphaned agent session no memory at all", async () => {
      const { teammate, global, ext } = setup(null);
      const session = { ...createSession(), kind: "agent" as const };
      expect(await ext.beforeSessionRun!(beforeCtx(session))).toBeUndefined();
      await ext.afterSessionRun({ session, prompt: "x", messages: [] });
      expect(teammate.enqueueIngestion).not.toHaveBeenCalled();
      expect(global.enqueueIngestion).not.toHaveBeenCalled();
    });

    it("enables teammate memory even when session.memoryEnabled is false", async () => {
      const { teammate, ext } = setup("a1");
      const session = {
        ...createSession(),
        kind: "agent" as const,
        memoryEnabled: false,
      };
      const result = await ext.beforeSessionRun!(beforeCtx(session));
      expect(result?.customTools).toBeDefined();
      await ext.afterSessionRun({ session, prompt: "x", messages: [] });
      expect(teammate.enqueueIngestion).toHaveBeenCalledTimes(1);
      const arg = (
        teammate.enqueueIngestion.mock.calls as unknown as Array<
          [{ session: { memoryEnabled: boolean } }]
        >
      )[0][0];
      expect(arg.session.memoryEnabled).toBe(true);
    });

    it("disables teammate memory when the global switch is off", async () => {
      const { teammate, ext } = setup("a1", false);
      const session = { ...createSession(), kind: "agent" as const };
      expect(await ext.beforeSessionRun!(beforeCtx(session))).toBeUndefined();
      await ext.afterSessionRun({ session, prompt: "x", messages: [] });
      expect(teammate.enqueueIngestion).not.toHaveBeenCalled();
    });

    it("keeps ordinary sessions on the global service", async () => {
      const { global, getForAgent, ext } = setup("a1");
      await ext.beforeSessionRun!(
        beforeCtx({ ...createSession(), kind: "ordinary" }),
      );
      expect(global.getTools).toHaveBeenCalled();
      expect(getForAgent).not.toHaveBeenCalled();
    });
  });
});

describe("MemoryExtension · project bot routing", () => {
  function fakeService(label: string) {
    return {
      label,
      isEnabled: () => true,
      getTools: vi.fn(() => []),
      enqueueIngestion: vi.fn(async () => undefined),
      deleteSession: vi.fn(async () => undefined),
    };
  }

  function agentSession() {
    return {
      ...createSession(),
      id: "s-agent-1",
      kind: "agent" as const,
      memoryEnabled: false,
      isProjectMode: true,
      cwd: "/repo/proj",
    };
  }

  function run(
    global: ReturnType<typeof fakeService>,
    teammate: ReturnType<typeof fakeService>,
    isProject: boolean,
  ) {
    const extension = new MemoryExtension(global as unknown as MemoryService, {
      registry: { getForAgent: () => teammate as unknown as MemoryService },
      resolveAgentId: () => "agent-1",
      isProjectAgent: () => isProject,
    });
    return extension.beforeSessionRun!({
      session: agentSession(),
      prompt: "x",
      existingMessages: [],
      isColdStart: true,
    });
  }

  it("routes a project bot to the global service", async () => {
    const global = fakeService("global");
    const teammate = fakeService("teammate");
    const result = await run(global, teammate, true);
    expect(result?.systemPromptSuffix).toContain("<memory-policy>");
    expect(global.getTools).toHaveBeenCalledWith("/repo/proj");
    expect(teammate.getTools).not.toHaveBeenCalled();
  });

  it("keeps routing private partners to the teammate registry", async () => {
    const global = fakeService("global");
    const teammate = fakeService("teammate");
    await run(global, teammate, false);
    expect(teammate.getTools).toHaveBeenCalledWith("/repo/proj");
    expect(global.getTools).not.toHaveBeenCalled();
  });
});
