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
});
