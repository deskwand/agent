/**
 * @module main/desktop-pet/pet-state
 *
 * 桌宠状态归约：纯内存、无 Electron／磁盘依赖。
 *
 * 运行集合由 `SessionManager` 在每轮任务两侧驱动，结果提示只由明确的
 * 成功／失败设置；`session.status` 回到 idle 不代表成功，因此这里既不读
 * 数据库也不读会话状态。
 */
import type { AgentTurnOutcome } from "../agent/agent-runner";

export type PetState = "idle" | "running" | "success" | "failure";

/** 明确结果提示的停留时长：成功 2s、失败 4s。 */
const SUCCESS_NOTICE_MS = 2_000;
const FAILURE_NOTICE_MS = 4_000;

type Listener = (state: PetState) => void;

export class PetStateTracker {
  /**
   * 会话 → 进行中的计数。一个会话可能同时被「队列仍在跑」和「当前轮次」
   * 各占一次，因此用计数而非集合：上一轮结束后队列还没跑空时必须保持 running。
   */
  private readonly running = new Map<string, number>();
  private notice: Exclude<PetState, "idle" | "running"> | null = null;
  private noticeTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Set<Listener>();
  private lastEmitted: PetState = "idle";

  start(sessionId: string): void {
    this.running.set(sessionId, (this.running.get(sessionId) ?? 0) + 1);
    this.emit();
  }

  finish(sessionId: string, outcome: AgentTurnOutcome): void {
    const count = this.running.get(sessionId);
    if (count !== undefined) {
      if (count <= 1) {
        this.running.delete(sessionId);
      } else {
        this.running.set(sessionId, count - 1);
      }
    }

    // 取消与结果未知都只是"不再运行"，绝不闪亮成功提示。
    if (outcome === "success" || outcome === "failure") {
      this.setNotice(outcome);
    }

    this.emit();
  }

  snapshot(): PetState {
    return this.notice ?? (this.running.size > 0 ? "running" : "idle");
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private setNotice(state: "success" | "failure"): void {
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    this.notice = state;
    this.noticeTimer = setTimeout(
      () => {
        this.noticeTimer = null;
        this.notice = null;
        this.emit();
      },
      state === "success" ? SUCCESS_NOTICE_MS : FAILURE_NOTICE_MS,
    );
  }

  private emit(): void {
    const state = this.snapshot();
    if (state === this.lastEmitted) return;
    this.lastEmitted = state;
    for (const listener of [...this.listeners]) {
      listener(state);
    }
  }
}
