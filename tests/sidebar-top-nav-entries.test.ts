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
  it("renders apps and automation entries inside the scrollable area below the search bar", () => {
    const searchBarIndex = sidebarContent.indexOf(
      't("sidebar.searchPlaceholder")',
    );
    expect(searchBarIndex).toBeGreaterThan(-1);
    const scrollAreaIndex = sidebarContent.indexOf("sidebar-scroll");
    expect(scrollAreaIndex).toBeGreaterThan(-1);
    const firstSectionIndex = sidebarContent.indexOf("<section>");
    expect(firstSectionIndex).toBeGreaterThan(-1);
    for (const key of ['t("sidebar.apps")', 't("sidebar.automation")']) {
      const index = sidebarContent.indexOf(key);
      expect(index, `${key} must exist in Sidebar.tsx`).toBeGreaterThan(-1);
      expect(
        index,
        `${key} must appear below the search bar (moved into scroll area)`,
      ).toBeGreaterThan(searchBarIndex);
      expect(
        index,
        `${key} must be inside the scrollable session area`,
      ).toBeGreaterThan(scrollAreaIndex);
      expect(
        index,
        `${key} must be at the top of the scroll area, before the first session section`,
      ).toBeLessThan(firstSectionIndex);
    }
    // no divider between the nav entries and the session list
    expect(sidebarContent).not.toContain(
      'className="mx-2 mt-2 border-t border-border-muted"',
    );
  });

  it("drives active state from the apps and schedule flags", () => {
    for (const flag of ["showApps", "showSchedule"]) {
      expect(sidebarContent).toContain(flag);
    }
    // active state is driven by the flags via background color only;
    // the accent left-border quote bar was removed per design
    const activeBgCount =
      sidebarContent.split('"bg-surface-active text-text-primary"').length - 1;
    // one per nav entry (apps + automation)
    expect(activeBgCount).toBeGreaterThanOrEqual(2);
    expect(sidebarContent).not.toContain("border-l-accent");
    expect(sidebarContent).not.toContain("border-l-[3px]");
    expect(sidebarContent).toContain('aria-current={showApps ? "page"');
  });

  it("switches views exclusively like other sidebar entries", () => {
    expect(sidebarContent).toContain("setShowApps(true)");
    expect(sidebarContent).toContain("setShowSchedule(true)");
  });

  it("no longer exposes separate skills cloud and plugins entries", () => {
    expect(sidebarContent).not.toContain('t("sidebar.skillsCloud")');
    expect(sidebarContent).not.toContain('t("sidebar.plugins")');
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
