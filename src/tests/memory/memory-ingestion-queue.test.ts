import { describe, expect, it, vi } from "vitest";
import { MemoryIngestionQueue } from "../../main/memory/memory-ingestion-queue";

describe("MemoryIngestionQueue", () => {
  it("serializes tasks sharing a key and preserves their results", async () => {
    const queue = new MemoryIngestionQueue();
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = queue.enqueue("global-memory-write", async () => {
      events.push("first:start");
      await firstGate;
      events.push("first:end");
      return 1;
    });
    const second = queue.enqueue("global-memory-write", async () => {
      events.push("second:start");
      events.push("second:end");
      return 2;
    });

    await vi.waitFor(() => expect(events).toEqual(["first:start"]));

    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
    expect(events).toEqual([
      "first:start",
      "first:end",
      "second:start",
      "second:end",
    ]);
  });

  it("continues the chain after a rejected task", async () => {
    const queue = new MemoryIngestionQueue();
    const first = queue.enqueue("global-memory-write", async () => {
      throw new Error("failed write");
    });
    const second = queue.enqueue("global-memory-write", async () => "saved");

    await expect(first).rejects.toThrow("failed write");
    await expect(second).resolves.toBe("saved");
  });
});
