import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { RENDERER } from "./theme-css-helpers";
import { RAIL_ITEMS } from "../../renderer/utils/nav-rail";

const read = (rel: string) => fs.readFileSync(path.join(RENDERER, rel), "utf8");
const rail = read("components/AppRail.tsx");
const app = read("App.tsx");

describe("AppRail", () => {
  it("is mounted in App.tsx next to the sidebar", () => {
    expect(app).toContain("<AppRail />");
    expect(app).toContain('from "./components/AppRail"');
  });

  it("renders one button per rail item, driven by RAIL_ITEMS", () => {
    expect(rail).toContain("RAIL_ITEMS.map");
    for (const item of RAIL_ITEMS) {
      expect(rail, item.key).toContain("t(item.labelKey)");
      expect(rail, item.key).toContain("resolveRailActiveKey");
    }
  });

  it("keeps the rail narrow, themed and non-resizable", () => {
    expect(rail).toContain("w-14");
    expect(rail).toContain("bg-background-secondary");
    expect(rail).not.toContain("ResizeHandle");
    expect(rail).not.toContain("sidebarWidth");
  });

  it("marks the active item and exposes an accessible name", () => {
    expect(rail).toContain('aria-label={t("navRail.label")}');
    expect(rail).toContain("aria-current");
    expect(rail).toContain("bg-overlay-on text-accent");
  });

  it("routes clicks through resolveRailClick so only chat can toggle the sidebar", () => {
    expect(rail).toContain("resolveRailClick");
    expect(rail).toContain("toggleSidebar()");
    expect(rail).toContain("setActiveView(");
    expect(rail).not.toContain("setActiveSession(");
  });

  it("does not add MENU_PANEL or native title attributes", () => {
    expect(rail).not.toContain("MENU_PANEL");
    expect(rail).not.toContain("<button title=");
  });
});

describe("Sidebar 不再承载导航", () => {
  const sidebar = read("components/Sidebar.tsx");

  it("drops every nav entry key that moved to the rail", () => {
    for (const key of ["sidebar.apps", "sidebar.vault", "sidebar.automation"]) {
      expect(sidebar, key).not.toContain(`t("${key}")`);
    }
  });

  it("drops the nav handlers", () => {
    expect(sidebar).not.toContain("const openApps = useCallback(");
    expect(sidebar).not.toContain("const openAutomation = useCallback(");
    expect(sidebar).not.toContain("const openVault = useCallback(");
  });

  // 侧栏现在只在聊天视图挂载，isActive 里那三个「让位」条件永远为真。
  // 它们是本次改动造成的孤儿，不是仓库原有死代码，所以一并清掉。
  it("drops the now-unreachable view guard flags", () => {
    // 明确的声明断言：not.toContain("showApps") 会被 setShowApps 侥幸放过
    expect(sidebar).not.toContain(
      'useAppStore((s) => s.activeView === "apps")',
    );
    expect(sidebar).not.toContain(
      'useAppStore((s) => s.activeView === "vault")',
    );
    expect(sidebar).not.toContain(
      'useAppStore((s) => s.activeView === "automation")',
    );
    expect(sidebar).not.toContain("!showApps");
    expect(sidebar).not.toContain("!showVault");
    expect(sidebar).not.toContain("!showSchedule");
  });
});

describe("账号簇在图标栏上", () => {
  const cluster = read("components/AccountCluster.tsx");
  const accountMenu = read("components/AccountMenu.tsx");
  const appRail = read("components/AppRail.tsx");

  it("renders the cluster inside the rail", () => {
    expect(appRail).toContain("<AccountCluster />");
  });

  it("owns the account menu and every dialog it opens", () => {
    for (const part of [
      "<AccountMenu",
      "<LoginModal",
      "<ConfirmDialog",
      "<UpdateConfirmDialog",
      "deskwand.cloud",
      "deleteProvider(",
    ]) {
      expect(cluster, part).toContain(part);
    }
  });

  it("keeps the account trigger reachable without the sidebar", () => {
    expect(cluster).toContain("sidebar.user");
    expect(cluster).toContain("avatarInitials");
    expect(cluster).toContain("useAppStore");
  });

  it("opens the account popover to the right of the rail", () => {
    expect(accountMenu).toContain("left-full");
    expect(accountMenu).not.toContain("bottom-full");
  });
});

describe("侧栏折叠行", () => {
  const sidebar = read("components/Sidebar.tsx");

  it("labels the two disclosure rows with recents and projects", () => {
    expect(sidebar).toContain('t("sidebar.recents")');
    expect(sidebar).toContain('t("sidebar.projects")');
    expect(sidebar).not.toContain('t("sidebar.allSessions")');
  });

  it("defaults recents to expanded and projects to collapsed", () => {
    const ordinary = sidebar.slice(
      sidebar.indexOf("const resolveOrdinarySessionsExpanded ="),
      sidebar.indexOf("const resolveProjectsExpanded ="),
    );
    expect(ordinary).toContain("?? true");
    const projects = sidebar.slice(
      sidebar.indexOf("const resolveProjectsExpanded ="),
      sidebar.indexOf("const ordinarySessionsExpanded ="),
    );
    expect(projects).toContain("projectGroups.some");
  });

  it("keeps a separate persisted key for the projects row", () => {
    expect(sidebar).toContain('const PROJECTS_GROUP_KEY = "__projects__";');
  });
});

describe("侧栏只挂在聊天视图", () => {
  it("gates the sidebar behind isSidebarAllowed and keeps the resize handle inside the gate", () => {
    expect(app).toContain("isSidebarAllowed(activeView)");
    const gate = app.slice(
      app.indexOf("isSidebarAllowed(activeView)"),
      app.indexOf("<main className="),
    );
    expect(gate).toContain(
      "<Sidebar width={sidebarWidth} dragging={isPanelDragging} />",
    );
    expect(gate).toContain("<ResizeHandle");
    expect(gate).toContain("{!sidebarCollapsed && (");
  });

  it("does not add a background-secondary literal to App.tsx", () => {
    // panel-boundary.test.ts 断言该字面量在 App.tsx 恰好出现 8 次
    expect(app.match(/bg-background-secondary/g)?.length).toBe(8);
  });
});
