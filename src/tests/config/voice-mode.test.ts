import { describe, it, expect } from "vitest";
import {
  normalizeVoiceModeConfig,
  DEFAULT_VOICE_MODE,
} from "../../shared/voice-mode";

describe("normalizeVoiceModeConfig", () => {
  it("falls back to defaults for junk", () => {
    expect(normalizeVoiceModeConfig(undefined)).toEqual(DEFAULT_VOICE_MODE);
    expect(normalizeVoiceModeConfig("nope")).toEqual(DEFAULT_VOICE_MODE);
    expect(normalizeVoiceModeConfig({})).toEqual(DEFAULT_VOICE_MODE);
  });

  it("clamps the silence window into a sane range", () => {
    expect(normalizeVoiceModeConfig({ silenceMs: 10 }).silenceMs).toBe(400);
    expect(normalizeVoiceModeConfig({ silenceMs: 99999 }).silenceMs).toBe(2000);
    expect(normalizeVoiceModeConfig({ silenceMs: 900 }).silenceMs).toBe(900);
  });

  it("defaults the fast voice to on for configs written before it existed", () => {
    // 老配置里没有这个字段。默认必须是 true —— 默认成 false 会让已装音色的人
    // 悄悄从 1 秒变回 10 秒。
    expect(normalizeVoiceModeConfig({ silenceMs: 800 }).fastVoice).toBe(true);
    expect(normalizeVoiceModeConfig(undefined).fastVoice).toBe(true);
    expect(normalizeVoiceModeConfig({}).fastVoice).toBe(true);
  });

  it("keeps fastVoice false even when silenceMs is junk", () => {
    // 两个字段各自归一化。老实现是"silenceMs 不合法就整体返回默认值"，
    // 那样这一句会把用户关掉的开关打回 true。
    const out = normalizeVoiceModeConfig({
      silenceMs: "nope",
      fastVoice: false,
    });
    expect(out.fastVoice).toBe(false);
    expect(out.silenceMs).toBe(DEFAULT_VOICE_MODE.silenceMs);
  });

  it("keeps an explicit fastVoice either way", () => {
    expect(
      normalizeVoiceModeConfig({ silenceMs: 900, fastVoice: false }).fastVoice,
    ).toBe(false);
    expect(
      normalizeVoiceModeConfig({ silenceMs: 900, fastVoice: true }).fastVoice,
    ).toBe(true);
  });

  it("drops an unknown fastVoice value back to the default", () => {
    expect(
      normalizeVoiceModeConfig({ silenceMs: 900, fastVoice: "yes" }).fastVoice,
    ).toBe(true);
  });
  it("keeps the speech speed and style, clamping the speed into range", () => {
    const r = normalizeVoiceModeConfig({
      voiceSpeed: 9,
      voiceStyle: "「嗲一点」",
    });
    expect(r.voiceSpeed).toBe(2);
    expect(r.voiceStyle).toBe("「嗲一点」");
  });

  it("drops junk in the new fields without touching the others", () => {
    const r = normalizeVoiceModeConfig({
      tone: "best",
      voiceSpeed: "fast",
      voiceStyle: 42,
    });
    expect(r.voiceSpeed).toBeUndefined();
    expect(r.voiceStyle).toBeUndefined();
    expect(r.tone).toBe("best");
  });

  it("leaves the new fields absent for configs written before they existed", () => {
    const r = normalizeVoiceModeConfig({ fastVoice: false });
    expect(r.voiceSpeed).toBeUndefined();
    expect(r.voiceStyle).toBeUndefined();
  });
});
