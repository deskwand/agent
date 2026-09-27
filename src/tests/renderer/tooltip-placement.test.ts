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
    for (const file of [
      "components/AppRail.tsx",
      "components/HelpMenu.tsx",
      "components/AccountCluster.tsx",
    ]) {
      expect(read(file), `${file} 必须传 placement="right"`).toContain(
        'placement="right"',
      );
    }
  });

  // 说明（写在这里而不是只写在计划里）：jsdom 没有布局引擎，floating-ui 算出的
  // x/y 全为 0，**行为上区分不了 bottom 与 right**。所以方位只能做源码级断言 +
  // 手工验收，不要把它当成"位置已被单测证明"。
});
