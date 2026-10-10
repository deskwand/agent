import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { RENDERER } from "./theme-css-helpers";

const read = (rel: string) => fs.readFileSync(path.join(RENDERER, rel), "utf8");

describe("tooltip 方位", () => {
  it("默认仍是下方——否则 20+ 处气泡会集体挪位", () => {
    const tooltip = read("components/Tooltip.tsx");
    expect(tooltip).toMatch(/placement\?: "bottom" \| "right";/);
    expect(tooltip).toMatch(/placement = "bottom"/);
    // prop 必须真的传进 useFloating，否则它只是个没人用的声明。
    // 限定在 useFloating({ … }) 这一段内，避免文件里任意一行 placement, 就算过
    const from = tooltip.indexOf("useFloating({");
    const floating = tooltip.slice(from, tooltip.indexOf("})", from));
    expect(floating, "placement 必须传进 useFloating").toMatch(
      /^\s+placement,$/m,
    );
  });

  it("rail 三处显式传右侧（图标右侧、垂直居中）", () => {
    // 账号那一处的 Tooltip 在计划 5 里从 AccountCluster 移到了 AccountMenu ——
    // 因为 Radix 的 asChild 会把 trigger props/ref 交给它的**直接子元素**，
    // 而本仓的 Tooltip 不透传 props 也不 forwardRef，所以顺序必须是
    // Tooltip > Trigger asChild > (调用方的 button)，Tooltip 得在 menu 组件内。
    // 意图不变（三处都显式右侧），只是第三处的宿主换了文件。
    // ⚠️ 2026-10-09：宿主分成了两代 ✗✓ —— `AppRail.tsx` 仍用**老组件** `Tooltip.tsx`（吃 `placement` ✓），
    // 而另外两个已迁到 `app-tooltip`（Radix ✓，吃 `side` ✓）。
    // ⇒ **必须按文件分开断言** ✗（一刀切换成 `side` 会让 AppRail 那条失去意义 ✓）；**意图一字未变** ✓（「三处都显式右侧」✓）。
    expect(read("components/AppRail.tsx"), "AppRail 必须传 placement=\"right\"（老组件 ✓）").toContain(
      'placement="right"',
    );
    for (const file of ["components/HelpMenu.tsx", "components/AccountMenu.tsx"]) {
      expect(read(file), `${file} 必须传 side="right"（已迁到 app-tooltip ✓）`).toContain(
        'side="right"',
      );
    }
  });

  // 说明（写在这里而不是只写在计划里）：jsdom 没有布局引擎，floating-ui 算出的
  // x/y 全为 0，**行为上区分不了 bottom 与 right**。所以方位只能做源码级断言 +
  // 手工验收，不要把它当成"位置已被单测证明"。
});
