import { describe, expect, it } from "vitest";
import { defaultStoredConfig } from "../../main/config/config-store";

describe("defaultStoredConfig", () => {
  it("defaults the global memory switch to disabled", () => {
    expect(defaultStoredConfig().memoryEnabled).toBe(false);
  });
});
