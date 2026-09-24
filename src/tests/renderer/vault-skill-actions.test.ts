import { describe, expect, it } from "vitest";
import { supportsLocalFileActions } from "../../renderer/components/settings/skill-actions";
import type { SkillType } from "../../renderer/types";

describe("skill action gates", () => {
  it("refuses local file actions for built-in and vault skills", () => {
    expect(supportsLocalFileActions("builtin")).toBe(false);
    expect(supportsLocalFileActions("vault")).toBe(false);
  });

  it("keeps local file actions for everything else", () => {
    const allowed: SkillType[] = ["custom", "agent", "mcp"];
    for (const type of allowed) {
      expect(supportsLocalFileActions(type), type).toBe(true);
    }
  });
});
