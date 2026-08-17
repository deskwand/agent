import { describe, expect, it } from "vitest";
import { defaultStoredConfig } from "../../main/config/config-store";

describe("defaultStoredConfig", () => {
  it("defaults the global memory switch to disabled", () => {
    expect(defaultStoredConfig().memoryEnabled).toBe(false);
  });

  it("defaults auto skill learning to disabled", () => {
    expect(defaultStoredConfig().autoSkillLearning).toBe(false);
  });
});
