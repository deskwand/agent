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

  it("translates mode labels via injected t with server name fallback", () => {
    const zhT = (key: string, opts?: { defaultValue: string }) =>
      ({ "modes.standard": "标准", "modes.coding": "编程" })[key] ??
      opts?.defaultValue ??
      key;
    const enT = (key: string, opts?: { defaultValue: string }) =>
      ({ "modes.standard": "Standard", "modes.coding": "Coding" })[key] ??
      opts?.defaultValue ??
      key;

    expect(
      buildDeskwandProviderPayload(MODES, "tok123", zhT).config.models.map(
        (m) => m.label,
      ),
    ).toEqual(["标准", "专家", "编程"]);

    expect(
      buildDeskwandProviderPayload(MODES, "tok123", enT).config.models.map(
        (m) => m.label,
      ),
    ).toEqual(["Standard", "专家", "Coding"]);
  });

  it("falls back to server names when no translator is provided", () => {
    expect(
      buildDeskwandProviderPayload(MODES, "tok123").config.models.map(
        (m) => m.label,
      ),
    ).toEqual(["标准", "专家", "编程"]);
    expect(buildDeskwandProviderPayload(MODES, "tok123").config.name).toBe(
      "DeskWand 云",
    );
  });

  it("defaults to the standard mode model and carries the token as apiKey", () => {
    expect(payload.config.defaultModel).toBe("deepseek-v4-flash");
    expect(payload.config.apiKey).toBe("tok123");
  });

  it("forces the OpenAI protocol so the server SSE endpoint is used", () => {
    expect(payload.config.customProtocol).toBe("openai");
  });
});
