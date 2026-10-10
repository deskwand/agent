import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { RENDERER } from "./theme-css-helpers";

const read = (rel: string) => fs.readFileSync(path.join(RENDERER, rel), "utf8");

describe("tooltip 方位", () => {
  it("rail 三处都显式传右侧，不靠默认值（图标右侧、垂直居中）", () => {
    // 意图与迁移前一字未变（「三处都显式右侧」）。宿主已全部迁到 Radix ⇒
    // 判据统一成 `side="right"`（HelpMenu / AccountMenu 在计划 12 相位 2 迁完，
    // AppRail 在本轮迁完）。
    //
    // ⚠️ 必须点名 `<TooltipContent`：`side="right"` 在全仓**也出现在
    // `DropdownMenuContent` 上**（`AccountMenu:93`、`HelpMenu:119`）⇒ 裸断言
    // `toContain('side="right"')` 会被菜单那两处侥幸通过，而它们跟 tooltip 方位
    // 毫无关系。这正是仓库反复栽过的「判据假绿」（plan-12 §29 的裸 grep）。
    const rail = read("components/AppRail.tsx");
    expect(rail, 'AppRail 必须给 TooltipContent 传 side="right"').toContain(
      '<TooltipContent side="right"',
    );
    expect(rail, "AppRail 不该再用旧组件的 placement prop").not.toContain(
      "placement=",
    );
    for (const file of [
      "components/HelpMenu.tsx",
      "components/AccountMenu.tsx",
    ]) {
      expect(
        read(file),
        `${file} 必须给 TooltipContent 传 side="right"`,
      ).toContain('<TooltipContent side="right"');
    }
  });

  it("Provider 的延迟仍是一个共享常量", () => {
    // 行为变化已记账：旧组件是 delay open 400ms（2026-09-27 设计决策 5 明确
    // 「保持 400ms 不变」），app-tooltip 的 Provider 是 200ms。统一之后 rail 也走
    // 200ms —— 这条把它钉住，改了要能红。
    expect(read("components/app-tooltip.tsx")).toMatch(/delayDuration=\{200\}/);
  });

  // 说明（写在这里而不是只写在计划里）：jsdom 没有布局引擎，Radix 与 floating-ui
  // 算出的坐标都不参与断言，**行为上区分不了 bottom 与 right**。所以方位只能做
  // 源码级断言 + 手工验收，不要把它当成"位置已被单测证明"。
});
