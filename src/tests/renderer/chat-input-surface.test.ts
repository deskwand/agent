// 输入区在画布上浮起一档（spec §6）。
//
// 为什么锁源码字符串而不是渲染：这两处是**类名常量**，没有状态也没有条件分支，
// 渲染出来再断言等于把同一句话抄第二遍；而这个约定的失效方式恰恰是"有人把 bg-composer
// 改回 bg-muted"，那一步一定会经过这几行源码。
//
// 为什么还要按 14 个块算明度差：`bg-composer` 只是选对面，浮起靠的是 --composer 与
// --background 的差。这个差按块走（默认深色抬到 --card，其余 13 块仍是 --muted），
// 只验 `:root` 的话，其余块沉下去也不会红 —— 评审就是这么揪出来的。
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  RENDERER,
  composerTokenOf,
  contrast,
  themeBlocks,
  tokenOf,
} from "./theme-css-helpers";

const read = (rel: string) => fs.readFileSync(path.join(RENDERER, rel), "utf8");

function containerLine(rel: string): string {
  return (
    read(rel)
      .split("\n")
      .find((line) => line.includes("rounded-3xl border border-border")) ?? ""
  );
}

describe("输入区浮起", () => {
  for (const rel of ["components/ChatView.tsx", "components/WelcomeView.tsx"]) {
    it(`${rel} 的输入框容器用 bg-composer，不再用 bg-muted / bg-card`, () => {
      const row = containerLine(rel);
      expect(row, `${rel} 里找不到输入框容器行`).not.toBe("");
      expect(row).toContain("bg-composer");
      expect(row).not.toContain("bg-muted");
      // bg-card 是更早一版的写法：亮色下 --card ≡ --background，会让面板与画布同色。
      expect(row).not.toMatch(/(^|\s)bg-card(\s|"|`|$)/);
    });
  }

  // 暗色按浮起档（≥1.2），亮色只要看得见（≥1.05）：官方亮色的 --card 与 --background
  // 都是白，抬起来等于没有面板，所以亮色走的是 --muted（1.09–1.13）。
  it("14 个主题块里 --composer 都比 --background 看得见（暗 ≥1.2 / 亮 ≥1.05）", () => {
    const blocks = themeBlocks();
    expect(blocks.length, "主题块数量不对").toBe(14);
    const violations: string[] = [];
    for (const block of blocks) {
      const head = block.slice(0, 40).replace(/\s+/g, " ");
      // --composer 不写在主题块里，先按 CSS 规则解出它指向哪个 token（默认深色 = --card）。
      const gap = contrast(
        tokenOf(block, composerTokenOf(block)),
        tokenOf(block, "--background"),
      );
      const floor = block.trimStart().startsWith(".light") ? 1.05 : 1.2;
      if (gap < floor) violations.push(`${head} = ${gap.toFixed(2)}`);
    }
    expect(
      violations,
      `输入区面板与画布拉不开：\n${violations.join("\n")}`,
    ).toEqual([]);
  });
});
