import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { RENDERER } from "./theme-css-helpers";

const read = (rel: string) => fs.readFileSync(path.join(RENDERER, rel), "utf8");

describe("tooltip 方位", () => {
  it("rail 剩下的站点都显式传右侧，不靠默认值（图标右侧、垂直居中）", () => {
    // 意图与迁移前一字未变（「三处都显式右侧」）。宿主已全部迁到 Radix ⇒
    // 判据统一成 `side="right"`（HelpMenu / AccountMenu 在计划 12 相位 2 迁完，
    // AppRail 在本轮迁完）。
    //
    // ⚠️ 2026-10-10：rail 底部两处（HelpMenu 的「?」/ 升级按钮、AccountMenu 的
    // 头像）**去掉了气泡** ⇒ 「三处」变两处。计数从 3 改 2 的同时补了下面那条
    // 反向断言：不然「有人把气泡加回去」这里会静悄悄地绿。
    //
    // ⚠️ 必须点名 `<TooltipContent`：`side="right"` 在全仓**也出现在
    // `DropdownMenuContent` 上**（`AccountMenu:93`、`HelpMenu:119`）⇒ 裸断言
    // `toContain('side="right"')` 会被菜单那两处侥幸通过，而它们跟 tooltip 方位
    // 毫无关系。这正是仓库反复栽过的「判据假绿」（plan-12 §29 的裸 grep）。
    // ⚠️ 必须**计数**，不能用「存在至少一处」（`toContain`）—— AppRail 有 2 个站点：
    // 导航项（在 AppRail 里只有**一处** JSX 站点，按常驻组 + 固定组渲染多次）
    // 与语音项（`item.key === "chat"` 分支）。「更多」触发器**没有**气泡：
    // 这是设计选择（与栏底「?」/头像同族），**不是**技术禁区 —— 理由与「若日后要加」
    // 的链式约束写在 RailMoreMenu.tsx 的组件注释里。
    // 只查存在性时，把语音那处改成 `side="top"` 或整处删掉，判据**照样全绿** ✗
    //（审查员 2026-10-10 指出的假绿面）。
    const rail = read("components/AppRail.tsx");
    const railSites = rail.match(/<TooltipContent side="right"/g) ?? [];
    expect(
      railSites,
      'AppRail 的两处 TooltipContent 都要 side="right"',
    ).toHaveLength(2);
    expect(rail, "AppRail 不该再用旧组件的 placement prop").not.toContain(
      "placement=",
    );
    for (const file of [
      "components/HelpMenu.tsx",
      "components/AccountMenu.tsx",
    ]) {
      const source = read(file);
      // 反向断言：这两处**没有**气泡了。
      // 只钉组件与导入两个事实 —— 注释里提到 Tooltip 是允许的（AccountMenu 就
      // 留着一条「trigger 不能包在不透传 props 的组件里」的说明）。
      expect(source, `${file} 不该再挂 Tooltip 了`).not.toContain("<Tooltip");
      expect(source, `${file} 不该再导入 app-tooltip`).not.toContain(
        "app-tooltip",
      );
    }
  });

  it("Provider 的延迟仍是一个共享常量", () => {
    // 行为变化已记账：旧组件是 delay open 400ms（2026-09-27 设计决策 5 明确
    // 「保持 400ms 不变」），app-tooltip 的 Provider 是 200ms。统一之后 rail 也走
    // 200ms —— 这条把它钉住，改了要能红。
    expect(read("components/app-tooltip.tsx")).toMatch(/delayDuration=\{200\}/);
  });

  // 说明（写在这里而不是只写在计划里）：jsdom 没有布局引擎，Radix 算出的坐标
  // 不参与断言，**行为上区分不了 bottom 与 right**。所以方位只能做
  // 源码级断言 + 手工验收，不要把它当成"位置已被单测证明"。
});
