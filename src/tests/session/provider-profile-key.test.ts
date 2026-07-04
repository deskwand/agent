import { describe, it, expect } from "vitest";
import { isProviderProfileKey } from "../../main/session/session-manager";

describe("isProviderProfileKey", () => {
  it("accepts built-in provider keys", () => {
    expect(isProviderProfileKey("openrouter")).toBe(true);
    expect(isProviderProfileKey("anthropic")).toBe(true);
    expect(isProviderProfileKey("openai")).toBe(true);
    expect(isProviderProfileKey("gemini")).toBe(true);
    expect(isProviderProfileKey("deepseek")).toBe(true);
  });

  it("accepts custom: prefixed profile keys", () => {
    expect(isProviderProfileKey("custom:abc-123")).toBe(true);
    expect(isProviderProfileKey("custom:my-provider")).toBe(true);
  });

  it("accepts oauth: prefixed profile keys", () => {
    expect(isProviderProfileKey("oauth:openai-codex")).toBe(true);
    expect(isProviderProfileKey("oauth:github-copilot")).toBe(true);
    expect(isProviderProfileKey("oauth:anthropic")).toBe(true);
  });

  it("rejects invalid values", () => {
    expect(isProviderProfileKey("")).toBe(false);
    expect(isProviderProfileKey(null as unknown as string)).toBe(false);
    expect(isProviderProfileKey(undefined as unknown as string)).toBe(false);
    expect(isProviderProfileKey("random-string")).toBe(false);
    expect(isProviderProfileKey("oauthtypo:openai-codex")).toBe(false);
  });
});
