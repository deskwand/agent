// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../renderer/i18n/config";
import {
  absoluteLabel,
  countdownLabel,
  SessionWakeupChip,
} from "../../renderer/components/SessionWakeupChip";
import { useSessionWakeupStore } from "../../renderer/store/session-wakeups";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = new Date(2026, 10, 1, 10, 0).getTime();
const MINUTE = 60 * 1000;
const AT = NOW + 3 * MINUTE;

let container: HTMLDivElement;
let root: Root | null = null;
let next: ReturnType<typeof vi.fn>;
let cancel: ReturnType<typeof vi.fn>;

const t = (key: string, options?: Record<string, unknown>) =>
  i18n.t(key, options);

beforeEach(() => {
  // Date 与定时器一起冻结：倒计时靠 setTimeout 自愈，只冻 Date 会让定时器原地不动
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  localStorage.clear();
  useSessionWakeupStore.setState({ next: {}, revision: 0 });
  next = vi.fn(async () => ({ id: "w1", at: AT, reason: "看构建结果" }));
  cancel = vi.fn(async () => true);
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    sessionWakeup: { next, cancel },
  };
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  container.remove();
  vi.useRealTimers();
  vi.clearAllMocks();
});

/** 挂载并等 `next()` 的 promise 链落地。 */
async function mount(sessionId = "s1"): Promise<void> {
  await act(async () => {
    root = createRoot(container);
    root.render(<SessionWakeupChip sessionId={sessionId} />);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

/**
 * 推进倒计时。两个坑叠在一起：
 * 1) `Date` 也被 fake 时 vitest 会同步推进墙钟，所以**不能**再手动 `setSystemTime`（会走两倍）；
 * 2) 必须**分段**推进并每段单独 `act`：`setNow` 在 act 末尾才 flush，一整段推完的话
 *    定时器不会重挂，倒计时就停住。
 */
async function tick(ms: number): Promise<void> {
  const STEP = 1_000;
  for (let elapsed = 0; elapsed < ms; elapsed += STEP) {
    const slice = Math.min(STEP, ms - elapsed);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(slice);
    });
  }
}

describe("countdownLabel", () => {
  it("crosses the imminent threshold before the seconds run out", () => {
    expect(countdownLabel(t, 5_000)).toBe(i18n.t("sessionWakeup.imminent"));
    expect(countdownLabel(t, 0)).toBe(i18n.t("sessionWakeup.imminent"));
    expect(countdownLabel(t, -30_000)).toBe(i18n.t("sessionWakeup.imminent"));
  });

  it("reports seconds only in the last minute", () => {
    expect(countdownLabel(t, 30_000)).toBe(
      i18n.t("sessionWakeup.countdownSeconds", { seconds: 30 }),
    );
    // 59.4 秒不能印成「60 秒」，进位到分钟
    expect(countdownLabel(t, 59_400)).toBe(
      i18n.t("sessionWakeup.countdownMinutes", { minutes: 1 }),
    );
  });

  it("reports minutes, hours and days by magnitude", () => {
    expect(countdownLabel(t, 5 * MINUTE)).toBe(
      i18n.t("sessionWakeup.countdownMinutes", { minutes: 5 }),
    );
    expect(countdownLabel(t, 2 * 60 * MINUTE + 8 * MINUTE)).toBe(
      i18n.t("sessionWakeup.countdownHours", { hours: 2, minutes: 8 }),
    );
    expect(countdownLabel(t, 3 * 24 * 60 * MINUTE + 5 * 60 * MINUTE)).toBe(
      i18n.t("sessionWakeup.countdownDays", { days: 3, hours: 5 }),
    );
  });

  it("carries instead of printing 60 of a smaller unit", () => {
    // 1h59m30s → 不能印成「1 小时 60 分」
    expect(countdownLabel(t, 60 * MINUTE + 59.5 * MINUTE)).toBe(
      i18n.t("sessionWakeup.countdownHours", { hours: 2, minutes: 0 }),
    );
    // 23h59m30s → 不能印成「23 小时 60 分」
    expect(countdownLabel(t, 23.99 * 60 * MINUTE)).toBe(
      i18n.t("sessionWakeup.countdownDays", { days: 1, hours: 0 }),
    );
  });
});

describe("absoluteLabel", () => {
  it("names today and tomorrow, otherwise shows the date", () => {
    expect(absoluteLabel(t, AT, NOW)).toBe(
      i18n.t("sessionWakeup.chipToday", { time: "10:03" }),
    );
    expect(absoluteLabel(t, NOW + 24 * 60 * MINUTE, NOW)).toBe(
      i18n.t("sessionWakeup.chipTomorrow", { time: "10:00" }),
    );
    expect(absoluteLabel(t, new Date(2026, 10, 5, 9, 0).getTime(), NOW)).toBe(
      i18n.t("sessionWakeup.chipOther", { date: "11-05", time: "09:00" }),
    );
  });
});

describe("SessionWakeupChip", () => {
  it("renders nothing when the session has no wakeup", async () => {
    next.mockResolvedValue(null);
    await mount();
    expect(container.textContent).toBe("");
  });

  it("shows the countdown and cancels it", async () => {
    await mount();
    expect(container.textContent).toContain(
      i18n.t("sessionWakeup.countdownMinutes", { minutes: 3 }),
    );

    const button = container.querySelector("button");
    expect(button).not.toBeNull();
    expect(button!.getAttribute("aria-label")).toBe(
      i18n.t("sessionWakeup.cancelTitle"),
    );
    await act(async () => {
      button!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(cancel).toHaveBeenCalledWith("s1", "w1");
    expect(container.textContent).toBe("");
  });

  it("keeps the chip when cancelling fails", async () => {
    cancel.mockResolvedValue(false);
    await mount();
    const button = container.querySelector("button");
    await act(async () => {
      button!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.textContent).toContain(
      i18n.t("sessionWakeup.countdownMinutes", { minutes: 3 }),
    );
  });

  it("ticks down to minutes, then seconds, then imminent", async () => {
    await mount();
    await tick(5_000);
    expect(container.textContent).toContain(
      i18n.t("sessionWakeup.countdownMinutes", { minutes: 3 }),
    );

    // 走到只剩 1 分钟
    await tick(115_000);
    expect(container.textContent).toContain(
      i18n.t("sessionWakeup.countdownMinutes", { minutes: 1 }),
    );

    // 进入最后一分钟：逐秒跳
    await tick(1_000);
    expect(container.textContent).toContain(
      i18n.t("sessionWakeup.countdownSeconds", { seconds: 59 }),
    );

    await tick(29_000);
    expect(container.textContent).toContain(
      i18n.t("sessionWakeup.countdownSeconds", { seconds: 30 }),
    );

    // 越过 10 秒阈值就改口，不报一个停住的数字
    await tick(40_000);
    expect(container.textContent).toContain(i18n.t("sessionWakeup.imminent"));
  });

  it("uses a fresh clock the first time a wakeup appears", async () => {
    next.mockResolvedValue(null);
    await mount();
    expect(container.textContent).toBe("");

    // 页面开了两小时后才有预约：不能拿挂载时的 now 去算
    vi.setSystemTime(NOW + 2 * 60 * MINUTE);
    await act(async () => {
      useSessionWakeupStore.getState().upsert("s1", {
        id: "w2",
        at: NOW + 2 * 60 * MINUTE + 3 * MINUTE,
        reason: "看构建结果",
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(container.textContent).toContain(
      i18n.t("sessionWakeup.countdownMinutes", { minutes: 3 }),
    );
  });

  it("ignores a fetch that resolves after a newer push", async () => {
    useSessionWakeupStore.setState({ next: {}, revision: 0 });
    next.mockImplementation(async () => {
      // 拉取在飞行中时，主进程把这次唤醒取消了
      useSessionWakeupStore.getState().upsert("s1", null);
      return { id: "w1", at: AT, reason: "看构建结果" };
    });
    await mount();
    expect(container.textContent).toBe("");
    expect(useSessionWakeupStore.getState().next.s1).toBeUndefined();
  });

  it("clears the tick timer on unmount", async () => {
    await mount();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    act(() => {
      root?.unmount();
    });
    root = null;
    expect(vi.getTimerCount()).toBe(0);
  });
});
