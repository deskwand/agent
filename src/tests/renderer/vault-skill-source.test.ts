import { describe, expect, it } from "vitest";
import {
  SKILL_ICON_MAP,
  type SkillSource,
} from "../../renderer/components/settings/SkillCard";

describe("vault skill source", () => {
  it("has an icon mapping for the vault source", () => {
    expect(SKILL_ICON_MAP.vault).toBeDefined();
    expect(SKILL_ICON_MAP.vault.icon).toBeDefined();
  });

  it("uses semantic color tokens for every source", () => {
    for (const [source, entry] of Object.entries(SKILL_ICON_MAP)) {
      expect(entry.bgClass, `${source} bgClass`).toMatch(/^bg-/);
      expect(entry.iconClass, `${source} iconClass`).toMatch(/^text-/);
      // 禁止硬编码色值
      expect(entry.bgClass, `${source} bgClass`).not.toMatch(/#|rgb|hsl/);
      expect(entry.iconClass, `${source} iconClass`).not.toMatch(/#|rgb|hsl/);
    }
  });

  it("covers every declared source", () => {
    const sources: SkillSource[] = [
      "ai",
      "custom",
      "mycloud",
      "team",
      "builtin",
      "marketplace",
      "vault",
    ];
    for (const source of sources) {
      expect(SKILL_ICON_MAP[source], source).toBeDefined();
    }
  });
});
