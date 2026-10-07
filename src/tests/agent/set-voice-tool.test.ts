import { describe, expect, it, vi } from "vitest";
import { createSetVoiceTool } from "../../main/agent/tools/set-voice";
import type { VoiceModeConfig } from "../../shared/voice-mode";

/**
 * `set_voice`：语音会话里让**模型**改声音的唯一入口。
 *
 * 它只写 `voiceMode` 配置 —— 不写工作区文件、不触发任何下载（下载只能由用户在设置里
 * 发起，与 `tools/tts.ts` 同一条既有原则）。参数由模型决定，我们只做两件事：
 * 校验（非法音色拒绝并给候选）与夹紧（语速区间在共享层定义）。
 */
function harness(
  initial: VoiceModeConfig = { silenceMs: 1200, fastVoice: false },
) {
  let current: VoiceModeConfig = initial;
  const saved: Partial<VoiceModeConfig>[] = [];
  const tool = createSetVoiceTool({
    readVoiceMode: () => current,
    saveVoiceMode: async (patch) => {
      saved.push(patch);
      current = { ...current, ...patch };
    },
    isBestTierAvailable: () => true,
  });
  const call = (args: Record<string, unknown>) =>
    tool.execute("call-1", args, undefined, undefined, undefined as never);
  const text = (r: unknown) =>
    ((r as { content: { text: string }[] }).content[0]?.text ?? "") as string;
  return {
    tool,
    call,
    text,
    saved,
    get current() {
      return current;
    },
  };
}

describe("set_voice", () => {
  it("writes the requested fields and keeps the rest of the config", async () => {
    const h = harness({ silenceMs: 1200, fastVoice: false, tone: "best" });

    await h.call({ voice: "vivian", speed: 1.25, instructions: "嗲一点" });

    expect(h.saved).toHaveLength(1);
    expect(h.saved[0]).toMatchObject({
      voiceEngineVoice: "vivian",
      voiceSpeed: 1.25,
      voiceStyle: "嗲一点",
    });
    // 整体替换的老坑：没提到的字段必须原样保留
    expect(h.current.tone).toBe("best");
    expect(h.current.silenceMs).toBe(1200);
  });

  it("only touches the field that was asked for", async () => {
    const h = harness({
      silenceMs: 1200,
      fastVoice: false,
      voiceEngineVoice: "serena",
      voiceSpeed: 1.25,
      voiceStyle: "温柔",
    });

    await h.call({ speed: 1.5 });

    expect(h.saved[0]).toEqual({ voiceSpeed: 1.5 });
    expect(h.current.voiceEngineVoice).toBe("serena");
    expect(h.current.voiceStyle).toBe("温柔");
  });

  it("clamps speed into the shared range and reports the clamped value", async () => {
    const h = harness();
    const low = (await h.call({ speed: 0.1 })) as never;
    expect(h.saved[0]).toEqual({ voiceSpeed: 0.5 });
    expect(h.text(await low)).toContain("0.5");

    const h2 = harness();
    await h2.call({ speed: 9 });
    expect(h2.saved[0]).toEqual({ voiceSpeed: 2 });
  });

  it("rejects an unknown voice instead of silently ignoring it", async () => {
    const h = harness();
    const result = await h.call({ voice: "emma" });

    expect(h.saved).toHaveLength(0);
    expect(h.text(result)).toContain("serena");
    expect(h.text(result)).toContain("vivian");
  });

  it("reports per-field effectiveness for the current tier", async () => {
    // 最佳档没装时：音色与风格拿不到，语速仍然生效 —— 逐项告诉模型，它才不会替我们撒谎
    const tool = createSetVoiceTool({
      readVoiceMode: () => ({ silenceMs: 1200, fastVoice: false }),
      saveVoiceMode: vi.fn(async () => {}),
      isBestTierAvailable: () => false,
    });
    const result = await tool.execute(
      "call-1",
      { voice: "vivian", speed: 1.25, instructions: "嗲一点" },
      undefined,
      undefined,
      undefined as never,
    );

    const payload = JSON.parse(
      (result as { content: { text: string }[] }).content[0]!.text,
    ) as Record<string, unknown>;
    expect(payload).toMatchObject({
      voice: "vivian",
      speed: 1.25,
      instructions: "嗲一点",
      effective: { voice: false, speed: true, instructions: false },
    });
  });
});
