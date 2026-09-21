// 侧栏分隔从 inset 阴影改成 1px 边框（上一轮设计文档 §4.3 规则 C：
// 阴影只保留给脱离文档流的悬浮层，侧栏分隔不是悬浮层）。
//
// 两件事必须锁住，否则都会静默出错：
//   1) 边框类必须在 sidebarCollapsed 的三元分支里 —— 折叠时 <aside> 是
//      width:0 且 Tailwind preflight 是 box-sizing:border-box，边框写在基类上
//      会留下一条 1px 竖线。
//   2) 旧的阴影机制不得回流。它当初（e436343）是为了让侧栏与主区分开而加的，
//      但暗色下合成对比只有 1.058–1.100，等于没分开。
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { RENDERER, css } from "./theme-css-helpers";

const sidebar = fs.readFileSync(
  path.join(RENDERER, "components/Sidebar.tsx"),
  "utf8",
);

describe("侧栏分隔线", () => {
  it("§9-8 用 1px 边框，且只在展开时画", () => {
    expect(sidebar).toContain("border-r border-border");
    // 边框必须与 sidebarCollapsed 的三元写在同一处
    expect(sidebar).toMatch(
      /sidebarCollapsed\s*\?\s*"w-0"\s*:\s*"[^"]*border-r border-border/,
    );
  });

  it("§9-8 旧的 inset 阴影机制已移除", () => {
    expect(sidebar).not.toContain("shadow-sidebar-sep");
    expect(sidebar).not.toContain("shadow-[inset");
    // 只查**声明**，不是任何提及：globals.css 里注释很多，
    // 用 not.toContain 会被一句解释性注释误触（那是假红，不是真问题）。
    const declarations = css.match(/--[\w-]*shadow-sidebar-sep\s*:/g) ?? [];
    expect(
      declarations,
      `--shadow-sidebar-sep 已零引用，声明也应删干净：${declarations.join(", ")}`,
    ).toEqual([]);
  });
});
