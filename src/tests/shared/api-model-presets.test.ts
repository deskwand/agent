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
