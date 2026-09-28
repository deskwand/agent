import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PetStateTracker,
  type PetState,
} from "../../main/desktop-pet/pet-state";

const SUCCESS_NOTICE_MS = 2_000;
const FAILURE_NOTICE_MS = 4_000;

describe("PetStateTracker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps other running sessions visible behind a short success notice", () => {
    const tracker = new PetStateTracker();
    tracker.start("a");
    tracker.start("b");
    tracker.finish("a", "success");

    expect(tracker.snapshot()).toBe("success");

    vi.advanceTimersByTime(SUCCESS_NOTICE_MS);
    expect(tracker.snapshot()).toBe("running");

    tracker.finish("b", "unknown");
    expect(tracker.snapshot()).toBe("idle");
  });

  it("holds a failure notice for four seconds, then falls back to idle", () => {
    const tracker = new PetStateTracker();
    tracker.start("a");
    tracker.finish("a", "failure");

    expect(tracker.snapshot()).toBe("failure");

    vi.advanceTimersByTime(FAILURE_NOTICE_MS - 1);
    expect(tracker.snapshot()).toBe("failure");

    vi.advanceTimersByTime(1);
    expect(tracker.snapshot()).toBe("idle");
  });

  it("never flashes success for cancelled or unknown outcomes", () => {
    const tracker = new PetStateTracker();

    tracker.start("a");
    tracker.finish("a", "cancelled");
    expect(tracker.snapshot()).toBe("idle");

    tracker.start("b");
    tracker.finish("b", "unknown");
    expect(tracker.snapshot()).toBe("idle");

    vi.advanceTimersByTime(FAILURE_NOTICE_MS * 2);
    expect(tracker.snapshot()).toBe("idle");
  });

  it("only returns to idle after every tracked session finished", () => {
    const tracker = new PetStateTracker();
    tracker.start("a");
    tracker.start("b");
    expect(tracker.snapshot()).toBe("running");

    tracker.finish("a", "unknown");
    expect(tracker.snapshot()).toBe("running");

    tracker.finish("b", "unknown");
    expect(tracker.snapshot()).toBe("idle");
  });

  // 一个会话排队跑多轮：轮次之间会话仍在执行，不能因上一轮结束就掉回 idle。
  it("keeps a session running between queued turns", () => {
    const tracker = new PetStateTracker();
    tracker.start("a"); // 会话级的队列占位
    tracker.start("a"); // 第一轮
    tracker.finish("a", "cancelled"); // 用户停掉第一轮，不闪结果提示

    expect(tracker.snapshot()).toBe("running");

    tracker.start("a"); // 第二轮
    tracker.finish("a", "success");
    expect(tracker.snapshot()).toBe("success");

    tracker.finish("a", "unknown"); // 队列跑空，仅做运行清理
    vi.advanceTimersByTime(SUCCESS_NOTICE_MS);
    expect(tracker.snapshot()).toBe("idle");
  });

  it("replaces a pending notice and its timer with the newest result", () => {
    const tracker = new PetStateTracker();
    tracker.start("a");
    tracker.finish("a", "success");
    vi.advanceTimersByTime(SUCCESS_NOTICE_MS - 500);

    tracker.finish("a", "failure");
    expect(tracker.snapshot()).toBe("failure");

    // 旧的 2s 计时器必须已被清掉，否则这里会提前掉回 idle。
    vi.advanceTimersByTime(500);
    expect(tracker.snapshot()).toBe("failure");

    vi.advanceTimersByTime(FAILURE_NOTICE_MS - 500);
    expect(tracker.snapshot()).toBe("idle");
  });

  it("notifies subscribers on transitions and stops after unsubscribe", () => {
    const tracker = new PetStateTracker();
    const seen: PetState[] = [];
    const unsubscribe = tracker.subscribe((state) => seen.push(state));

    tracker.start("a");
    tracker.finish("a", "success");

    expect(seen).toEqual(["running", "success"]);

    unsubscribe();
    vi.advanceTimersByTime(SUCCESS_NOTICE_MS);
    expect(seen).toEqual(["running", "success"]);
  });

  // 窗口重建只能读主进程内存里的真实运行集合，不能依赖 DB 里可能滞后的状态。
  it("reports the live running set to a window that attaches late", () => {
    const tracker = new PetStateTracker();
    tracker.start("a");

    const rebuiltWindow = {
      seen: [] as PetState[],
      unsubscribe: () => {},
    };
    rebuiltWindow.unsubscribe = tracker.subscribe((state) =>
      rebuiltWindow.seen.push(state),
    );

    expect(tracker.snapshot()).toBe("running");

    tracker.finish("a", "failure");
    expect(rebuiltWindow.seen).toEqual(["failure"]);

    rebuiltWindow.unsubscribe();
  });
});
