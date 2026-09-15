/**
 * Slash menu 菜单行样式的回归测试。
 *
 * 原先这个文件把类名字符串抄写了一份做断言，抄写本身会与实现漂移。
 * 现在直接引用共享 token —— 实现改在哪，测试就测在哪。
 *
 * 注意：这里验的是 token 的取值，不是渲染结果。行尺寸与选中态的渲染断言在
 * slash-menu-skill-icons.test.ts，面板外壳的渲染断言在 attach-menu.test.ts
 * 与 merged-input-chip.test.ts。
 */
import { describe, it, expect } from "vitest";
import { MENU_ITEM_CLASS } from "../../renderer/components/menu-styles";

describe("Slash menu item base classes", () => {
  it("uses text-sm (not text-xs) for menu item font size", () => {
    expect(MENU_ITEM_CLASS).toMatch(/\btext-sm\b/);
    expect(MENU_ITEM_CLASS).not.toMatch(/\btext-xs\b/);
  });

  it("pairs gap-2 with the w-4 h-4 icons", () => {
    // 图标尺寸在图标元素上，不在基础类里 —— 真正的尺寸断言在
    // slash-menu-skill-icons.test.ts 的「uses 16px icons」用例（渲染 DOM 上验）。
    // 这里只锁住共享 token 与 16px 图标配对的间距。
    expect(MENU_ITEM_CLASS).toMatch(/\bgap-2\b/);
  });

  it("includes required structural classes", () => {
    expect(MENU_ITEM_CLASS).toContain("w-full");
    expect(MENU_ITEM_CLASS).toContain("text-left");
    expect(MENU_ITEM_CLASS).toContain("rounded-lg");
    expect(MENU_ITEM_CLASS).toContain("flex");
    expect(MENU_ITEM_CLASS).toContain("items-center");
  });
});
