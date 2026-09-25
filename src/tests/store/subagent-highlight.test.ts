import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../renderer/store";

describe("subagent jump highlight state", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useAppStore.setState(useAppStore.getInitialState(), true);
  });
  afterEach(() => vi.useRealTimers());

  it("设高亮时同时挂上待展开，2 秒后自动清掉高亮", () => {
    useAppStore.getState().highlightToolCallId("call-1");
    expect(useAppStore.getState().highlightedToolCallId).toBe("call-1");
    expect(useAppStore.getState().pendingExpandToolCallId).toBe("call-1");

    vi.advanceTimersByTime(1999);
    expect(useAppStore.getState().highlightedToolCallId).toBe("call-1");
    vi.advanceTimersByTime(1);
    expect(useAppStore.getState().highlightedToolCallId).toBeNull();
  });

  it("连点两次不会被旧定时器提前清掉", () => {
    useAppStore.getState().highlightToolCallId("call-1");
    vi.advanceTimersByTime(1500);
    useAppStore.getState().highlightToolCallId("call-2");
    vi.advanceTimersByTime(1500); // 距第一次 3000ms、距第二次 1500ms
    expect(useAppStore.getState().highlightedToolCallId).toBe("call-2");
  });

  it("待展开可以被消费掉", () => {
    useAppStore.getState().highlightToolCallId("call-1");
    useAppStore.getState().clearPendingExpandToolCallId();
    expect(useAppStore.getState().pendingExpandToolCallId).toBeNull();
    expect(useAppStore.getState().highlightedToolCallId).toBe("call-1");
  });
});
