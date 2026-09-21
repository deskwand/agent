import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { canHandleBashInput } from "../../renderer/components/message/BashToolBlock";
import {
  RENDERER,
  composite,
  contrast,
  css,
  parseAlphaColor,
  rgbHex,
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

describe("命令执行卡片：不再模仿 macOS 窗口", () => {
  it("交通灯色值与旧 titlebar token 都不复活", () => {
    for (const hex of ["ff5f56", "ffbd2e", "27c93f"]) {
      expect(bashSource, `交通灯色值 ${hex} 复活了`).not.toContain(hex);
    }
    expect(bashSource).not.toContain("--color-terminal-titlebar-bg");
    expect(globalsCss).not.toContain("--color-terminal-titlebar-bg");
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
    // 必须精确匹配整段 style 值。写成前缀 "--color-terminal-divider" 会漏掉
    // --color-terminal-dividerX 这类改名 —— 变异测试实测过：改了名照样绿。
    expect(bashSource).toContain('"var(--color-terminal-divider)"');
    // 只有颜色没有宽度就没有线：border-b 在本组件里唯一出现一次，
    // 所以直接断言它在即可，不需要去匹配类名串（那会随重排假红）。
    expect(bashSource).toContain("border-b");
  });

  it("分隔线比通用 hairline 明显，且落在可见区间内", () => {
    const bases = themeBlocks().filter((b) =>
      /--color-terminal-bg\s*:/.test(b),
    );
    // 前提：终端色不随 6 个配色预设走。下面两条把该前提钉死：
    // 既有「只有两个基块声明 bg」，也有「divider 不被任何预设覆盖」。
    expect(bases.length).toBe(2);
    expect(
      globalsCss.match(/--color-terminal-divider\s*:/g) ?? [],
    ).toHaveLength(2);

    for (const block of bases) {
      const bg = tokenOf(block, "--color-terminal-bg");
      const lineOf = (token: string) => {
        // 边框画在元素自身背景之上（background-clip 默认 border-box）
        const edge = parseAlphaColor(tokenOf(block, token));
        return composite(bg, rgbHex(edge.rgb), edge.alpha);
      };
      const divider = contrast(lineOf("--color-terminal-divider"), bg);

      // 无阈值断言（真正的理由）：整行分隔线必须比通用 chip 描边更可辨。
      // --color-border-subtle 的 α=6% 是给小元件描边定的，用在这里实测渲染看不见 ——
      // 看不见就等于退回「无分隔线」，而分隔线正是这次保留 meta 行的唯一理由。
      expect(divider).toBeGreaterThan(
        contrast(lineOf("--color-border-subtle"), bg),
      );

      // 下限：globals.css 自己把对比 1.24 的元素称作「看不见」，所以不能停在那档。
      // （α=0.07 时 dark 只有 1.184，仍能过上面那条无阈值断言 —— 只有下限拦得住它。）
      expect(divider).toBeGreaterThanOrEqual(1.35);

      // 上限：这条线是发丝，不是硬分割线。α=0.30 时 dark 到 2.658。
      // 实测 dark 1.584 / light 1.447，落在 GitHub 代码块头部分隔线（1.551）同一区间。
      expect(divider).toBeLessThanOrEqual(1.75);
    }
  });
});
