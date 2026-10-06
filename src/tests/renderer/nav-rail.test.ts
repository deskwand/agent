import { describe, expect, it } from "vitest";
import type { ActiveView } from "../../renderer/store";
import {
  RAIL_ITEMS,
  isSidebarAllowed,
  resolveRailActiveKey,
} from "../../renderer/utils/nav-rail";

const ALL_VIEWS: ActiveView[] = [
  "chat",
  "feed",
  "apps",
  "automation",
  "vault",
  "settings",
  "usage",
];

describe("RAIL_ITEMS", () => {
  it("pins the rail order and membership", () => {
    // 新增顶层视图时必须同步图标栏，否则这里失败
    expect(RAIL_ITEMS.map((item) => item.view)).toEqual([
      "chat",
      "feed",
      "automation",
      "apps",
      "vault",
      "usage",
    ]);
  });

  it("gives every item a unique key and a label key", () => {
    const keys = RAIL_ITEMS.map((item) => item.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const item of RAIL_ITEMS) {
      expect(item.labelKey, item.key).toMatch(/^[a-zA-Z]+\.[a-zA-Z]+$/);
    }
  });
});

describe("resolveRailActiveKey", () => {
  it("maps each view in the rail to its key", () => {
    expect(resolveRailActiveKey("chat")).toBe("chat");
    expect(resolveRailActiveKey("automation")).toBe("automation");
    expect(resolveRailActiveKey("apps")).toBe("apps");
    expect(resolveRailActiveKey("vault")).toBe("vault");
    expect(resolveRailActiveKey("usage")).toBe("usage");
  });

  it("returns null for settings because it lives in the bottom cluster", () => {
    expect(resolveRailActiveKey("settings")).toBeNull();
  });

  it("covers every view except settings", () => {
    for (const view of ALL_VIEWS) {
      if (view === "settings") continue;
      expect(resolveRailActiveKey(view), view).not.toBeNull();
    }
  });
});

describe("isSidebarAllowed", () => {
  it("allows the conversation sidebar only in the chat view", () => {
    expect(isSidebarAllowed("chat")).toBe(true);
    for (const view of ALL_VIEWS) {
      if (view === "chat") continue;
      expect(isSidebarAllowed(view), view).toBe(false);
    }
  });
});
