import { describe, expect, it } from "vitest";
import { normalizeVoiceEmotionConfig } from "../../main/config/config-store";

describe("情感识别配置", () => {
  it("缺字段时默认关", () => {
    expect(normalizeVoiceEmotionConfig(undefined)).toEqual({ enabled: false });
  });

  it("只接受布尔值", () => {
    expect(normalizeVoiceEmotionConfig({ enabled: true })).toEqual({
      enabled: true,
    });
    expect(normalizeVoiceEmotionConfig({ enabled: "yes" })).toEqual({
      enabled: false,
    });
  });
});
