import { describe, it, expect, vi } from "vitest";

// Mock electron APIs before importing the module under test
vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
  shell: { openExternal: vi.fn() },
  dialog: { showMessageBox: vi.fn().mockResolvedValue({ response: 0 }) },
  clipboard: { readText: vi.fn().mockReturnValue(""), writeText: vi.fn() },
}));

// Mock shared-auth
const mockGet = vi.fn();
const mockRemove = vi.fn();
const mockLogin = vi.fn();
vi.mock("../agent/shared-auth", () => ({
  getSharedAuthStorage: vi.fn(() => ({
    get: mockGet,
    remove: mockRemove,
    login: mockLogin,
  })),
}));

// We can't easily import the module without triggering Electron module resolution
// in a Vitest context, but we can test the shared oauth-utils which contain
// the profile key helpers used by oauth-service.

import {
  oauthProfileKey,
  extractOAuthProviderId,
  isOAuthProfileKey,
} from "../../shared/oauth-utils";

describe("oauth-service helpers (via shared oauth-utils)", () => {
  describe("oauthProfileKey", () => {
    it("builds correct profile keys for all supported providers", () => {
      const providers = ["openai-codex", "github-copilot", "anthropic"];
      for (const id of providers) {
        const key = oauthProfileKey(id);
        expect(key).toBe(`oauth:${id}`);
        expect(isOAuthProfileKey(key)).toBe(true);
        expect(extractOAuthProviderId(key)).toBe(id);
      }
    });
  });

  describe("round-trip: oauthProfileKey → extractOAuthProviderId", () => {
    it("round-trips correctly", () => {
      const ids = ["openai-codex", "github-copilot", "anthropic", "xai", "qwen"];
      for (const id of ids) {
        const key = oauthProfileKey(id);
        const extracted = extractOAuthProviderId(key);
        expect(extracted).toBe(id);
      }
    });
  });

  describe("isOAuthProfileKey guards", () => {
    it("matches all OAuth keys", () => {
      expect(isOAuthProfileKey("oauth:openai-codex")).toBe(true);
      expect(isOAuthProfileKey("oauth:github-copilot")).toBe(true);
      expect(isOAuthProfileKey("oauth:anthropic")).toBe(true);
    });

    it("rejects non-OAuth keys", () => {
      expect(isOAuthProfileKey("openai")).toBe(false);
      expect(isOAuthProfileKey("custom:abc")).toBe(false);
      expect(isOAuthProfileKey("anthropic")).toBe(false);
      expect(isOAuthProfileKey("deepseek")).toBe(false);
      expect(isOAuthProfileKey("")).toBe(false);
    });
  });

  describe("extractOAuthProviderId safety", () => {
    it("handles keys without oauth prefix", () => {
      expect(extractOAuthProviderId("openai")).toBeUndefined();
      expect(extractOAuthProviderId("anthropic")).toBeUndefined();
      expect(extractOAuthProviderId("")).toBeUndefined();
    });

    it("handles blank key after prefix", () => {
      expect(extractOAuthProviderId("oauth:")).toBe("");
    });
  });
});
