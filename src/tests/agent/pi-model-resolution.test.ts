import { describe, expect, it } from "vitest";
import { resolvePiRouteProtocol } from "../../main/agent/pi-model-resolution";

describe("resolvePiRouteProtocol", () => {
  it("routes opencode providers to their registry provider names", () => {
    expect(resolvePiRouteProtocol("opencode")).toBe("opencode");
    expect(resolvePiRouteProtocol("opencode-go")).toBe("opencode-go");
  });

  it("keeps existing provider routing unchanged", () => {
    expect(resolvePiRouteProtocol("openrouter")).toBe("openai");
    expect(resolvePiRouteProtocol("deepseek")).toBe("openai");
    expect(resolvePiRouteProtocol("anthropic")).toBe("anthropic");
    expect(resolvePiRouteProtocol("gemini")).toBe("gemini");
  });
});
