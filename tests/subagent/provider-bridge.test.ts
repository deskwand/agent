import { describe, expect, it } from "vitest";
import {
  buildDeskWandModelId,
  buildDeskWandProviderId,
  parseDeskWandProviderId,
} from "../../src/main/agent/subagent/provider-bridge";

describe("provider-bridge", () => {
  describe("buildDeskWandProviderId", () => {
    it('returns "deskwand:main-openai" for profile key "main-openai"', () => {
      expect(buildDeskWandProviderId("main-openai")).toBe(
        "deskwand:main-openai",
      );
    });

    it("handles profile key with dots", () => {
      expect(buildDeskWandProviderId("openai.work")).toBe("deskwand:openai.work");
    });
  });

  describe("parseDeskWandProviderId", () => {
    it("extracts profileKey from valid deskwand provider id", () => {
      expect(parseDeskWandProviderId("deskwand:main-openai")).toEqual({
        isDeskwand: true,
        profileKey: "main-openai",
      });
    });

    it("returns isDeskwand=false for non-deskwand provider", () => {
      expect(parseDeskWandProviderId("anthropic")).toEqual({
        isDeskwand: false,
      });
    });

    it("returns isDeskwand=false for empty string", () => {
      expect(parseDeskWandProviderId("")).toEqual({ isDeskwand: false });
    });

    it("returns isDeskwand=false for prefix-only string", () => {
      expect(parseDeskWandProviderId("deskwand:")).toEqual({
        isDeskwand: false,
      });
    });
  });

  describe("buildDeskWandModelId", () => {
    it("returns deskwand:<profileKey>/<modelId>", () => {
      expect(buildDeskWandModelId("main-openai", "gpt-5")).toBe(
        "deskwand:main-openai/gpt-5",
      );
    });
  });
});
