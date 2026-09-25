// 面板边界的不变量（2026-09-25 设计文档 §3 / §7）。
//
// 本文件的前身是 sidebar-divider.test.ts —— 它当时锁的是「侧栏必须有一根 1px 边框，
// 且不能退回 inset 阴影」。本轮把整套方案换成了底色差，那条不变量已经作废，
// 所以文件和主题一起改名。
//
// 现在锁三类问题，都是「不红、不报错，只是看起来不对」的那一类：
//   1) 区域级分界的三个位置不得再有单边描边
//   2) 旧的 inset 阴影机制不得回流（它当年的合成对比只有 1.058–1.100，等于没分开）
//   3) 右面板必须靠底色差分界，且活动标签不能与面板底色撞车
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { RENDERER } from "./theme-css-helpers";

const read = (rel: string) => fs.readFileSync(path.join(RENDERER, rel), "utf8");

describe("侧栏与标题栏：区域级分界不画线", () => {
  it("侧栏上没有任何 border-r", () => {
    // Sidebar.tsx 改造前只有一处 border-r（<aside> 上的 `border-r border-border`），
    // 整个文件都不该再有。
    expect(read("components/Sidebar.tsx")).not.toMatch(/\bborder-r\b/);
  });

  it("折叠时仍然是宽度 0，不再靠边框隐藏", () => {
    expect(read("components/Sidebar.tsx")).toMatch(
      /sidebarCollapsed\s*\?\s*"w-0"\s*:\s*""/,
    );
  });

  it("旧的 inset 阴影机制不得回流", () => {
    const sidebar = read("components/Sidebar.tsx");
    expect(sidebar).not.toContain("shadow-[inset");
    // 只查**声明**，不是任何提及：globals.css 里注释很多，
    // 用 not.toContain 会被一句解释性注释误触（那是假红，不是真问题）。
    const declarations =
      read("styles/globals.css").match(/--[\w-]*shadow-sidebar-sep\s*:/g) ?? [];
    expect(
      declarations,
      `--shadow-sidebar-sep 已零引用，声明也应删干净：${declarations.join(", ")}`,
    ).toEqual([]);
  });

  it("标题栏底部不再有描边", () => {
    // titlebar-drag 在 className 的**中间**，所以我不能只截到标记之后那段
    // （classNameAt 会漏掉写在标记前面的类名）—— 必须取整行。
    const line = read("components/Titlebar.tsx")
      .split("\n")
      .find((l) => l.includes("titlebar-drag"));
    expect(line, "找不到标题栏元素").toBeTruthy();
    expect(line).not.toMatch(/\bborder-b\b/);
  });
});

const PANEL_FILES = [
  "components/FilePreviewPanel.tsx",
  "components/BrowserPanel.tsx",
  "components/ReviewPanel.tsx",
  "components/FileBrowser.tsx",
];

describe("右面板：区域级分界靠底色差", () => {
  it("四个面板都不再画左边界", () => {
    for (const rel of PANEL_FILES) {
      // 这四个文件改造前的 border-l 总数恰好是 1/1/1/2，全部是本轮要删的
      expect(read(rel), `${rel} 不应再有 border-l`).not.toMatch(/\bborder-l\b/);
    }
  });

  it("四个面板都改用 background-secondary 当底", () => {
    for (const rel of PANEL_FILES) {
      expect(read(rel), `${rel} 缺少 bg-background-secondary`).toContain(
        "bg-background-secondary",
      );
    }
  });

  it("App.tsx 里的面板占位不再画线", () => {
    const app = read("App.tsx");
    expect(app).not.toContain("border-l border-border-subtle");
    // 改造前 App.tsx 一处 background-secondary 都没有，现在是这 8 处占位
    expect(app.match(/bg-background-secondary/g)?.length).toBe(8);
  });

  it("文件预览的活动标签抬到 surface，不与面板底同色", () => {
    // 面板底已经是 background-secondary；活动标签若还用它就会同色消失。
    // 这一条不红、不报错，只是标签看不见了 —— 所以必须单独锁。
    const preview = read("components/FilePreviewPanel.tsx");
    expect(preview).not.toContain(
      '"bg-background-secondary text-text-primary"',
    );
    expect(preview).toContain('"bg-surface text-text-primary"');
  });
});

/**
 * 同一块表面内部的分隔线：从 `--color-border`（1.47–2.07）换成既有的一支软描边。
 *
 * 用**精确串**成对断言，不用宽正则 —— 宽正则（如 `border-[rltb] border-border\b`）会误伤
 * `border-border-muted`（`-` 是词边界，`\b` 照样成立），也会把以后合法的用法一起判红。
 *
 * 注意 UsageView 那一条的 `to` 半边是**空**的：`"border-b border-border-muted px-2`
 * 在文件里本来就有 3 次（表体 320/341/365），所以"必须有 to"永远成立。
 * 真正能拦住漏改的是 `not.toContain(from)` 那半边 —— 别因为看到它绿就以为两边都验到了。
 */
const IN_SURFACE_DIVIDERS: Array<{ file: string; from: string; to: string }> = [
  {
    file: "components/ScheduleCalendar.tsx",
    from: 'border-l border-border">',
    to: 'border-l border-border-muted">',
  },
  {
    file: "components/ScheduleCalendar.tsx",
    from: "border-b border-border sticky",
    to: "border-b border-border-muted sticky",
  },
  {
    file: "components/ScheduleCalendar.tsx",
    from: 'border-b border-border">',
    to: 'border-b border-border-muted">',
  },
  {
    file: "components/ScheduleToolbar.tsx",
    from: "border-b border-border bg-surface",
    to: "border-b border-border-muted bg-surface",
  },
  {
    file: "components/UsageView.tsx",
    from: '"border-b border-border px-2',
    to: '"border-b border-border-muted px-2',
  },
  {
    file: "components/SkillMdModal.tsx",
    from: 'border-b border-border">',
    to: 'border-b border-border-muted">',
  },
  {
    file: "components/settings/SettingsGeneral.tsx",
    from: 'border-t border-border">',
    to: 'border-t border-border-muted">',
  },
  {
    file: "components/ApiDiagnosticsPanel.tsx",
    from: "border-t border-border text-sm",
    to: "border-t border-border-muted text-sm",
  },
  {
    file: "components/ApiDiagnosticsPanel.tsx",
    from: "border-t border-border flex",
    to: "border-t border-border-muted flex",
  },
  {
    file: "components/SlashMenu.tsx",
    from: "border-t border-border shrink-0",
    to: "border-t border-border-subtle shrink-0",
  },
];

describe("表面内部的分隔线", () => {
  it("11 处全部换成弱描边，且旧串一处不剩", () => {
    for (const { file, from, to } of IN_SURFACE_DIVIDERS) {
      const src = read(file);
      expect(src, `${file} 缺少 ${to}`).toContain(to);
      expect(src, `${file} 仍然残留 ${from}`).not.toContain(from);
    }
  });
});

describe("文件预览面板：-muted 分隔线在新底色上是死的", () => {
  it("不得再有单边 -muted 分隔线", () => {
    // FilePreviewPanel 的整棵子树现在都在 background-secondary 上（根、标签栏、内容区），
    // 而 --color-border-muted 在新 secondary 上只有 1.004–1.017（暗色 5/7 个预设）。
    // 本轮已经因此删掉标签栏那根 border-b；Path row 那根是同一类，也必须删。
    // 只锁**单边分隔线**，不锁 `border` 全轮廓（那是控件外轮廓，不属于本轮）。
    expect(read("components/FilePreviewPanel.tsx")).not.toMatch(
      /border-[rltb] border-border-muted/,
    );
  });
});
