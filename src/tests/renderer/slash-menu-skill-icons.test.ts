// @vitest-environment jsdom

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import { SlashMenu, type SlashTab } from "../../renderer/components/SlashMenu";
import type { Skill, SkillType } from "../../renderer/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const SKILL_ICON_CLASSES: Record<SkillType, string> = {
  builtin: "lucide-package",
  mcp: "lucide-plug",
  custom: "lucide-pencil",
  agent: "lucide-bot",
};
const SKILL_TYPES = Object.keys(SKILL_ICON_CLASSES) as SkillType[];

const skills: Skill[] = SKILL_TYPES.map((type, index) => ({
  id: `${index}`,
  name: `${type}-skill`,
  description: `${type} skill`,
  type,
  enabled: true,
  createdAt: index,
}));

function renderMenu(activeTab: SlashTab): Document {
  const html = renderToStaticMarkup(
    React.createElement(SlashMenu, {
      commands: [],
      skills,
      activeTab,
      selectedIndex: 0,
      onSelect: () => undefined,
      onTabChange: () => undefined,
    }),
  );

  return new JSDOM(html).window.document;
}

describe("SlashMenu skill source badges", () => {
  it.each<SlashTab>(["all", "skills"])(
    "renders Lucide icons instead of emoji in the %s view",
    (activeTab) => {
      const document = renderMenu(activeTab);
      const badges = [...document.querySelectorAll("span")].filter((element) =>
        SKILL_TYPES.some((type) => element.textContent?.trim().endsWith(type)),
      );

      expect(badges).toHaveLength(SKILL_TYPES.length);
      for (const type of SKILL_TYPES) {
        const badge = badges.find((element) =>
          element.textContent?.trim().endsWith(type),
        );
        expect(badge?.classList).toContain("text-text-muted");
        expect(badge?.querySelector("svg")?.classList).toContain(
          SKILL_ICON_CLASSES[type],
        );
        expect(badge?.querySelector("svg")?.classList).toContain(
          "text-text-muted",
        );
      }
      // eslint-disable-next-line no-misleading-character-class
      expect(document.body.textContent).not.toMatch(/[📦🔌✏️🤖]/u);
    },
  );
});
