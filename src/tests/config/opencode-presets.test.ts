import { describe, expect, it } from "vitest";
import {
  defaultStoredConfig,
  enrichProviderModelsFromRegistry,
  getPiAiModelPresets,
  normalizeProviderConfig,
  profileKeyToProvider,
} from "../../main/config/config-store";
import { PI_AI_CURATED_PRESETS } from "../../shared/api-model-presets";

describe("OpenCode config integration", () => {
  it("maps opencode profile keys to their providers", () => {
    expect(profileKeyToProvider("opencode")).toEqual({
      provider: "opencode",
      customProtocol: "openai",
      preserveDynamicModels: true,
    });
    expect(profileKeyToProvider("opencode-go")).toEqual({
      provider: "opencode-go",
      customProtocol: "openai",
      preserveDynamicModels: true,
    });
  });

  it("seeds default profiles for both opencode plans", () => {
    const stored = defaultStoredConfig();
    expect(stored.providers).toBeDefined();
  });

  it("loads full registry models for opencode presets without pick filter", async () => {
    const presets = await getPiAiModelPresets();
    const zenModels = presets.opencode.models;
    const goModels = presets["opencode-go"].models;
    // 全量注册表模型（远超静态精选 9 个），且包含 Claude（协议感知路由依赖注册表）
    expect(zenModels.length).toBeGreaterThan(20);
    expect(zenModels.some((m) => m.id === "claude-sonnet-4-6")).toBe(true);
    expect(zenModels.some((m) => m.id === "gpt-5.6-luna")).toBe(true);
    expect(goModels.some((m) => m.id === "kimi-k3")).toBe(true);
    // Go 订阅不含 Claude
    expect(goModels.some((m) => m.id.startsWith("claude-"))).toBe(false);
  });

  it("keeps existing pick-filtered presets unchanged", async () => {
    const presets = await getPiAiModelPresets();
    const pick = PI_AI_CURATED_PRESETS.openrouter.pick?.length ?? 0;
    // openrouter 仍走 pick 过滤：数量 ≤ pick 长度且 > 0（注册表若缺个别 ID 可少）
    expect(presets.openrouter.models.length).toBeGreaterThan(0);
    expect(presets.openrouter.models.length).toBeLessThanOrEqual(pick);
  });

  it("preserves registry-enriched models for opencode profiles", async () => {
    const preserved = normalizeProviderConfig("opencode", {
      provider: "opencode",
      customProtocol: "openai",
      apiKey: "sk-test",
      baseUrl: "https://opencode.ai/zen/v1",
      defaultModel: "gpt-5.6-luna",
      models: [{ id: "gpt-5.6-luna", label: "gpt-5.6-luna", source: "preset" }],
      updatedAt: "2024-01-01T00:00:00.000Z",
    });
    // 动态 enrich 的模型被保留（不再是静态精选 9 个）
    expect(preserved.models.some((m) => m.id === "gpt-5.6-luna")).toBe(true);
    expect(preserved.models.length).toBe(1);
    // 未提供 models 时仍回退静态预设
    const fallback = normalizeProviderConfig("opencode", undefined);
    expect(fallback.models.length).toBeGreaterThan(0);
  });

  it("enriches opencode payloads with full registry models", async () => {
    const enriched = await enrichProviderModelsFromRegistry({
      profileKey: "opencode",
      config: {
        provider: "opencode",
        customProtocol: "openai",
        apiKey: "sk-test",
        baseUrl: "https://opencode.ai/zen/v1",
        defaultModel: "",
        models: [],
        updatedAt: "2024-01-01T00:00:00.000Z",
      },
    });
    expect(enriched.config.models.length).toBeGreaterThan(20);
    expect(
      enriched.config.models.some((m) => m.id === "claude-sonnet-4-6"),
    ).toBe(true);
    const goEnriched = await enrichProviderModelsFromRegistry({
      profileKey: "opencode-go",
      config: {
        provider: "opencode-go",
        customProtocol: "openai",
        apiKey: "sk-test",
        baseUrl: "https://opencode.ai/zen/go/v1",
        defaultModel: "",
        models: [],
        updatedAt: "2024-01-01T00:00:00.000Z",
      },
    });
    expect(goEnriched.config.models.some((m) => m.id === "kimi-k3")).toBe(true);
  });

  it("falls back to registry-first default when payload default is absent", async () => {
    const enriched = await enrichProviderModelsFromRegistry({
      profileKey: "opencode",
      config: {
        provider: "opencode",
        customProtocol: "openai",
        apiKey: "sk-test",
        baseUrl: "https://opencode.ai/zen/v1",
        defaultModel: "nonexistent-model",
        models: [],
        updatedAt: "2024-01-01T00:00:00.000Z",
      },
    });
    // defaultModel 不在 enriched 集合中 → 回退注册表首个模型（且必须存在于集合内）
    expect(
      enriched.config.models.some((m) => m.id === enriched.config.defaultModel),
    ).toBe(true);
  });
});
