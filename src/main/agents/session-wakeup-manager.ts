/**
 * @module main/agents/session-wakeup-manager
 *
 * 普通会话（kind === "ordinary"）的自我唤醒调度。
 *
 * 与 PersistentAgentManager 的区别：没有兜底心跳、没有签到、没有周期规则，
 * 只认模型显式预约的唤醒。每个会话挂一个定时器，到点往同一会话
 * `continueSession` 一条 `<agent_wakeup>` 消息。会话忙时不并发投递，
 * 触发原因攒到轮次结束再合并投出。
 *
 * 链式计数靠投递过的 prompt 身份记账（`pendingWakeupPrompts`），不解析提示词：
 * 投递后 prompt 会进 enqueuePrompt 排队，运行时是否保留 `<agent_wakeup>` 标签没有保证，
 * 而按次数记账又会在「用户消息排在唤醒消息之前」时把两轮的归属搞反。
 */
import { v4 as uuidv4 } from "uuid";
import {
  MAX_PENDING_SESSION_WAKEUPS,
  MAX_SELF_WAKE_CHAIN,
  MAX_SESSION_WAKEUP_AHEAD_MS,
  MIN_SESSION_WAKEUP_DELAY_MS,
  type SessionWakeup,
  type SessionWakeupView,
} from "../../shared/session-wakeup";
import { MAX_TIMER_DELAY_MS } from "../schedule/schedule-rules";
import { logError } from "../utils/logger";
import { buildSessionWakeupMessage } from "./session-wakeup-message";
import type { SessionWakeupStore } from "./session-wakeup-store";

export interface SessionWakeupSessionPort {
  continueSession(sessionId: string, prompt: string): Promise<void>;
  isSessionRunning(sessionId: string): boolean;
  sessionExists(sessionId: string): boolean;
  /** 只有 ordinary 会话才投递；agent / voice 会话返回 false。 */
  isOrdinarySession(sessionId: string): boolean;
}

export type SessionWakeupEvent =
  | { type: "updated"; sessionId: string; next: SessionWakeupView | null }
  | { type: "removed"; sessionId: string };

export interface SessionWakeupManagerOptions {
  store: SessionWakeupStore;
  sessions: SessionWakeupSessionPort;
  onEvent: (event: SessionWakeupEvent) => void;
  now?: () => number;
}

/** 模型给的 reason 会落库、进提示词、进 chip 的 title，截断一下。 */
const MAX_REASON_LENGTH = 200;

interface PendingDelivery {
  reasons: string[];
  missedCount: number;
}

export class SessionWakeupManager {
  private readonly store: SessionWakeupStore;
  private readonly sessions: SessionWakeupSessionPort;
  private readonly onEvent: (event: SessionWakeupEvent) => void;
  private readonly now: () => number;
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly pending = new Map<string, PendingDelivery>();
  private readonly inFlight = new Set<string>();
  /**
   * 已投递、还没开始跑的唤醒 prompt（链式判定用）。
   * 按字符串身份匹配，而不是计数：用户消息可能排在唤醒消息之前，
   * 计数会把两轮的归属搞反，链上限就会静默失效。
   */
  private readonly pendingWakeupPrompts = new Map<string, string[]>();
  /** 当前这一轮是唤醒触发的。 */
  private readonly wakeupRuns = new Set<string>();
  private running = false;

  constructor(options: SessionWakeupManagerOptions) {
    this.store = options.store;
    this.sessions = options.sessions;
    this.onEvent = options.onEvent;
    this.now = options.now ?? (() => Date.now());
  }

  start(): void {
    this.running = true;
    this.store.pruneOrphans((sessionId) =>
      this.sessions.sessionExists(sessionId),
    );
    for (const sessionId of this.store.listSessionIds()) {
      this.arm(sessionId);
      this.emit(sessionId);
    }
  }

  stop(): void {
    this.running = false;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  getNext(sessionId: string): SessionWakeupView | null {
    const earliest = this.store.listBySession(sessionId)[0];
    return earliest
      ? { id: earliest.id, at: earliest.runAt, reason: earliest.reason }
      : null;
  }

  /** 校验失败抛 Error，文案是给模型看的英文。 */
  schedule(sessionId: string, runAt: number, reason: string): SessionWakeup {
    const now = this.now();
    if (!this.sessions.sessionExists(sessionId)) {
      throw new Error("Unknown session.");
    }
    if (!Number.isFinite(runAt)) {
      throw new Error("Could not parse 'at' as an ISO 8601 time.");
    }
    if (runAt < now + MIN_SESSION_WAKEUP_DELAY_MS) {
      throw new Error("Wakeup must be at least 1 minute in the future.");
    }
    if (runAt > now + MAX_SESSION_WAKEUP_AHEAD_MS) {
      throw new Error("Wakeup must be within 7 days.");
    }
    if (this.store.count(sessionId) >= MAX_PENDING_SESSION_WAKEUPS) {
      throw new Error(
        `Too many pending wakeups (max ${MAX_PENDING_SESSION_WAKEUPS}). Cancel some first.`,
      );
    }
    if (this.store.getChain(sessionId) >= MAX_SELF_WAKE_CHAIN) {
      throw new Error(
        "You have reached the limit of consecutive self-wakeups. Report your progress to the user instead of scheduling another one.",
      );
    }
    const wakeup: SessionWakeup = {
      id: uuidv4(),
      sessionId,
      runAt,
      reason: reason.slice(0, MAX_REASON_LENGTH),
      createdAt: now,
    };
    this.store.insert(wakeup);
    // 只有唤醒轮里排的新唤醒才延长链；用户轮一开始就把链清零了。
    if (this.wakeupRuns.has(sessionId)) {
      this.store.setChain(sessionId, this.store.getChain(sessionId) + 1);
    }
    this.arm(sessionId);
    this.emit(sessionId);
    return wakeup;
  }

  cancel(sessionId: string, wakeupId: string): boolean {
    const removed = this.store.deleteWakeup(sessionId, wakeupId);
    if (removed) {
      this.arm(sessionId);
      this.emit(sessionId);
    }
    return removed;
  }

  /**
   * 每轮开始：prompt 与本会话投递过、还没消费的那条唤醒消息对上才算唤醒轮；
   * 其余一律算用户轮并把链清零。
   */
  beginRun(sessionId: string, prompt: string): void {
    const queued = this.pendingWakeupPrompts.get(sessionId);
    const index = queued ? queued.indexOf(prompt) : -1;
    if (queued && index >= 0) {
      queued.splice(index, 1);
      if (queued.length === 0) this.pendingWakeupPrompts.delete(sessionId);
      this.wakeupRuns.add(sessionId);
      return;
    }
    this.wakeupRuns.delete(sessionId);
    if (this.store.getChain(sessionId) !== 0) this.store.clearChain(sessionId);
  }

  /** 一轮结束：把攒着的唤醒投出去。不认识的会话（agent / voice）直接忽略。 */
  onTurnFinished(sessionId: string): void {
    const relevant =
      this.inFlight.has(sessionId) || this.pending.has(sessionId);
    this.inFlight.delete(sessionId);
    if (!relevant) return;
    const queued = this.pending.get(sessionId);
    if (!queued) return;
    this.pending.delete(sessionId);
    void this.deliver(sessionId, queued.reasons, queued.missedCount, true);
  }

  onSessionDeleted(sessionId: string): void {
    this.clearTimer(sessionId);
    this.pending.delete(sessionId);
    this.inFlight.delete(sessionId);
    this.pendingWakeupPrompts.delete(sessionId);
    this.wakeupRuns.delete(sessionId);
    this.store.deleteBySession(sessionId);
    this.onEvent({ type: "removed", sessionId });
  }

  private emit(sessionId: string): void {
    this.onEvent({
      type: "updated",
      sessionId,
      next: this.getNext(sessionId),
    });
  }

  private clearTimer(sessionId: string): void {
    const timer = this.timers.get(sessionId);
    if (timer) clearTimeout(timer);
    this.timers.delete(sessionId);
  }

  private arm(sessionId: string): void {
    this.clearTimer(sessionId);
    if (!this.running) return;
    const target = this.store.listBySession(sessionId)[0]?.runAt ?? null;
    if (target === null) return;
    const delay = Math.max(0, target - this.now());
    this.timers.set(
      sessionId,
      setTimeout(
        () => void this.fire(sessionId),
        Math.min(delay, MAX_TIMER_DELAY_MS),
      ),
    );
  }

  private async fire(sessionId: string): Promise<void> {
    this.timers.delete(sessionId);
    const now = this.now();
    const target = this.store.listBySession(sessionId)[0]?.runAt ?? null;
    if (target === null) return;
    if (target > now) {
      // 延迟被截断过，或系统时钟回拨：只重挂，不能提前投递
      this.arm(sessionId);
      return;
    }

    const due = this.store.takeDue(sessionId, now);
    if (due.length === 0) {
      this.arm(sessionId);
      return;
    }
    // 定时器比原定时刻晚了 1 分钟以上才算「错过」（应用没运行 / 机器睡眠）
    const late = now - due[0].runAt > MIN_SESSION_WAKEUP_DELAY_MS;
    await this.deliver(
      sessionId,
      due.map((wakeup) => wakeup.reason),
      late ? due.length : 0,
    );
  }

  private async deliver(
    sessionId: string,
    reasons: string[],
    missedCount: number,
    ignoreBusy = false,
  ): Promise<void> {
    if (reasons.length === 0) {
      this.arm(sessionId);
      return;
    }
    // 会话被删除，或已不是普通会话（被提升为 agent / voice）：丢弃，不投递
    if (
      !this.sessions.sessionExists(sessionId) ||
      !this.sessions.isOrdinarySession(sessionId)
    ) {
      this.store.deleteBySession(sessionId);
      this.clearTimer(sessionId);
      this.emit(sessionId);
      return;
    }
    if (
      !ignoreBusy &&
      (this.inFlight.has(sessionId) ||
        this.sessions.isSessionRunning(sessionId))
    ) {
      const queued = this.pending.get(sessionId);
      this.pending.set(sessionId, {
        reasons: [...(queued?.reasons ?? []), ...reasons],
        missedCount: (queued?.missedCount ?? 0) + missedCount,
      });
      this.arm(sessionId);
      // 预约行已从库里取走，必须让渲染层知道「下一次」变了，否则提示条会一直停在旧值
      this.emit(sessionId);
      return;
    }

    const prompt = buildSessionWakeupMessage({
      now: this.now(),
      reasons,
      upcoming: this.store.listBySession(sessionId),
      missedCount,
    });
    this.inFlight.add(sessionId);
    this.pendingWakeupPrompts.set(sessionId, [
      ...(this.pendingWakeupPrompts.get(sessionId) ?? []),
      prompt,
    ]);
    this.arm(sessionId);
    this.emit(sessionId);
    try {
      await this.sessions.continueSession(sessionId, prompt);
    } catch (error) {
      // 没跑起来就别留下「待开始的唤醒」标记，否则下一轮用户消息会被误判
      const delivered = this.pendingWakeupPrompts.get(sessionId) ?? [];
      const at = delivered.indexOf(prompt);
      if (at >= 0) delivered.splice(at, 1);
      if (delivered.length === 0) this.pendingWakeupPrompts.delete(sessionId);
      this.inFlight.delete(sessionId);
      logError("[SessionWakeupManager] Wakeup delivery failed:", error);
      // 投递失败（回滚窗口、会话刚被停掉等）不能静默丢：一分钟后再排一次
      try {
        const retryAt = this.now() + MIN_SESSION_WAKEUP_DELAY_MS;
        this.store.insert({
          id: uuidv4(),
          sessionId,
          runAt: retryAt,
          reason: reasons.join(" / ").slice(0, MAX_REASON_LENGTH),
          createdAt: this.now(),
        });
        this.arm(sessionId);
        this.emit(sessionId);
      } catch (retryError) {
        logError("[SessionWakeupManager] Wakeup retry failed:", retryError);
      }
    }
  }
}
