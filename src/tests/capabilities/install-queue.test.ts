import { describe, expect, it, vi } from "vitest";
import { createInstallQueue } from "../../renderer/capabilities/install-queue";

/** 可控的 run：返回一个由测试决定何时结束的 promise。 */
function defer() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("串行安装队列", () => {
  it("同一时刻只有一个在跑，第二个要等第一个结束", async () => {
    const queue = createInstallQueue();
    const first = defer();
    const second = vi.fn(async () => {});

    const a = queue.enqueue("voiceInput", () => first.promise);
    const b = queue.enqueue("voice", second);

    await Promise.resolve();
    expect(queue.running()).toBe("voiceInput");
    expect(second).not.toHaveBeenCalled();
    expect(queue.position("voice")).toBe(1);

    first.resolve();
    await Promise.all([a, b]);
    expect(second).toHaveBeenCalledTimes(1);
    expect(queue.running()).toBeNull();
    expect(queue.position("voice")).toBeNull();
  });

  it("顺序是 FIFO", async () => {
    const queue = createInstallQueue();
    const order: string[] = [];
    await Promise.all([
      queue.enqueue("a", async () => {
        order.push("a");
      }),
      queue.enqueue("b", async () => {
        order.push("b");
      }),
      queue.enqueue("c", async () => {
        order.push("c");
      }),
    ]);
    expect(order).toEqual(["a", "b", "c"]);
  });

  it("失败不卡队列：第一个 reject，第二个照常跑", async () => {
    const queue = createInstallQueue();
    const second = vi.fn(async () => {});
    const failed = queue.enqueue("a", async () => {
      throw new Error("network");
    });
    const ok = queue.enqueue("b", second);

    await expect(failed).rejects.toThrow("network");
    await ok;
    expect(second).toHaveBeenCalledTimes(1);
    expect(queue.running()).toBeNull();
  });

  it("订阅在入队 / 开始 / 结束时都会被叫到", async () => {
    const queue = createInstallQueue();
    const listener = vi.fn();
    const unsubscribe = queue.subscribe(listener);
    await queue.enqueue("a", async () => {});
    expect(listener.mock.calls.length).toBeGreaterThanOrEqual(3);
    unsubscribe();
  });
});
