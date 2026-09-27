import { describe, expect, it } from "vitest";
import {
  API_PROVIDER_PRESETS,
  PI_AI_CURATED_PRESETS,
  getModelInputGuidance,
} from "../../shared/api-model-presets";

describe("OpenCode presets", () => {
  it("defines both Zen and Go presets with correct base URLs", () => {
    expect(API_PROVIDER_PRESETS.opencode.name).toBe("OpenCode");
    expect(API_PROVIDER_PRESETS.opencode.baseUrl).toBe(
      "https://opencode.ai/zen/v1",
    );
    expect(API_PROVIDER_PRESETS["opencode-go"].name).toBe("OpenCode Go");
    expect(API_PROVIDER_PRESETS["opencode-go"].baseUrl).toBe(
      "https://opencode.ai/zen/go/v1",
    );
  });

  it("curates opencode providers against the openai pi provider without pick filter", () => {
    expect(PI_AI_CURATED_PRESETS.opencode.piProvider).toBe("opencode");
    expect(PI_AI_CURATED_PRESETS.opencode.pick).toBeUndefined();
    expect(PI_AI_CURATED_PRESETS["opencode-go"].piProvider).toBe("opencode-go");
    expect(PI_AI_CURATED_PRESETS["opencode-go"].pick).toBeUndefined();
  });

  it("returns guidance for opencode providers", () => {
    expect(getModelInputGuidance("opencode").placeholder).toContain(
      "gpt-5.6-luna",
    );
    expect(getModelInputGuidance("opencode-go").placeholder).toContain(
      "gpt-5.6-luna",
    );
  });
});

describe("DeepSeek presets", () => {
  it("no longer offers the vision model deprecated by pi-ai 0.87.1", () => {
    // 0.85.1 的 deepseek 目录含 deepseek-v4-flash-vision-exp，0.87.1 只剩
    // deepseek-flash + deepseek-v4-pro。继续在原生 DeepSeek 预设里提供这个 id，
    // 会让选中它的人落到 opencode 条目（provider 与 baseUrl 一并变成 opencode）。
    const ids = API_PROVIDER_PRESETS.deepseek.models.map((m) => m.id);
    expect(ids).not.toContain("deepseek-v4-flash-vision-exp");
  });

  it("does not mention the deprecated vision model in deepseek guidance", () => {
    expect(getModelInputGuidance("deepseek").placeholder).not.toContain(
      "deepseek-v4-flash-vision-exp",
    );
  });

  it("includes the new deepseek-flash model in the DeepSeek provider preset", () => {
    const ids = API_PROVIDER_PRESETS.deepseek.models.map((m) => m.id);
    expect(ids).toContain("deepseek-flash");
  });

  it("mentions deepseek-flash in deepseek guidance placeholder", () => {
    expect(getModelInputGuidance("deepseek").placeholder).toContain(
      "deepseek-flash",
    );
  });

  it("offers exactly the two models DeepSeek officially lists", () => {
    // 官方现行只有 deepseek-flash（V4.1-Flash）与 deepseek-v4-pro；
    // deepseek-v4-flash 已是退役兼容名，留在预设里会让用户选到一个官方名义上不存在的 id。
    // 顺序也钉住：预设数组的原始顺序进不了模型菜单（getSortedPresetModels 会按 id 排序），
    // 但设置页的视觉模型建议 chips 按原始顺序取前 5 个（SettingsAPI.tsx:2001），
    // 所以别为了“看起来有序”重排这个数组。
    const ids = API_PROVIDER_PRESETS.deepseek.models.map((m) => m.id);
    expect(ids).toEqual(["deepseek-v4-pro", "deepseek-flash"]);
  });
});
