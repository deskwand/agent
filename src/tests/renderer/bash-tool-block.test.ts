import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { canHandleBashInput } from "../../renderer/components/message/BashToolBlock";
import {
  RENDERER,
  css,
  parseAlphaColor,
  globalToken,
  themeBlocks,
  tokenOf,
} from "./theme-css-helpers";

describe("canHandleBashInput", () => {
  it("accepts valid input with command string", () => {
    expect(canHandleBashInput({ command: "npm run build" })).toBe(true);
  });

  it("accepts valid input with cmd alias", () => {
    expect(canHandleBashInput({ cmd: "npm test" })).toBe(true);
  });

  it("rejects undefined input", () => {
    expect(canHandleBashInput(undefined)).toBe(false);
  });

  it("rejects input with no command field", () => {
    expect(canHandleBashInput({ timeout: 30000 })).toBe(false);
  });

  it("rejects input with empty command", () => {
    expect(canHandleBashInput({ command: "" })).toBe(false);
  });

  it("rejects input with whitespace-only command", () => {
    expect(canHandleBashInput({ command: "   " })).toBe(false);
  });

  it("rejects input with non-string command (number)", () => {
    expect(canHandleBashInput({ command: 123 })).toBe(false);
  });

  it("rejects input with non-string command (null)", () => {
    expect(canHandleBashInput({ command: null })).toBe(false);
  });
});

// ── 显示层不变量（design-docs/2026-09-21-bash-block-no-macos-titlebar-design.md §6）──
// 用源码断言而非 jsdom 渲染：本组件顶部 4 个 useAppStore 选择器中有 2 个在无 sessionId
// 时返回新数组字面量（traceSteps / allMessages），zustand v5 + useSyncExternalStore 会告警
// 甚至死循环。同型先例：chat-visual-hierarchy / menu-token-adoption / sidebar-divider。
const bashSource = fs.readFileSync(
  path.join(RENDERER, "components/message/BashToolBlock.tsx"),
  "utf8",
);
// globals.css 用 theme-css-helpers 已经读好的那份（chat-visual-hierarchy.test.ts 同做法），
// 不在这里再解析一遍，避免两份快照漂移。
const globalsCss = css;

/** 拆成 {rgb, alpha}：终端分隔线是 rgba()，主题描边可能是 oklch(… / 10%)。 */
function parseHexLike(value: string): { rgb: [number, number, number]; alpha: number } {
  return parseAlphaColor(value);
}


describe("命令执行卡片：不再模仿 macOS 窗口", () => {
  it("交通灯色值与旧 titlebar token 都不复活", () => {
    for (const hex of ["ff5f56", "ffbd2e", "27c93f"]) {
      expect(bashSource, `交通灯色值 ${hex} 复活了`).not.toContain(hex);
    }
    expect(bashSource).not.toContain("--terminal-titlebar-bg");
    expect(globalsCss).not.toContain("--terminal-titlebar-bg");
  });

  it("meta 行的 bash 标签仍在", () => {
    // 折行免疫：printWidth 80 下 <span className="font-medium">bash</span> 保持单行
    expect(bashSource).toContain(">bash<");
  });
});

describe("meta 行分隔线不会隐形", () => {
  // 这条锁的是「分隔线确实画在 meta 行上」而不是「token 的取值好看」。
  // 先例：menu-token-adoption.test.ts —— token 自己的取值由 menu-styles.test.ts
  // 锁住，那个文件锁的是每个菜单文件确实用了它。
  it("组件确实把 divider token 用在了 meta 行的下边框上", () => {
    // 必须精确匹配整段 style 值。写成前缀 "--terminal-divider" 会漏掉
    // --terminal-dividerX 这类改名 —— 变异测试实测过：改了名照样绿。
    expect(bashSource).toContain('"var(--terminal-divider)"');
    // 只有颜色没有宽度就没有线：border-b 在本组件里唯一出现一次，
    // 所以直接断言它在即可，不需要去匹配类名串（那会随重排假红）。
    expect(bashSource).toContain("border-b");
  });

  it("分隔线比通用 hairline 明显，且落在可见区间内", () => {
    // 2026-10-10：终端色搬进**固定语义层**（顶层 :root / :root.light），不再逐主题块声明。
    // 该前提（终端色不随配色预设走）改成两条更直接的断言：
    //   1) 14 个主题块里一个 --terminal-* 都不许有
    //   2) 固定语义层的两块各声明一次
    const inTheme = themeBlocks().filter((b) => /--terminal-/.test(b));
    expect(inTheme.length, "主题块里不该出现 terminal token").toBe(0);
    const layers = [...css.matchAll(/^:root(\.light)?\s*\{[\s\S]*?^\}/gm)].filter((m) =>
      /--terminal-bg\s*:/.test(m[0]),
    );
    expect(layers.length, "固定语义层应有暗/亮两块").toBe(2);

    const decl = globalToken("--terminal-divider");
    const hairline = tokenOf(themeBlocks()[0], "--border");
    // 分隔线必须比通用描边更"实"：终端色是固定值，描边是主题相关的浅色。
    const a = parseHexLike(decl);
    const b = parseHexLike(hairline);
    expect(a.alpha, "分隔线不该是透明的").toBeGreaterThan(b.alpha);
  });
});
