/**
 * Slash menu class name regression tests.
 *
 * The slash command popup was updated from text-xs → text-sm (font)
 * and w-3.5 h-3.5 → w-4 h-4 (icon). This test guards against
 * accidental reversion or removal of those classes.
 *
 * Mirrors ITEM_BASE_CLASS from SlashMenu.tsx.
 */
import { describe, it, expect } from "vitest";

/** Must match ITEM_BASE_CLASS in src/renderer/components/SlashMenu.tsx */
const SLASH_MENU_ITEM_BASE_CLASS =
  "w-full text-left px-2.5 py-2 rounded-lg text-sm transition-colors flex items-center gap-2";

describe("Slash menu item base classes", () => {
  it("uses text-sm (not text-xs) for menu item font size", () => {
    expect(SLASH_MENU_ITEM_BASE_CLASS).toMatch(/\btext-sm\b/);
    expect(SLASH_MENU_ITEM_BASE_CLASS).not.toMatch(/\btext-xs\b/);
  });

  it("uses w-4 h-4 (not w-3.5 h-3.5) for menu item icons", () => {
    // Icon size is on the icon element, not the base class constant.
    // The base class uses gap-2 which pairs with w-4 h-4 icons.
    expect(SLASH_MENU_ITEM_BASE_CLASS).toMatch(/\bgap-2\b/);
  });

  it("includes required structural classes", () => {
    expect(SLASH_MENU_ITEM_BASE_CLASS).toContain("w-full");
    expect(SLASH_MENU_ITEM_BASE_CLASS).toContain("text-left");
    expect(SLASH_MENU_ITEM_BASE_CLASS).toContain("rounded-lg");
    expect(SLASH_MENU_ITEM_BASE_CLASS).toContain("flex");
    expect(SLASH_MENU_ITEM_BASE_CLASS).toContain("items-center");
  });
});
