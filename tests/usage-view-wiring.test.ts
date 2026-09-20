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
    const loginOnly = menu.indexOf('t("auth.logout")');
    expect(entry).toBeGreaterThan(-1);
    expect(loginOnly).toBeGreaterThan(-1);
    // 标记已从「首个 isLoggedIn 分支」改为「登录专属的退出登录行」：身份区
    // 作为新的登录分支出现在用量统计之前，旧的 indexOf 标记不再可区分。
    // 真正的守卫是 jsdom 渲染测试 account-menu-structure.test.ts 的未登录用例
    // （渲染后仍有 usage 且无登录专属内容）；这里只保留一条源码级兑底。
    expect(entry).toBeLessThan(loginOnly);
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

  it("shows estimated cost on the card, in the table and in the total row", () => {
    const view = read("src/renderer/components/UsageView.tsx");
    expect(view).toContain("formatCost");
    expect(view).toContain("sumUnpricedCalls");
    expect(view).toContain('t("usage.cards.cost")');
    expect(view).toContain('t("usage.columns.cost")');
    // 合计行用的是 totals.cost（= 卡片上那个数），不是手工把有价行加起来；
    // ModelTable 拿不到 snapshot，所以必须显式传 totalCost prop
    expect(view).toContain("totalCost={snapshot.totals.cost}");
    expect(view).toContain("unpricedCalls");
  });

  it("ships the cost labels in both locales", () => {
    for (const locale of ["zh", "en"]) {
      const json = JSON.parse(
        read(`src/renderer/i18n/locales/${locale}.json`),
      ) as {
        usage: {
          cards: Record<string, string>;
          columns: Record<string, string>;
        };
      };
      expect(json.usage.cards.cost).toBeTruthy();
      expect(json.usage.cards.costHint).toBeTruthy();
      expect(json.usage.cards.costUnpriced).toContain("{{count}}");
      expect(json.usage.columns.cost).toBeTruthy();
    }
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

describe("usage currency wiring", () => {
  it("renders a menu built from the shared menu tokens", () => {
    // 自绘菜单而不是原生 select：原生展开菜单由 OS 绘制、跟系统外观走，
    // 不跟 app 主题走（浅色主题 + 深色系统会弹出系统深色菜单）
    const menu = read("src/renderer/components/usage/CurrencySelect.tsx");
    // 注释里若出现带尖括号的 select 字样会误伤这条；组件注释写的是「原生 select」
    expect(menu).not.toMatch(/<select[\s>]/);
    expect(menu).toContain("MENU_PANEL_PADDED_CLASS");
    expect(menu).toContain("MENU_ITEM_SELECTED_CLASS");
    expect(menu).toContain("USAGE_CURRENCIES.map");
    expect(menu).toContain('t("usage.currency")');
    // 触发按钮照抄输入框模型菜单的形态，不自己发明一套
    expect(menu).toContain(
      "rounded-2xl border border-border-subtle bg-background/60",
    );
  });

  it("uses the themed menu in the usage header instead of a native select", () => {
    const view = read("src/renderer/components/UsageView.tsx");
    // 拆开断言：加一个 prop 就会被 prettier 折行，连在一起的子串会断
    expect(view).toContain("<CurrencySelect");
    expect(view).toContain("onChange={setCurrency}");
    expect(view).toContain('type: "usage.exchange-rate"');
    expect(view).not.toMatch(/<select[\s>]/);
  });

  it("keeps currency in the zustand store and persists it under a fixed key", () => {
    const store = read("src/renderer/store/index.ts");
    expect(store).toContain("currency: CurrencyCode");
    expect(store).toContain("currencyRate: number | null");
    expect(store).toContain('localStorage.setItem("deskwand.usageCurrency"');
    expect(store).toContain("i18nextLng");
  });

  it("defaults to CNY for a Chinese UI and USD otherwise", () => {
    const store = read("src/renderer/store/index.ts");
    expect(store).toContain('startsWith("zh")');
    expect(store).toContain('return "CNY"');
    expect(store).toContain('return "USD"');
  });

  it("converts every amount surface, including the heatmap tooltip", () => {
    const view = read("src/renderer/components/UsageView.tsx");
    // 分开断言，不锁定整行：prettier（printWidth 80）会把 `value={formatCost(...)}`
    // 这类长行折成多行，连在一起的子串会断
    // 断言格式免疫：prettier 会把长行折成多行（如 value={formatCost(\n …)}），
    // 所以只锁"调用点存在 + 参数出现"，不锁整行
    expect(view).toContain("snapshot.totals.cost,");
    expect(view).toContain("formatCost(row.cost");
    expect(view).toContain("formatCost(totalCost");
    expect(view).toContain("currencyRate, lang");
    const heat = read("src/renderer/components/usage/UsageCalendarHeatmap.tsx");
    expect(heat).toContain("formatCost(totalCostOf(rows)");
    expect(heat).toContain("formatCost(row.cost");
    expect(heat).toContain("currencyRate");
  });

  it("ships the label in both locales", () => {
    for (const locale of ["zh", "en"]) {
      const json = JSON.parse(
        read(`src/renderer/i18n/locales/${locale}.json`),
      ) as Record<string, Record<string, unknown>>;
      expect(json.usage?.currency).toBeTruthy();
    }
  });
});
