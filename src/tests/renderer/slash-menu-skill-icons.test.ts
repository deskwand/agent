// @vitest-environment jsdom

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import { SlashMenu, type SlashTab } from "../../renderer/components/SlashMenu";
import type { Skill, SkillType } from "../../renderer/types";
import type { SlashCommand } from "../../renderer/slash-commands";
import en from "../../renderer/i18n/locales/en.json";
import zh from "../../renderer/i18n/locales/zh.json";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const SKILL_TYPES: SkillType[] = [
  "builtin",
  "mcp",
  "custom",
  "agent",
  "vault",
  "external",
];

/** 徽章文案走 i18n：枚举值只用于数据层，界面显示的是这些 key 的译文。 */
const SKILL_TYPE_LABEL_KEY: Record<SkillType, string> = {
  builtin: "skillMarket.sourceBuiltin",
  mcp: "skillMarket.sourceMcp",
  custom: "skillMarket.sourceCustom",
  agent: "skillMarket.sourceAI",
  vault: "skillMarket.sourceVault",
  external: "skillMarket.sourceExternal",
};

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
      pinnedSkills: [],
      onToggleSkillPin: () => undefined,
    }),
  );

  return new JSDOM(html).window.document;
}

describe("SlashMenu skill source badges", () => {
  it.each<SlashTab>(["all", "skills"])(
    "renders the skill type as plain text with no icon in the %s view",
    (activeTab) => {
      const document = renderMenu(activeTab);
      const badges = badgeSpans(document);

      expect(badges).toHaveLength(SKILL_TYPES.length);
      for (const type of SKILL_TYPES) {
        const badge = badges.find(
          (element) =>
            element.textContent?.trim() === SKILL_TYPE_LABEL_KEY[type],
        );
        expect(badge?.classList).toContain("text-muted-foreground");
        // 三类徽章同构：徽章里不允许任何子元素（当年这里放的是 lucide 类型图标）。
        expect(badge?.querySelector("svg")).toBeNull();
      }
      // eslint-disable-next-line no-misleading-character-class
      expect(document.body.textContent).not.toMatch(/[📦🔌✏️🤖]/u);
    },
  );
});

/** 菜单行 = 带 text-left 的按钮（tab 按钮没有这个类）；徽章 = 行内最后一个 span。 */
function badgeSpans(document: Document): Element[] {
  return [...document.querySelectorAll("button.text-left")].flatMap((row) => {
    const last = row.lastElementChild;
    return last && last.tagName === "SPAN" ? [last] : [];
  });
}

/**
 * 行尺寸的**真**断言：在渲染出的 DOM 上验，而不是在常量字符串上猜。
 * （原先 slash-menu-classes.test.ts 里那条“uses w-4 h-4 …”的用例只断言了
 * 共享 token 含 gap-2，无论图标多大都绿 —— 等于没守。）
 */
describe("SlashMenu menu rows", () => {
  const SKILL_NAMES = SKILL_TYPES.map((type) => `${type}-skill`);

  /** 行 = 文本以某个已知技能名开头（菜单里不以名字开头的只有 tab 按钮与徽章）。 */
  function skillRows(): Element[] {
    const document = renderMenu("all");
    return [...document.querySelectorAll("button")].filter((element) =>
      SKILL_NAMES.some((name) => element.textContent?.trim().startsWith(name)),
    );
  }

  it("carries the shared row tokens", () => {
    const rows = skillRows();
    expect(rows).toHaveLength(SKILL_TYPES.length);
    for (const row of rows) {
      for (const cls of ["h-7", "rounded-lg", "text-sm", "items-center"]) {
        expect(row.classList).toContain(cls);
      }
    }
  });

  it("uses 16px icons, not the old 14px", () => {
    // 行首图标现在住在星标按钮里（技能行不再自己渲染 Sparkles），所以瞄准点跟着走：
    // 仍然是"在渲染出的 DOM 上量尺寸"，也仍然带"不是 14px"的反向条款。
    const pins = [
      ...renderMenu("all").querySelectorAll("[data-skill-pin] svg"),
    ];
    expect(pins).toHaveLength(SKILL_TYPES.length);
    for (const icon of pins) {
      expect(icon.classList).toContain("w-4");
      expect(icon.classList).toContain("h-4");
      expect(icon.classList).not.toContain("w-3.5");
      expect(icon.classList).not.toContain("h-3.5");
    }
  });

  it("does not paint the keyboard highlight in the old accent tint", () => {
    // selectedIndex=0 → 第一行是键盘高亮行
    const rows = skillRows();
    expect(rows[0]?.classList).toContain("bg-selected-surface");
    expect(rows[0]?.classList).not.toContain("bg-primary/10");
  });

  /**
   * 星标槽必须是 24px 宽（`MENU_ITEM_AFTER_SLOT_CLASS` 那笔账：6px 容器 + 24px 槽 + 4px = 34px）。
   *
   * 根因（2026-10-10 用户报障「slash 菜单图标没有对齐」）：星标按钮原先只写 `h-6 w-6`、
   * **不给 size 档**，而 `Button` 的缺省档带着 `px-4 py-2` —— `cn` 不会把 `px-4 py-2`
   * 当成 `h-6 w-6` 的冲突类删掉 ✗，border-box 的宽度下限又是内边距之和 ⇒ 槽位实测 **32px**。
   * 后果是两档偏移：星标比命令行的图标右 4px、技能行名右 8px（Chromium 实测 ✓），
   * 也就是用户看到的那一列图标没对齐。
   *
   * jsdom 不做布局 ⇒ 这里把判据锁在**机制层**：槽位由档位（或 `p-0`）给出，类名里不许有非零内边距。
   */
  it("keeps the pin slot 24px wide (no inherited default-size padding)", () => {
    const pins = [...renderMenu("all").querySelectorAll("[data-skill-pin]")];
    expect(pins).toHaveLength(SKILL_TYPES.length);
    for (const pin of pins) {
      for (const cls of ["h-6", "w-6"]) {
        expect(pin.classList).toContain(cls);
      }
      const padding = [...pin.classList].filter((token) =>
        /^(?:[a-z-]+:)*(?:p|px|py|pt|pb|pl|pr|ps|pe)-/.test(token),
      );
      // `p-0` 是等价的另一种写法（零内边距），留给将来的实现；非零的一律是回归。
      expect(padding.filter((token) => token !== "p-0")).toEqual([]);
    }
  });
});

/**
 * 徽章同构 + 去色回归：三类徽章（命令 / 插件命令 / 技能类型）必须是同一个元素形态。
 *
 * 区分来源不靠颜色 —— 命令 / 插件命令 / 技能由同一行的行图标（zap / package /
 * sparkles）承载；技能类型只由徽章文字承载（四个词差异明显）。10px 字号下多个
 * 色相的 /10 底在浅色主题里几乎不可辨，且 warning/accent 在本项目别处另有
 * 「警告 / 主色」语义。
 *
 * 断言写成"规则"（不许有任何 bg-*、不许出现任何色相文字 token、三类徽章的类名与
 * 属性名必须完全一致、不许有子元素）而不是逐个类名的黑名单：黑名单换个色 token 就漏了。
 */
describe("SlashMenu badges carry no colour", () => {
  const commands: SlashCommand[] = [
    {
      name: "compact",
      label: "compact",
      description: "compact",
      action: "compact",
      source: "builtin",
    },
    {
      name: "plan",
      label: "plan",
      description: "plan",
      action: "extension",
      source: "extension",
    },
  ];

  /** 徽章文案白名单由 SKILL_TYPES 与文案 key 派生，将来加第五种技能类型不会无关地撞红。 */
  const BADGE_TEXT = new RegExp(
    `^(slash\\.pluginCommand|chat\\.slashTabCommands|${Object.values(
      SKILL_TYPE_LABEL_KEY,
    )
      .map((key) => key.replace(/\\./g, "\\."))
      .join("|")})$`,
  );

  /** 任何色相文字 token 都算回归（text-muted-foreground 这类中性 token 不在内）。 */
  const HUE_TEXT = /text-(accent|warning|success|error|mcp|danger)\b/;

  /** 任何底色（含 hover:/focus: 变体）都算回归。 */
  const ANY_BACKGROUND = /(^|\s|:)bg-/;

  function renderAll(): Document {
    const html = renderToStaticMarkup(
      React.createElement(SlashMenu, {
        commands,
        skills,
        activeTab: "all",
        selectedIndex: 0,
        onSelect: () => undefined,
        onTabChange: () => undefined,
        pinnedSkills: [],
        onToggleSkillPin: () => undefined,
      }),
    );

    return new JSDOM(html).window.document;
  }

  it("renders every row badge as the same icon-free, untinted element", () => {
    const badges = badgeSpans(renderAll());
    expect(badges).toHaveLength(commands.length + SKILL_TYPES.length);

    // 三类徽章必须完全同构：同一个类名（顺序也一致）。
    expect(new Set(badges.map((badge) => badge.className)).size).toBe(1);

    // 属性名集合也必须一致 —— 只加在某一类徽章上的 title/data-* 同样是"不统一"。
    expect(
      new Set(
        badges.map((badge) =>
          [...badge.attributes]
            .map((attribute) => attribute.name)
            .sort()
            .join(","),
        ),
      ).size,
    ).toBe(1);

    for (const badge of badges) {
      // 白名单：确保拿到的是徽章而不是行的名字 span（名字 span 无 text-muted-foreground，不写也会红，
      // 但写出来对读者更诚实）。
      expect(badge.textContent?.trim()).toMatch(BADGE_TEXT);
      expect(badge.children).toHaveLength(0);
      expect(badge.className).toContain("text-muted-foreground");
      expect(badge.className).not.toMatch(HUE_TEXT);
      expect(badge.className).not.toMatch(ANY_BACKGROUND);
    }
  });

  it("keeps every menu row free of hue-tinted backgrounds", () => {
    const rows = [...renderAll().querySelectorAll("button.text-left")];
    expect(rows).toHaveLength(commands.length + SKILL_TYPES.length);
    expect(rows.map((row) => row.outerHTML).join("")).not.toMatch(
      // ⚠️ 2026-10-09 相位 4 ✓：原先 `/NN` 是**可选**的 ✗ ⇒ 会误伤 shadcn `Button` base 里的
      // `hover:bg-accent`（**无透明度** ✓，那是 hover 色、不是「淡色底」✗）。
      // 本条测试的名字就是「**free of hue-tinted backgrounds**」✓ ⇒ 收紧为**必须带 `/NN`** ✓✓
      //（`bg-accent/10` 这种淡色底才是它要拦的 ✓ —— 意图一字未改 ✓）。
      /bg-(accent|warning|success|mcp|error|danger)\/\d+/,
    );
  });
});

/**
 * 技能类型文案必须走 i18n。
 *
 * 之前徽章直接渲染枚举值 `{type}`，中文界面里就是 builtin / mcp / custom / agent
 * 四个英文词；去掉类型图标后，文字成了技能类型的**唯一**载体，所以这里同时钉住
 * 「渲染的是 key」与「两个语言包都真的提供了译文」。
 */
describe("SlashMenu skill type labels are localized", () => {
  /** 按 i18next 的方式解析点号路径（"a.b.c" → bundle.a.b.c）。 */
  function lookup(bundle: unknown, dotted: string): unknown {
    return dotted
      .split(".")
      .reduce<unknown>(
        (node, part) =>
          node && typeof node === "object"
            ? (node as Record<string, unknown>)[part]
            : undefined,
        bundle,
      );
  }

  const BUNDLES: Record<"zh" | "en", unknown> = { zh, en };

  const EXPECTED: Record<"zh" | "en", Record<SkillType, string>> = {
    zh: {
      builtin: "内置",
      mcp: "MCP",
      custom: "自定义",
      agent: "AI 生成",
      vault: "密库",
      external: "pi 目录",
    },
    en: {
      builtin: "Built-in",
      mcp: "MCP",
      custom: "Custom",
      agent: "AI Generated",
      vault: "Vault",
      external: "pi dirs",
    },
  };

  it("renders the i18n key, not the raw enum, for each skill type", () => {
    const texts = badgeSpans(renderMenu("all")).map((badge) =>
      badge.textContent?.trim(),
    );

    expect(texts).toEqual(
      SKILL_TYPES.map((type) => SKILL_TYPE_LABEL_KEY[type]),
    );
    for (const type of SKILL_TYPES) {
      expect(texts).not.toContain(type);
    }
  });

  it.each(["zh", "en"] as const)(
    "%s 语言包为四种技能类型提供了文案",
    (locale) => {
      const bundle = BUNDLES[locale];
      const actual = Object.fromEntries(
        SKILL_TYPES.map((type) => [
          type,
          lookup(bundle, SKILL_TYPE_LABEL_KEY[type]),
        ]),
      );

      expect(actual).toEqual(EXPECTED[locale]);
    },
  );
});
