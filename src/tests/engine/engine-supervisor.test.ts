import { EventEmitter } from "node:events";
import type { spawn } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEngineSupervisor } from "../../main/engine/engine-supervisor";

/** spawn 的替身：能 emit exit，能记下 kill。 */
class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killed = false;
  kill(): boolean {
    this.killed = true;
    this.emit("exit", 0);
    return true;
  }
  crash(code = 1): void {
    this.emit("exit", code);
  }
  /** spawn 失败：Node 只发 error，不发 exit。 */
  failToStart(message: string): void {
    this.emit("error", new Error(message));
  }
}

function setup() {
  const children: FakeChild[] = [];
  const calls: string[][] = [];
  const spawnFn = ((_bin: string, args: string[]) => {
    const child = new FakeChild();
    children.push(child);
    calls.push(args);
    return child;
  }) as unknown as typeof spawn;
  const sup = createEngineSupervisor({
    paths: {
      bin: "/tmp/bin/tts-server",
      talker: "/tmp/models/a.gguf",
      tokenizer: "/tmp/models/b.gguf",
    },
    spawn: spawnFn,
    fetch: vi.fn(async () => new Response("ok", { status: 200 })),
    log: () => {},
    logError: () => {},
  });
  return { sup, children, calls };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("engine supervisor", () => {
  it("ensureReady：取空闲端口 → spawn → 健康检查通过；并发只起一次", async () => {
    const { sup, calls } = setup();
    const [a, b] = await Promise.all([sup.ensureReady(), sup.ensureReady()]);

    expect(a).toMatchObject({ ok: true });
    expect(b).toMatchObject({ ok: true });
    const port = (a as { port: number }).port;
    expect(port).toBeGreaterThan(0);
    expect(sup.status()).toBe("ready");
    expect(sup.port()).toBe(port);
    expect(calls).toHaveLength(1);
    // 只监听回环 + 走 chinese 默认语言
    expect(calls[0]).toContain("--host");
    expect(calls[0][calls[0].indexOf("--host") + 1]).toBe("127.0.0.1");
    expect(calls[0]).toContain("--model");
    expect(calls[0]).toContain("--codec");
  });

  it("spawn 失败立刻返回失败，不等满 180 秒（也不留未捕获异常）", async () => {
    // 不用假计时器：要证明的是"几十毫秒内回来"，而不是"推进 180 秒之后"。
    const children: FakeChild[] = [];
    const sup = createEngineSupervisor({
      paths: { bin: "/nope/tts-server", talker: "t", tokenizer: "k" },
      spawn: (() => {
        const child = new FakeChild();
        children.push(child);
        // Node 的行为：ENOENT 只 emit error，不发 exit
        queueMicrotask(() =>
          child.failToStart("spawn /nope/tts-server ENOENT"),
        );
        return child;
      }) as unknown as typeof spawn,
      // 二进制不在 → 没有人监听 → fetch 必然失败（替身也跟着失败，才像真的）
      fetch: vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
      log: () => {},
      logError: () => {},
    });

    const started = Date.now();
    const result = await sup.ensureReady();
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toContain("ENOENT");
    expect(sup.status()).toBe("stopped");
  });

  it("健康检查一直不通 → 超时、置 failed", async () => {
    vi.useFakeTimers();
    const { sup } = setup();
    const bad = createEngineSupervisor({
      paths: { bin: "b", talker: "t", tokenizer: "k" },
      spawn: (() => new FakeChild()) as unknown as typeof spawn,
      fetch: vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
      log: () => {},
      logError: () => {},
    });
    expect(sup.status()).toBe("stopped");

    const pending = bad.ensureReady();
    await vi.advanceTimersByTimeAsync(180_000);
    const result = await pending;
    expect(result.ok).toBe(false);
    expect(bad.status()).toBe("failed");
    // failed 之后不再重试
    expect((await bad.ensureReady()).ok).toBe(false);
  });

  it("崩溃后退避窗口内不重启，窗口过了重新起", async () => {
    vi.useFakeTimers();
    const { sup, children, calls } = setup();
    await sup.ensureReady();
    children[0].crash();
    expect(sup.status()).toBe("stopped");

    // 1 秒退避窗口内：不起新进程
    const early = await sup.ensureReady();
    expect(early.ok).toBe(false);
    expect(calls).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1_000);
    const again = await sup.ensureReady();
    expect(again.ok).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it("连续崩三次 → failed 且不再自动重启", async () => {
    vi.useFakeTimers();
    const { sup, children, calls } = setup();

    for (const backoff of [0, 1_000, 5_000]) {
      if (backoff) await vi.advanceTimersByTimeAsync(backoff);
      expect((await sup.ensureReady()).ok).toBe(true);
      children.at(-1)!.crash();
    }

    expect(sup.status()).toBe("failed");
    await vi.advanceTimersByTimeAsync(60_000);
    expect((await sup.ensureReady()).ok).toBe(false);
    expect(calls).toHaveLength(3);
  });

  it("空闲 10 分钟回收进程", async () => {
    vi.useFakeTimers();
    const { sup, children } = setup();
    await sup.ensureReady();

    await vi.advanceTimersByTimeAsync(9 * 60 * 1000);
    expect(children[0].killed).toBe(false); // 还不到点

    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
    expect(children[0].killed).toBe(true);
    expect(sup.status()).toBe("stopped");
    expect(sup.port()).toBeNull();

    // 说话又来了：重新起
    expect((await sup.ensureReady()).ok).toBe(true);
    expect(children).toHaveLength(2);
  });

  it("touch 会推迟回收；stop 幂等", async () => {
    vi.useFakeTimers();
    const { sup, children } = setup();
    await sup.ensureReady();

    await vi.advanceTimersByTimeAsync(9 * 60 * 1000);
    sup.touch();
    await vi.advanceTimersByTimeAsync(9 * 60 * 1000);
    expect(children[0].killed).toBe(false);

    sup.stop();
    expect(children[0].killed).toBe(true);
    expect(() => sup.stop()).not.toThrow();
    expect(sup.status()).toBe("stopped");
  });

  it("reset 清掉 failed，允许重试", async () => {
    vi.useFakeTimers();
    const { sup, children } = setup();
    for (const backoff of [0, 1_000, 5_000]) {
      if (backoff) await vi.advanceTimersByTimeAsync(backoff);
      await sup.ensureReady();
      children.at(-1)!.crash();
    }
    expect(sup.status()).toBe("failed");

    sup.reset();
    expect(sup.status()).toBe("stopped");
    expect((await sup.ensureReady()).ok).toBe(true);
  });
});
