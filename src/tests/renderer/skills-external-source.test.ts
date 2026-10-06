import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import en from "../../renderer/i18n/locales/en.json";
import { supportsLocalFileActions } from "../../renderer/components/settings/skill-actions";
import zh from "../../renderer/i18n/locales/zh.json";

const read = (relative: string) =>
  fs.readFileSync(path.join(process.cwd(), relative), "utf8");

describe("技能页的第三方来源", () => {
  it("两种语言都有第三方来源的文案", () => {
    for (const [lang, locale] of [
      ["zh", zh],
      ["en", en],
    ] as const) {
      const skills = (locale as { skills: Record<string, string> }).skills;
      const market = (locale as { skillMarket: Record<string, string> })
        .skillMarket;
      expect(
        skills.externalSkillsDesc,
        `${lang} 缺 externalSkillsDesc`,
      ).toBeTruthy();
      expect(
        skills.externalShadowed,
        `${lang} 缺 externalShadowed`,
      ).toBeTruthy();
      expect(market.filterExternal, `${lang} 缺 filterExternal`).toBeTruthy();
      expect(market.sourceExternal, `${lang} 缺 sourceExternal`).toBeTruthy();
    }
  });

  it("第三方技能不给本机文件操作（删除/发布会动别人的目录）", () => {
    expect(supportsLocalFileActions("external")).toBe(false);
    expect(supportsLocalFileActions("custom")).toBe(true);
  });

  it("SkillCard 认识 external 来源，页面把 type=external 映射过去", () => {
    expect(read("src/renderer/components/settings/SkillCard.tsx")).toContain(
      '"external"',
    );
    const page = read("src/renderer/components/settings/SettingsSkills.tsx");
    expect(page).toContain('s.type === "external"');
    expect(page).toContain('"external"');
  });
});
