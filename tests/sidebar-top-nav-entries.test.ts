import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const sidebarPath = path.resolve(
  process.cwd(),
  "src/renderer/components/Sidebar.tsx",
);
const accountMenuPath = path.resolve(
  process.cwd(),
  "src/renderer/components/AccountMenu.tsx",
);
const sidebarContent = readFileSync(sidebarPath, "utf8");
const accountMenuContent = readFileSync(accountMenuPath, "utf8");

describe("Sidebar top nav entries", () => {
  it("renders three entries above the session search bar", () => {
    const searchBarIndex = sidebarContent.indexOf(
      't("sidebar.searchPlaceholder")',
    );
    expect(searchBarIndex).toBeGreaterThan(-1);
    for (const key of [
      't("sidebar.skillsCloud")',
      't("sidebar.plugins")',
      't("sidebar.automation")',
    ]) {
      const index = sidebarContent.indexOf(key);
      expect(index, `${key} must exist in Sidebar.tsx`).toBeGreaterThan(-1);
      expect(index, `${key} must appear above the search bar`).toBeLessThan(
        searchBarIndex,
      );
    }
  });

  it("drives active state from the three view flags", () => {
    for (const flag of ["showMarketplace", "showPlugins", "showSchedule"]) {
      expect(sidebarContent).toContain(flag);
    }
    const activeClassCount =
      sidebarContent.split("bg-surface-active border-l-accent").length - 1;
    // one per nav entry plus the pre-existing session item usage
    expect(activeClassCount).toBeGreaterThanOrEqual(3);
    expect(sidebarContent).toContain('aria-current={showMarketplace ? "page"');
  });

  it("switches views exclusively like other sidebar entries", () => {
    expect(sidebarContent).toContain("setShowMarketplace(true)");
    expect(sidebarContent).toContain("setShowPlugins(true)");
    expect(sidebarContent).toContain("setShowSchedule(true)");
  });
});

describe("AccountMenu slimmed down", () => {
  it("no longer exposes marketplace/plugins/automation entries", () => {
    expect(accountMenuContent).not.toContain("onOpenMarketplace");
    expect(accountMenuContent).not.toContain("onOpenPlugins");
    expect(accountMenuContent).not.toContain("onOpenAutomation");
    expect(accountMenuContent).not.toContain('t("sidebar.skillsCloud")');
    expect(accountMenuContent).not.toContain('t("sidebar.plugins")');
    expect(accountMenuContent).not.toContain('t("sidebar.automation")');
  });

  it("keeps settings, login and logout sections", () => {
    expect(accountMenuContent).toContain('t("sidebar.settings")');
    expect(accountMenuContent).toContain("onOpenLogin");
    expect(accountMenuContent).toContain("onLogout");
  });
});
