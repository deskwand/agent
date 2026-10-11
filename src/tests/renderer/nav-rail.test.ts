import { describe, expect, it } from "vitest";
import type { ActiveView } from "../../renderer/store";
import {
  RAIL_ITEMS,
  RAIL_MORE_ITEMS,
  RAIL_PRIMARY_ITEMS,
  isRailMoreCurrent,
  isSidebarAllowed,
  resolveRailActiveKey,
} from "../../renderer/utils/nav-rail";

const ALL_VIEWS: ActiveView[] = [
  "chat",
  "ideas",
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
      "ideas",
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

describe("RAIL_ITEMS 的 placement 分组", () => {
  it("每一项都显式声明 placement", () => {
    for (const item of RAIL_ITEMS) {
      expect(["rail", "more"], item.key).toContain(item.placement);
    }
  });

  it("常驻 = 聊天/灵感/动态，长尾 = 自动化/连接/密库/用量", () => {
    expect(RAIL_PRIMARY_ITEMS.map((i) => i.view)).toEqual([
      "chat",
      "ideas",
      "feed",
    ]);
    expect(RAIL_MORE_ITEMS.map((i) => i.view)).toEqual([
      "automation",
      "apps",
      "vault",
      "usage",
    ]);
  });

  it("两组不重叠、不漏项（真正的守门人是上面那条精确 toEqual：新视图不声明 placement 就红；这条只做制衡）", () => {
    const union = [...RAIL_PRIMARY_ITEMS, ...RAIL_MORE_ITEMS].map((i) => i.key);
    expect(new Set(union).size).toBe(RAIL_ITEMS.length);
    expect([...union].sort()).toEqual(RAIL_ITEMS.map((i) => i.key).sort());
  });
});

describe("isRailMoreCurrent", () => {
  it("长尾项未固定 → 高亮归「更多」", () => {
    expect(isRailMoreCurrent("vault", [])).toBe(true);
  });

  it("长尾项一旦固定 → 高亮回栏上那一格", () => {
    expect(isRailMoreCurrent("vault", ["vault"])).toBe(false);
    expect(isRailMoreCurrent("vault", ["apps", "vault"])).toBe(false);
  });

  it("常驻项与 settings（null）都不归「更多」", () => {
    expect(isRailMoreCurrent("chat", [])).toBe(false);
    expect(isRailMoreCurrent(null, [])).toBe(false);
    expect(isRailMoreCurrent(null, ["vault"])).toBe(false);
  });
});
