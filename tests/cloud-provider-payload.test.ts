import { describe, it, expect } from "vitest";
import { buildDeskwandProviderPayload } from "../src/renderer/utils/cloud-provider";

const MODES = [
  { id: "standard", name: "标准", model: "deepseek-v4-flash" },
  { id: "expert", name: "专家", model: "gpt-5.4" },
  { id: "coding", name: "编程", model: "deepseek-v4-pro" },
];

describe("buildDeskwandProviderPayload", () => {
  const payload = buildDeskwandProviderPayload(MODES, "tok123");

  it("uses the custom:deskwand profile key", () => {
    expect(payload.profileKey).toBe("custom:deskwand");
  });

  it("points baseUrl at the API path (pi-ai appends /chat/completions)", () => {
    expect(payload.config.baseUrl).toBe("https://api.deskwand.com/api/models");
  });

  it("maps modes to models with label (normalizeProviderModel keeps label only)", () => {
    expect(payload.config.models).toEqual([
      { id: "deepseek-v4-flash", label: "标准" },
      { id: "gpt-5.4", label: "专家" },
      { id: "deepseek-v4-pro", label: "编程" },
    ]);
  });

  it("defaults to the standard mode model and carries the token as apiKey", () => {
    expect(payload.config.defaultModel).toBe("deepseek-v4-flash");
    expect(payload.config.apiKey).toBe("tok123");
  });

  it("forces the OpenAI protocol so the server SSE endpoint is used", () => {
    expect(payload.config.customProtocol).toBe("openai");
  });
});
