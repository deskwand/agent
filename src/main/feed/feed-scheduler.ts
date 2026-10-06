/**
 * @module main/feed/feed-scheduler
 *
 * 滚动 24 小时的触发判定（设计 §7）。它只回答「该不该跑」，
 * 具体执行全在 feed-service —— 所以这个文件很小、很好测。
 */
import { logWarn } from "../utils/logger";

export const TICK_INTERVAL_MS = 30 * 60 * 1000;
export const MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface FeedSchedulerDeps {
  isEnabled: () => boolean;
  isBusy: () => boolean;
  lastSuccessAt: () => number | null;
  /** 任何状态的最后一次尝试时间；连续失败封顶后靠它算间隔，不然窗口永远不会到。 */
  lastAttemptAt: () => number | null;
  exceedsFailureBudget: () => boolean;
  refresh: (trigger: "schedule") => Promise<unknown>;
  now: () => number;
}

export class FeedScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;

  constructor(private readonly deps: FeedSchedulerDeps) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, TICK_INTERVAL_MS);
    this.timer.unref?.();
    void this.tick();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    if (this.ticking) return;
    if (!this.deps.isEnabled()) return;
    if (this.deps.isBusy()) return;

    const now = this.deps.now();
    if (this.deps.exceedsFailureBudget()) {
      // 连续失败封顶（设计 §9）：**不能直接 return** —— 失败不推进成功窗口，
      // `lastSuccessAt` 会永远停在很久以前，「回到 24h 节奏」就变成了「永远不再试」。
      // 改成距上次**尝试**满 24 小时再试一次，故障修好之后能自愈。
      const lastAttempt = this.deps.lastAttemptAt();
      if (lastAttempt !== null && now - lastAttempt < MIN_INTERVAL_MS) return;
    } else {
      const lastSuccess = this.deps.lastSuccessAt();
      if (lastSuccess !== null && now - lastSuccess < MIN_INTERVAL_MS) return;
    }

    this.ticking = true;
    try {
      await this.deps.refresh("schedule");
    } catch (error) {
      // 调度器不能因为一次生成失败就死掉
      logWarn("[feed] scheduled refresh failed:", error);
    } finally {
      this.ticking = false;
    }
  }
}
