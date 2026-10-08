import { describe, expect, expectTypeOf, it } from "vitest";
import {
  normalizeVoiceModeConfig,
  resolveTtsSource,
} from "../../shared/voice-mode";
import type { TtsErrorCode, TtsTone } from "../../shared/ipc-types";
import type {
  CloudErrorCode,
  CloudVoiceTier,
} from "../../main/tts/cloud/provider";

describe("voiceMode.cloud 归一化", () => {
  it("老配置（没有 source）→ 本机，其余字段原样保留", () => {
    const out = normalizeVoiceModeConfig({
      tone: "best",
      voiceEngineVoice: "vivian",
    });
    expect(resolveTtsSource(out)).toBe("local");
    expect(out.tone).toBe("best");
    expect(out.voiceEngineVoice).toBe("vivian");
  });

  it("云端块：字符串只留非空，models 只认三档键", () => {
    const out = normalizeVoiceModeConfig({
      source: "cloud",
      cloud: {
        provider: "doubao",
        baseUrl: "https://example.com/v1/",
        voiceId: "zh_female_vv_uranus_bigtts",
        models: { fast: "seed-tts-2.0-standard", 脏键: "x", best: "" },
        credentials: { doubao: { apiKey: "sk-1" } },
      },
    });
    expect(resolveTtsSource(out)).toBe("cloud");
    expect(out.cloud?.provider).toBe("doubao");
    expect(out.cloud?.baseUrl).toBe("https://example.com/v1/");
    expect(out.cloud?.voiceId).toBe("zh_female_vv_uranus_bigtts");
    expect(out.cloud?.models).toEqual({ fast: "seed-tts-2.0-standard" });
    expect(out.cloud?.credentials?.doubao?.apiKey).toBe("sk-1");
  });

  it("脏 source → 本机（字段缺省）；脏 cloud → 丢弃但不影响其它字段", () => {
    expect(resolveTtsSource({ source: "云" })).toBe("local");
    const out = normalizeVoiceModeConfig({
      source: 42,
      cloud: "nope",
      tone: "fast",
    });
    // 只在明确 cloud 时写字段：本机是「缺省」，不给每份配置多塞一个字段
    expect(out.source).toBeUndefined();
    expect(resolveTtsSource(out)).toBe("local");
    expect(out.cloud).toBeUndefined();
    expect(out.tone).toBe("fast");
  });
});

describe("可提取边界两侧的类型不许漂移", () => {
  it("CloudErrorCode ≡ TtsErrorCode；CloudVoiceTier ≡ TtsTone", () => {
    expectTypeOf<CloudErrorCode>().toEqualTypeOf<TtsErrorCode>();
    expectTypeOf<CloudVoiceTier>().toEqualTypeOf<TtsTone>();
  });
});
