import { describe, expect, it, vi } from "vitest";
import { ensureVoiceModeStart } from "../../renderer/utils/voice/voice-mode-gate";

describe("开始语音模式前的门", () => {
  it("缺语音输入 → 拦住（调用方不建会话 / 不开浮层）", async () => {
    const result = await ensureVoiceModeStart({
      ensureReady: async () => "cancelled",
      micBusy: () => false,
    });
    expect(result).toMatchObject({ status: "blocked", reason: "capability" });
    expect((result as { outcome?: string }).outcome).toBe("cancelled");
  });

  it("别人正在录音 → 不抢麦（连能力门都不问）", async () => {
    const ensureReady = vi.fn(async () => "ready" as const);
    const result = await ensureVoiceModeStart({
      ensureReady,
      micBusy: () => true,
    });
    expect(result).toEqual({ status: "blocked", reason: "mic-busy" });
    expect(ensureReady).not.toHaveBeenCalled();
  });

  it("两个前置都过 → ok（至于建会话还是开已有会话，是调用方的事）", async () => {
    await expect(
      ensureVoiceModeStart({
        ensureReady: async () => "ready",
        micBusy: () => false,
      }),
    ).resolves.toEqual({ status: "ok" });
  });

  it("正在装 / 失败 / 桥不在 → 一律拦住（不重复问，也不进去空跑）", async () => {
    for (const outcome of ["busy", "failed", "unsupported"] as const) {
      await expect(
        ensureVoiceModeStart({
          ensureReady: async () => outcome,
          micBusy: () => false,
        }),
      ).resolves.toMatchObject({ status: "blocked", reason: "capability" });
    }
  });
});
