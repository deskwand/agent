import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

const repo = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(repo, p), "utf-8");

describe("usage view wiring", () => {
  it("adds an ActiveView member", () => {
    expect(read("src/renderer/store/index.ts")).toContain('"usage"');
  });

  it("renders UsageView from App", () => {
    const app = read("src/renderer/App.tsx");
    expect(app).toContain("UsageView");
    expect(app).toContain('activeView === "usage"');
  });

  it("puts the entry in the account menu, not in settings", () => {
    const menu = read("src/renderer/components/AccountMenu.tsx");
    expect(menu).toContain('t("accountMenu.usage")');
    expect(menu).toContain('setActiveView("usage")');
    // Assert on the settings tab definitions, not on the word "usage" anywhere
    // in the file (unrelated comments/keys could contain it).
    expect(read("src/renderer/components/SettingsPanel.tsx")).not.toMatch(
      /id:\s*"usage"/,
    );
  });

  it("keeps the entry reachable while logged out", () => {
    const menu = read("src/renderer/components/AccountMenu.tsx");
    const entry = menu.indexOf('t("accountMenu.usage")');
    const loginBranch = menu.indexOf("isLoggedIn && cloudConfig ?");
    expect(entry).toBeGreaterThan(-1);
    expect(loginBranch).toBeGreaterThan(-1);
    // Local stats need no account, so the item must sit above the branch that
    // only renders for a logged-in user.
    expect(entry).toBeLessThan(loginBranch);
  });

  it("ships both locales", () => {
    for (const locale of ["zh", "en"]) {
      const json = JSON.parse(
        read(`src/renderer/i18n/locales/${locale}.json`),
      ) as Record<string, Record<string, unknown>>;
      expect(json.usage?.title).toBeTruthy();
      expect(json.accountMenu?.usage).toBeTruthy();
      expect(json.usage?.cards).toBeTruthy();
      expect(json.usage?.colorMode).toBeTruthy();
    }
  });

  it("offers the today range first and ships its labels", () => {
    const view = read("src/renderer/components/UsageView.tsx");
    // 只断言意图（"1d" 在最前、且在 "7d" 之前），不锁 prettier 的换行/空格
    const ranges = view.match(/const RANGES = \[([^\]]*)\]/)?.[1] ?? "";
    expect(ranges.indexOf('"1d"')).toBeGreaterThan(-1);
    expect(ranges.indexOf('"1d"')).toBeLessThan(ranges.indexOf('"7d"'));
    for (const locale of ["zh", "en"]) {
      const json = JSON.parse(
        read(`src/renderer/i18n/locales/${locale}.json`),
      ) as { usage: { range: Record<string, string> } };
      expect(json.usage.range["1d"]).toBeTruthy();
    }
  });

  it("defines today as the default range in the shared contract", async () => {
    const { DEFAULT_USAGE_RANGE } = await import("../src/shared/usage");
    expect(DEFAULT_USAGE_RANGE).toBe("1d");
  });

  it("initialises the page from that constant, not a literal", () => {
    const view = read("src/renderer/components/UsageView.tsx");
    expect(view).toMatch(/useState<Range>\(DEFAULT_USAGE_RANGE\)/);
    expect(view).not.toContain('useState<Range>("30d")');
    // 默认只在初始化时生效：唯一的 setRange 调用点必须是区间按钮的点击处理。
    // （源码级断言抓不到“挂载后被 effect 覆盖”，但能抓住新增第二个写入口。）
    expect(view.match(/setRange\(/g) ?? []).toHaveLength(1);
  });

  it("always shows 53 weeks instead of switching on window width", () => {
    const view = read("src/renderer/components/UsageView.tsx");
    // 阈值删除后这个 hook 与三个常量都没有使用者了
    expect(view).not.toContain("useWindowSize");
    expect(view).not.toContain("WIDE_WINDOW_PX");
    expect(view).not.toContain("WEEKS_WIDE");
    expect(view).not.toContain("WEEKS_NARROW");
    expect(view).toMatch(/WEEKS = 53/);
    expect(view).toMatch(/weeks=\{WEEKS\}/);
  });

  it("keeps the heatmaps independent of the selected range", () => {
    const view = read("src/renderer/components/UsageView.tsx");
    expect(view).toContain("snapshot.byDay");
    expect(view).toContain("snapshot.byHour");
    // byDay/byHour come straight from the snapshot; only totals/byModel follow
    // the range switch.
    expect(view).not.toContain("byDay.filter");
  });
});
