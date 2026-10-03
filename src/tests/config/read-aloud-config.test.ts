import { describe, expect, it } from "vitest";
import {
  defaultStoredConfig,
  normalizeReadAloudConfig,
} from "../../main/config/config-store";

describe("read aloud config", () => {
  it("is off by default", () => {
    expect(defaultStoredConfig().readAloud).toEqual({ enabled: false });
  });

  it("falls back to off on garbage input", () => {
    expect(normalizeReadAloudConfig(undefined)).toEqual({ enabled: false });
    expect(normalizeReadAloudConfig({ enabled: "yes" })).toEqual({
      enabled: false,
    });
  });

  it("keeps an explicit true", () => {
    expect(normalizeReadAloudConfig({ enabled: true })).toEqual({
      enabled: true,
    });
  });
});
