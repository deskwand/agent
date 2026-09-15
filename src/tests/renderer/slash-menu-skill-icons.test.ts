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

/**
 * 行尺寸的**真**断言：在渲染出的 DOM 上验，而不是在常量字符串上猜。
 * （原先 slash-menu-classes.test.ts 里那条“uses w-4 h-4 …”的用例只断言了
 * 共享 token 含 gap-2，无论图标多大都绿 —— 等于没守。）
 */
describe("SlashMenu menu rows", () => {
  function skillRows(): Element[] {
    const document = renderMenu("all");
    return [...document.querySelectorAll("button")].filter((element) =>
      element.textContent?.trim().startsWith("/skill:"),
    );
  }

  it("carries the shared row tokens", () => {
    const rows = skillRows();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      for (const cls of ["h-9", "rounded-lg", "text-sm", "items-center"]) {
        expect(row.classList).toContain(cls);
      }
    }
  });

  it("uses 16px icons, not the old 14px", () => {
    for (const row of skillRows()) {
      const icon = row.querySelector("svg");
      expect(icon).not.toBeNull();
      expect(icon?.classList).toContain("w-4");
      expect(icon?.classList).toContain("h-4");
      expect(icon?.classList).not.toContain("w-3.5");
      expect(icon?.classList).not.toContain("h-3.5");
    }
  });

  it("does not paint the keyboard highlight in the old accent tint", () => {
    // selectedIndex=0 → 第一行是键盘高亮行
    const rows = skillRows();
    expect(rows[0]?.classList).toContain("bg-surface-hover");
    expect(rows[0]?.classList).not.toContain("bg-accent/10");
  });
});
