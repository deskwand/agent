// waitForOrderConfirmation 的取消语义（Task 2 fix round 1）。
//
// 为什么需要：TopUpModal 关闭后，原实现里旧订单的轮询会继续跑到 confirmed/expired/10min
// timeout（review round1 的 PROBE-1 实测：关闭后 15s 内又多 3 次 getTopUpOrder），
// 而迟到的 createOrder / QRCode / getMe 也会写回首屏会话（PROBE-2）。
// 修复走「renderer 侧 AbortSignal + generation」两条腿，本文件只测**等待器**这一条腿：
//   - 预取消 / poll 挂起中取消 / sleep 中取消 / 网络错误 backoff 中取消
//   - 取消时不留 timer（sleep 会 clearTimeout + removeEventListener）
//   - 正常 pending → confirmed / expired / timeout 行为不变（返回值不变，不把订单假称 expired）
//
// 这个文件不 mock 任何东西：被测对象是纯函数，用假定时器观察真实的 timer 数。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  POLL_INTERVAL_MS,
  waitForOrderConfirmation,
  type TopUpOrderStatus,
} from "../../renderer/utils/topup";

/** 等待器内部在 poll 之后 sleep(intervalMs)；测试里把 interval 压小以少推进时间。 */
const INTERVAL = 50;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("waitForOrderConfirmation 的取消", () => {
  it("预取消：signal 已 aborted 时不发任何 poll，直接 cancelled", async () => {
    const poll = vi.fn(async (): Promise<TopUpOrderStatus> => "pending");
    const controller = new AbortController();
    controller.abort();

    const result = await waitForOrderConfirmation(poll, "order-1", {
      intervalMs: INTERVAL,
      signal: controller.signal,
    });

    expect(result).toBe("cancelled");
    expect(poll).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("poll 挂起中取消：迟到结果被丢弃、不再有下一次 poll、无残留 timer", async () => {
    let resolvePoll!: (status: TopUpOrderStatus) => void;
    const poll = vi.fn(
      () =>
        new Promise<TopUpOrderStatus>((resolve) => {
          resolvePoll = resolve;
        }),
    );
    const controller = new AbortController();
    const promise = waitForOrderConfirmation(poll, "order-1", {
      intervalMs: INTERVAL,
      signal: controller.signal,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(poll).toHaveBeenCalledTimes(1);

    controller.abort();
    resolvePoll("pending");

    await expect(promise).resolves.toBe("cancelled");
    expect(poll, "取消后不得再 poll").toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount(), "取消后不得留下 timer").toBe(0);

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it("pending 后的 sleep 中取消：立即返回 cancelled、无残留 timer", async () => {
    const poll = vi.fn(async (): Promise<TopUpOrderStatus> => "pending");
    const controller = new AbortController();
    const promise = waitForOrderConfirmation(poll, "order-1", {
      intervalMs: INTERVAL,
      signal: controller.signal,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(poll).toHaveBeenCalledTimes(1);
    // 此刻等待器正停在 sleep(INTERVAL) 上
    expect(vi.getTimerCount()).toBe(1);

    controller.abort();
    await expect(promise).resolves.toBe("cancelled");
    expect(vi.getTimerCount(), "中断 sleep 必须清掉它的 timer").toBe(0);

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);
    expect(poll, "取消后不得再 poll").toHaveBeenCalledTimes(1);
  });

  it("网络错误 backoff 中取消：立即 cancelled、无残留 timer、不继续重试", async () => {
    const poll = vi.fn(async (): Promise<TopUpOrderStatus> => {
      throw new Error("network down");
    });
    const controller = new AbortController();
    const promise = waitForOrderConfirmation(poll, "order-1", {
      intervalMs: INTERVAL,
      signal: controller.signal,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(poll).toHaveBeenCalledTimes(1);
    // backoff = min(interval*2, 30s) ⇒ 这里是一个更大的 sleep
    expect(vi.getTimerCount()).toBe(1);

    controller.abort();
    await expect(promise).resolves.toBe("cancelled");
    expect(vi.getTimerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);
    expect(poll).toHaveBeenCalledTimes(1);
  });
});

describe("waitForOrderConfirmation 的正常路径（修复不得改动语义）", () => {
  it("pending → confirmed：跨一个 interval 后返回 confirmed", async () => {
    const statuses: TopUpOrderStatus[] = ["pending", "confirmed"];
    const poll = vi.fn(async () => statuses.shift() ?? "pending");

    const promise = waitForOrderConfirmation(poll, "order-1", {
      intervalMs: INTERVAL,
    });
    await vi.advanceTimersByTimeAsync(INTERVAL + 1);

    await expect(promise).resolves.toBe("confirmed");
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it("expired：立即返回 expired（不推进时间）", async () => {
    const poll = vi.fn(async (): Promise<TopUpOrderStatus> => "expired");
    await expect(
      waitForOrderConfirmation(poll, "order-1", { intervalMs: INTERVAL }),
    ).resolves.toBe("expired");
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it("timeout：超过 timeoutMs 返回 timeout（不是 expired / 不是 cancelled）", async () => {
    const poll = vi.fn(async (): Promise<TopUpOrderStatus> => "pending");
    const promise = waitForOrderConfirmation(poll, "order-1", {
      intervalMs: INTERVAL,
      timeoutMs: INTERVAL * 3,
    });
    await vi.advanceTimersByTimeAsync(INTERVAL * 4);

    await expect(promise).resolves.toBe("timeout");
  });
});
