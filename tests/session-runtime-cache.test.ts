import { describe, expect, it, vi } from "vitest";
import { getOrCreateSessionRuntime } from "../src/main/agent/session-runtime-cache";

describe("getOrCreateSessionRuntime", () => {
  it("reuses the same instance for the same sessionId", async () => {
    const cache = new Map<string, { id: string }>();
    const create = vi.fn(async () => ({ id: "runtime-a" }));

    const first = await getOrCreateSessionRuntime(cache, "s1", create);
    const second = await getOrCreateSessionRuntime(cache, "s1", create);

    expect(first).toBe(second);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("creates a separate instance per sessionId (credential isolation)", async () => {
    const cache = new Map<string, { id: string }>();
    const runtimes = [{ id: "r1" }, { id: "r2" }];
    let index = 0;
    const create = vi.fn(async () => runtimes[index++]);

    const a = await getOrCreateSessionRuntime(cache, "s1", create);
    const b = await getOrCreateSessionRuntime(cache, "s2", create);

    expect(a).not.toBe(b);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("does not cache failed creations so the next call retries", async () => {
    const cache = new Map<string, { id: string }>();
    const create = vi
      .fn<() => Promise<{ id: string }>>()
      .mockRejectedValueOnce(new Error("create failed"))
      .mockResolvedValueOnce({ id: "r1" });

    await expect(
      getOrCreateSessionRuntime(cache, "s1", create),
    ).rejects.toThrow("create failed");
    const runtime = await getOrCreateSessionRuntime(cache, "s1", create);

    expect(runtime).toEqual({ id: "r1" });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("delete from the cache forces a fresh instance on next access", async () => {
    const cache = new Map<string, { id: string }>();
    let counter = 0;
    const create = vi.fn(async () => ({ id: `r${++counter}` }));

    const first = await getOrCreateSessionRuntime(cache, "s1", create);
    cache.delete("s1");
    const second = await getOrCreateSessionRuntime(cache, "s1", create);

    expect(first).not.toBe(second);
    expect(create).toHaveBeenCalledTimes(2);
  });
});
