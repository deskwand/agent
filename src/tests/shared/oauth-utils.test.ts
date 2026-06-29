import { describe, it, expect } from "vitest";
import {
  oauthProfileKey,
  extractOAuthProviderId,
  isOAuthProfileKey,
} from "../../shared/oauth-utils";

describe("oauthProfileKey", () => {
  it('returns "oauth:<providerId>"', () => {
    expect(oauthProfileKey("openai-codex")).toBe("oauth:openai-codex");
    expect(oauthProfileKey("github-copilot")).toBe("oauth:github-copilot");
    expect(oauthProfileKey("anthropic")).toBe("oauth:anthropic");
  });
});

describe("extractOAuthProviderId", () => {
  it("extracts provider ID from oauth: profile key", () => {
    expect(extractOAuthProviderId("oauth:openai-codex")).toBe("openai-codex");
    expect(extractOAuthProviderId("oauth:github-copilot")).toBe("github-copilot");
  });

  it("returns undefined for non-oauth keys", () => {
    expect(extractOAuthProviderId("openai")).toBeUndefined();
    expect(extractOAuthProviderId("custom:abc123")).toBeUndefined();
    expect(extractOAuthProviderId("anthropic")).toBeUndefined();
  });

  it("handles edge cases", () => {
    expect(extractOAuthProviderId("")).toBeUndefined();
    expect(extractOAuthProviderId("oauth:")).toBe("");
    // "oauth" prefix without colon is not an oauth key
    expect(extractOAuthProviderId("oauth")).toBeUndefined();
  });
});

describe("isOAuthProfileKey", () => {
  it("returns true for oauth: prefixed keys", () => {
    expect(isOAuthProfileKey("oauth:openai-codex")).toBe(true);
    expect(isOAuthProfileKey("oauth:xyz")).toBe(true);
  });

  it("returns false for non-oauth keys", () => {
    expect(isOAuthProfileKey("openai")).toBe(false);
    expect(isOAuthProfileKey("custom:abc")).toBe(false);
    expect(isOAuthProfileKey("")).toBe(false);
    expect(isOAuthProfileKey("oauth")).toBe(false);
  });
});
