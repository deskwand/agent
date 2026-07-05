import { describe, expect, it } from "vitest";
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
});
