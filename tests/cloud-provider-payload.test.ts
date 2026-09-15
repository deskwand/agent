import { describe, it, expect } from "vitest";
import { buildDeskwandProviderPayload } from "../src/renderer/utils/cloud-provider";

// pricing 接口按 model_id 升序返回，第一个即默认模型
const MODELS = [
  { model_id: "deepseek-flash" },
  { model_id: "deepseek-v4-pro" },
];

describe("buildDeskwandProviderPayload", () => {
  const payload = buildDeskwandProviderPayload(MODELS, "tok123");

  it("uses the custom:deskwand profile key", () => {
    expect(payload.profileKey).toBe("custom:deskwand");
  });

  it("points baseUrl at the API path (pi-ai appends /chat/completions)", () => {
    expect(payload.config.baseUrl).toBe("https://api.deskwand.com/api/models");
  });

  it("uses the real model ids as both id and label", () => {
    expect(payload.config.models).toEqual([
      { id: "deepseek-flash", label: "deepseek-flash" },
      { id: "deepseek-v4-pro", label: "deepseek-v4-pro" },
    ]);
  });

  it("never emits a mode label even when a translator is provided", () => {
    const t = (key: string, opts?: { defaultValue: string }) =>
      key === "providers.deskwandCloud" ? "DeskWand 云" : (opts?.defaultValue ?? key);
    const withT = buildDeskwandProviderPayload(MODELS, "tok123", t);
    expect(withT.config.models.map((m) => m.label)).toEqual([
      "deepseek-flash",
      "deepseek-v4-pro",
    ]);
    expect(withT.config.name).toBe("DeskWand 云");
  });

  it("defaults to the first model and carries the token as apiKey", () => {
    expect(payload.config.defaultModel).toBe("deepseek-flash");
    expect(payload.config.apiKey).toBe("tok123");
  });

  it("forces the OpenAI protocol so the server SSE endpoint is used", () => {
    expect(payload.config.customProtocol).toBe("openai");
  });

  it("keeps the user's previously chosen default model when it still exists", () => {
    // 启动重建 payload 不能把用户选过的默认模型静默改回第一个
    expect(
      buildDeskwandProviderPayload(MODELS, "tok123", undefined, "deepseek-v4-pro")
        .config.defaultModel,
    ).toBe("deepseek-v4-pro");
  });

  it("falls back to the first model when the previous default is gone", () => {
    expect(
      buildDeskwandProviderPayload(MODELS, "tok123", undefined, "retired-model")
        .config.defaultModel,
    ).toBe("deepseek-flash");
  });

  it("produces an empty model list for an empty response (caller must not overwrite)", () => {
    expect(buildDeskwandProviderPayload([], "tok123").config.models).toEqual([]);
  });
});
