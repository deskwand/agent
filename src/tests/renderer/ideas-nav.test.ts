import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { RAIL_ITEMS } from "../../renderer/utils/nav-rail";
import { ROOT } from "../ideas/helpers";

const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("rail 上的灵感", () => {
  it("有一格指向 ideas 视图", () => {
    const item = RAIL_ITEMS.find((i) => i.view === "ideas");
    expect(item).toBeDefined();
    expect(item?.labelKey).toBe("navRail.ideas");
  });

  it("紧跟在 chat 之后", () => {
    const views = RAIL_ITEMS.map((i) => i.view);
    expect(views[views.indexOf("ideas") - 1]).toBe("chat");
  });
});

// 图标映射与卡片都是组件里的实现细节，没有导出口；既有 rail 测试也是读源码字符串守的
// （见 app-rail-nav-entries.test.ts），这里沿用同一种守法。
describe("图标与「记一笔」入口", () => {
  const rail = read("src/renderer/components/AppRail.tsx");
  // 图标映射自 2026-10-11 拆到 rail-icons.ts（栏与「更多」菜单共用一份）
  const icons = read("src/renderer/components/rail-icons.ts");

  it("灵感与捕获键是同一颗图标（NotebookPen）", () => {
    // 曾经是「左栏灯泡 + 右上角纸笔」两颗不搭的图标，用户实测说割裂；现在两处同形。
    expect(icons).toMatch(/ideas:\s*NotebookPen/);
  });

  it("rail 卡片里有「记一笔」，键位按平台渲染", () => {
    expect(rail).toContain("ideas-rail-capture");
    expect(rail).toContain("captureShortcutLabel(");
    expect(rail).toContain("openIdeaCapture");
  });

  it("卡片靠 padding 搭桥，不许用 margin 留缝", () => {
    // 回归护栏：`ml-*` 会让按钮右边到卡片左边出现一条谁都不命中的死区，鼠标一过就断
    // hover，卡片消失且再也进不去（实测见 AppRail 那段注释）。真浏览器量的，见
    // design-docs/mockups/_repro-rail-card-hover.html。
    const cardClass = /left-full[^"]*/.exec(rail)?.[0] ?? "";
    expect(cardClass).toMatch(/\bpl-\d/);
    expect(cardClass).not.toMatch(/\bml-\d/);
  });

  it("卡片与 rail 那批 tooltip 对齐：间距 4px、以图标垂直居中", () => {
    // tooltip 侧：`ui/tooltip.tsx` 的 sideOffset = 4、Radix 默认 align = center。
    const cardClass = /left-full[^"]*/.exec(rail)?.[0] ?? "";
    expect(cardClass).toContain("pl-1"); // 4px，与 sideOffset 同一个数
    expect(cardClass).toContain("top-1/2");
    expect(cardClass).toContain("-translate-y-1/2");
    expect(cardClass).not.toContain("top-0");
  });

  it("卡片的可见性同时挂在 hover 与 focus-within 上（键盘也够得着）", () => {
    // 真实 hover 在 jsdom 里测不出来（纯 CSS），这里只锁住「两条路径都在」这个事实：
    // 少了 group-focus-within，键盘用户就永远看不到这张卡片。
    expect(rail).toContain("group-hover:visible");
    expect(rail).toContain("group-focus-within:visible");
  });

  it("卡片皮肤与 rail 的 tooltip 同一身；行动行不用 bg-accent", () => {
    // tooltip 那身：app-tooltip.tsx 的 APP_TOOLTIP_SKIN（bg-secondary + shadow-elevated）
    // + vendored 的 rounded-md。阴影在浅色下是唯一的分隔，别删。
    expect(rail).toContain(
      "bg-secondary p-2 text-secondary-foreground shadow-elevated",
    );
    expect(rail).toContain("rounded-md bg-secondary");
    // ⚠️ 陷阱：`--accent` 与 `--secondary` 同值（浅色/深色都实测 1.00）
    // ⇒ 行动行铺 bg-accent 会彻底隐形，必须用 bg-background。
    // 判据取**整颗按钮元素**（从 testid 到它的 `</button>`），不用固定字符窗口：
    // 2026-10-11 给这颗按钮加了 onClick（点过收起卡片），注释一长窗口就被顶出去、假红。
    const captureStart = rail.indexOf('data-testid="ideas-rail-capture"');
    const captureBtn = rail.slice(
      captureStart,
      rail.indexOf("</button>", captureStart),
    );
    expect(captureBtn).toContain("bg-background");
    expect(captureBtn).not.toContain("bg-accent");
  });

  it("标题栏那颗捕获键已经去掉（入口收敛到 rail 卡片）", () => {
    const titlebar = read("src/renderer/components/Titlebar.tsx");
    expect(titlebar).not.toContain("openIdeaCapture");
    expect(titlebar).not.toContain("NotebookPen");
  });
});
