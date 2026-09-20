/**
 * 弹出菜单共享样式 token 的回归测试。
 *
 * 锁三条不变量：
 *  1. 面板外壳的取值（统一后的圆角 / 边框 / 底 / 阴影）；
 *  2. 颜色与 hover 底色**不在** MENU_ITEM_CLASS 里 —— 必须由四个状态类承担。
 *     否则状态类要去覆盖基础类，而 Tailwind 同名属性的输出顺序由主题颜色定义顺序决定、
 *     不由 className 书写顺序决定，覆盖结果不可判定；
 *  3. 入场动画类存在，且旧的一次性动画 animate-account-menu-in 已清除。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  MENU_PANEL_CLASS,
  MENU_PANEL_PADDED_CLASS,
  MENU_ITEM_CLASS,
  MENU_ITEM_DEFAULT_CLASS,
  MENU_ITEM_SELECTED_CLASS,
  MENU_ITEM_DANGER_CLASS,
  MENU_ITEM_DISABLED_CLASS,
  MENU_LABEL_CLASS,
  MENU_SEPARATOR_CLASS,
} from "../../renderer/components/menu-styles";

const STATE_CLASSES = [
  MENU_ITEM_DEFAULT_CLASS,
  MENU_ITEM_SELECTED_CLASS,
  MENU_ITEM_DANGER_CLASS,
  MENU_ITEM_DISABLED_CLASS,
];

const utilities = (classString: string) =>
  classString.split(/\s+/).filter(Boolean);

describe("MENU_PANEL_CLASS", () => {
  it("统一外壳的四个类都在", () => {
    for (const cls of [
      "rounded-xl",
      "border-border-subtle",
      "bg-background",
      "shadow-elevated",
    ]) {
      expect(MENU_PANEL_CLASS).toContain(cls);
    }
  });

  it("不回退到 Tailwind 内置 shadow-lg，也不用实色边框", () => {
    expect(MENU_PANEL_CLASS).not.toContain("shadow-lg");
    // border-border-subtle 合法；裸的 border-border（后接空白的实色边框）不合法
    expect(MENU_PANEL_CLASS).not.toMatch(/border-border(?![-\w])/);
  });

  it("外壳自身不带内边距；PADDED 版就是它 + p-1", () => {
    expect(MENU_PANEL_CLASS).not.toMatch(/\bp-\d/);
    expect(MENU_PANEL_PADDED_CLASS).toBe(`${MENU_PANEL_CLASS} p-1`);
  });
});

describe("MENU_ITEM_CLASS", () => {
  it("只带结构与排版", () => {
    for (const cls of [
      "flex",
      "h-7",
      "w-full",
      "items-center",
      "gap-2",
      "rounded-lg",
      "px-2.5",
      "text-left",
      "text-sm",
      "transition-colors",
    ]) {
      expect(MENU_ITEM_CLASS).toContain(cls);
    }
  });

  it("用 text-sm 而不是 text-xs", () => {
    expect(MENU_ITEM_CLASS).toMatch(/\btext-sm\b/);
    expect(MENU_ITEM_CLASS).not.toMatch(/\btext-xs\b/);
  });

  it("不含任何颜色类与 hover 底色（否则状态类要覆盖它，结果不可判定）", () => {
    expect(MENU_ITEM_CLASS).not.toMatch(
      /text-(text-primary|text-secondary|text-muted|error|warning|accent)(?![-\w])/,
    );
    expect(MENU_ITEM_CLASS).not.toMatch(/hover:bg-/);
    expect(MENU_ITEM_CLASS).not.toMatch(/\bbg-/);
  });

  it("与四个状态类零重叠：叠加任意状态类都不会与基础类抢同一属性", () => {
    const base = new Set(utilities(MENU_ITEM_CLASS));
    for (const state of STATE_CLASSES) {
      for (const utility of utilities(state)) {
        expect(base.has(utility)).toBe(false);
      }
    }
  });

  it("四个状态类的取值就是契约本身", () => {
    expect(MENU_ITEM_DEFAULT_CLASS).toBe(
      "text-text-primary hover:bg-surface-hover",
    );
    expect(MENU_ITEM_SELECTED_CLASS).toBe("text-text-primary bg-surface-hover");
    expect(MENU_ITEM_DANGER_CLASS).toBe("text-error hover:bg-error/10");
    expect(MENU_ITEM_DISABLED_CLASS).toBe(
      "cursor-not-allowed text-text-muted opacity-50",
    );
  });
});

describe("MENU_LABEL_CLASS / MENU_SEPARATOR_CLASS", () => {
  it("分组标题是小号弱化文字", () => {
    expect(MENU_LABEL_CLASS).toContain("px-2.5");
    expect(MENU_LABEL_CLASS).toContain("py-1");
    expect(MENU_LABEL_CLASS).toContain("text-xs");
    expect(MENU_LABEL_CLASS).toContain("text-text-muted");
  });

  it("分隔线用 border-subtle，与统一后的面板边框同族", () => {
    expect(MENU_SEPARATOR_CLASS).toContain("border-t");
    expect(MENU_SEPARATOR_CLASS).toContain("border-border-subtle");
  });
});

describe("入场动画 CSS", () => {
  const globals = readFileSync(
    join(process.cwd(), "src/renderer/styles/globals.css"),
    "utf8",
  );

  it("两个方向的动画类都在", () => {
    expect(globals).toContain(".animate-menu-in-up {");
    expect(globals).toContain(".animate-menu-in-down {");
    expect(globals).toContain("@keyframes menu-in-up {");
    expect(globals).toContain("@keyframes menu-in-down {");
  });

  it("旧的一次性动画已清除，不留两套", () => {
    expect(globals).not.toContain("animate-account-menu-in");
    expect(globals).not.toContain("@keyframes account-menu-in");
  });

  it("两个动画类都进了 reduced-motion 白名单", () => {
    const reduceBlock = globals.slice(
      globals.indexOf("@media (prefers-reduced-motion: reduce)"),
    );
    expect(reduceBlock).toContain(".animate-menu-in-up,");
    expect(reduceBlock).toContain(".animate-menu-in-down {");
  });
});
