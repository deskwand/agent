import { describe, expect, it, vi } from "vitest";
import {
  FeedScheduler,
  MIN_INTERVAL_MS,
  TICK_INTERVAL_MS,
} from "../../main/feed/feed-scheduler";
import type { FeedSchedulerDeps } from "../../main/feed/feed-scheduler";

const NOW = 1_700_000_000_000;

function make(deps: Partial<FeedSchedulerDeps> = {}) {
  const refresh = vi.fn(async () => ({ started: true }));
  const scheduler = new FeedScheduler({
    isEnabled: () => true,
    isBusy: () => false,
    lastSuccessAt: () => NOW - MIN_INTERVAL_MS - 1,
    lastAttemptAt: () => NOW - MIN_INTERVAL_MS - 1,
    exceedsFailureBudget: () => false,
    refresh,
    now: () => NOW,
    ...deps,
  });
  return { scheduler, refresh };
}

describe("FeedScheduler.tick", () => {
  it("关闭时一个 tick 都不跑", async () => {
    const { scheduler, refresh } = make({ isEnabled: () => false });
    await scheduler.tick();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("距上次成功不到 24 小时不跑", async () => {
    const { scheduler, refresh } = make({ lastSuccessAt: () => NOW - 1000 });
    await scheduler.tick();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("从未成功过时立刻跑（窗口取 -∞）", async () => {
    const { scheduler, refresh } = make({ lastSuccessAt: () => null });
    await scheduler.tick();
    expect(refresh).toHaveBeenCalledWith("schedule");
  });

  it("恰好满 24 小时时跑", async () => {
    const { scheduler, refresh } = make({
      lastSuccessAt: () => NOW - MIN_INTERVAL_MS,
    });
    await scheduler.tick();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("app 忙时不跑，且不推进任何计时（下个 tick 还会再判）", async () => {
    const { scheduler, refresh } = make({ isBusy: () => true });
    await scheduler.tick();
    await scheduler.tick();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("连续失败达到预算时，24 小时内不重试", async () => {
    const { scheduler, refresh } = make({
      exceedsFailureBudget: () => true,
      lastAttemptAt: () => NOW - 1000,
    });
    await scheduler.tick();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("连续失败但已过 24 小时时仍会再试一次（故障修好能自愈）", async () => {
    const { scheduler, refresh } = make({
      exceedsFailureBudget: () => true,
      lastAttemptAt: () => NOW - MIN_INTERVAL_MS - 1,
    });
    await scheduler.tick();
    expect(refresh).toHaveBeenCalledWith("schedule");
  });

  it("上一轮还没跑完时不重入", async () => {
    const gate: { release: (() => void) | null } = { release: null };
    const refresh = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          gate.release = resolve;
        }),
    );
    const { scheduler } = make({
      refresh: refresh as unknown as FeedSchedulerDeps["refresh"],
      lastSuccessAt: () => null,
    });
    const first = scheduler.tick();
    await scheduler.tick();
    expect(refresh).toHaveBeenCalledTimes(1);
    gate.release?.();
    await first;
  });

  it("refresh 抛错时 tick 不抛（调度器必须活下去）", async () => {
    const { scheduler } = make({
      refresh: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    await expect(scheduler.tick()).resolves.toBeUndefined();
  });

  it("tick 间隔是 30 分钟，最短间隔是 24 小时", () => {
    expect(TICK_INTERVAL_MS).toBe(30 * 60 * 1000);
    expect(MIN_INTERVAL_MS).toBe(24 * 60 * 60 * 1000);
  });
});
