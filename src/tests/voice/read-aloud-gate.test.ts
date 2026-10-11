import { describe, expect, it } from "vitest";
import {
  isLatestReadIntent,
  nextReadIntent,
  shouldAutoStartReadAloud,
} from "../../renderer/utils/voice/read-aloud-gate";

describe("朗读装完自动开始的四条护栏", () => {
  const base = {
    messageMounted: true,
    messageStillCurrent: true,
    voiceRuntimeOpen: false,
    noReadStartedSince: true,
  };

  it("四条都成立 → 自动开始", () => {
    expect(shouldAutoStartReadAloud(base)).toBe(true);
  });

  it("消息已卸载 → 不自动开始", () => {
    expect(shouldAutoStartReadAloud({ ...base, messageMounted: false })).toBe(
      false,
    );
  });

  it("语音运行时开着 → 不自动开始（两路声音会撞）", () => {
    expect(shouldAutoStartReadAloud({ ...base, voiceRuntimeOpen: true })).toBe(
      false,
    );
  });

  it("期间用户读过别的 → 不自动开始", () => {
    expect(
      shouldAutoStartReadAloud({ ...base, noReadStartedSince: false }),
    ).toBe(false);
  });

  it("期间切换过消息 → 不自动开始", () => {
    expect(
      shouldAutoStartReadAloud({ ...base, messageStillCurrent: false }),
    ).toBe(false);
  });
});

describe("最新朗读意图的令牌（跨卡片）", () => {
  it("只有最新那一次算数 —— 先点的卡片装好后不该自动出声", () => {
    const first = nextReadIntent();
    expect(isLatestReadIntent(first)).toBe(true);
    const second = nextReadIntent();
    expect(isLatestReadIntent(first)).toBe(false);
    expect(isLatestReadIntent(second)).toBe(true);
  });
});
