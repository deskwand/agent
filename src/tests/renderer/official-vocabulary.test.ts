// 官方主题"可直接用"的可执行判据。
//
// 两条：
//   1) 每个主题块的每个官方变量与 registry 快照**逐值相等**（不是"差不多像"）
//   2) 旧 vocabulary 在源码里归零（漏改一处会静默退回继承色，不报错）
//
// drop-in 演练（人工，等价于第 1 条）：
//   把官方 neutral 的 `:root` 段粘贴进 .light[data-theme-preset="neutral"]、
//   官方 `.dark` 段粘贴进 :root[data-theme-preset="neutral"] → 本文件仍应全绿。
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import resolveConfig from "tailwindcss/resolveConfig";
import {
  RENDERER,
  blockBySelector,
  css,
  officialThemes,
  tokensOf,
} from "./theme-css-helpers";

const require = createRequire(import.meta.url);

/** 选择器约定：zinc 是默认槽位（:root / .light），其余 6 套带 data-theme-preset。 */
function selector(base: string, mode: "light" | "dark"): string {
  if (base === "zinc") return mode === "light" ? ".light" : ":root";
  return mode === "light"
    ? `.light[data-theme-preset="${base}"]`
    : `:root[data-theme-preset="${base}"]`;
}

describe("官方主题逐字可用", () => {
  const themes = officialThemes();
  const bases = Object.keys(themes);

  it("快照里有 7 套官方 base", () => {
    expect(bases.sort()).toEqual(
      ["mauve", "mist", "neutral", "olive", "stone", "taupe", "zinc"].sort(),
    );
  });

  for (const base of bases) {
    for (const mode of ["dark", "light"] as const) {
      it(`${base}/${mode} 与官方快照逐值相等`, () => {
        const sel = selector(base, mode);
        const block = blockBySelector(sel);
        expect(block, `globals.css 里缺块 ${sel}`).toBeTruthy();
        const got = tokensOf(block!);
        const mismatched: string[] = [];
        for (const [key, value] of Object.entries(themes[base][mode])) {
          if (got[`--${key}`] !== value) {
            mismatched.push(
              `--${key}: ${got[`--${key}`] ?? "(缺)"} ≠ ${value}`,
            );
          }
        }
        expect(
          mismatched,
          `${base}/${mode} 与官方值不一致：\n${mismatched.join("\n")}`,
        ).toEqual([]);

        // 键集合也必须逐字相等：多一个（偷偷塞本仓 token）或少一个（粘贴漏行）都要拦下，
        // 只比对上表会漏掉"快照里没有、块里却有"的那一类。
        expect(
          Object.keys(got).sort(),
          `${base}/${mode} 的变量集合与官方快照不一致`,
        ).toEqual(
          Object.keys(themes[base][mode])
            .map((k) => `--${k}`)
            .sort(),
        );
      });
    }
  }
});

describe("旧 vocabulary 已归零", () => {
  it("globals.css 里不再有自造主题 token", () => {
    // 只查**声明**（`--x:`），注释里提到旧名不算。
    const declarations = [...css.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map(
      (m) => m[1],
    );
    const dead = declarations.filter((name) =>
      /^--color-|^--(?:surface|background-secondary|border-muted|border-subtle|text-primary|text-secondary|text-muted|highlight|overlay|mention|mcp|tooltip|accent-muted|error-foreground)/.test(
        name,
      ),
    );
    expect(dead, `还有自造 token：\n${dead.join("\n")}`).toEqual([]);
  });

  it("源码里不再有旧 token 名的**字符串字面量**（vendored ui/ 除外）", () => {
    // 为什么单列一条：2026-10-10 的评审抓到两个 Critical —— UsageCalendarHeatmap 的
    // HIT_TOKEN 与 BrowserPanel 的 getPropertyValue("--color-background") 引用了已删的
    // token 名。它们都不是类名、也不在 globals.css 里，所以"类名归零"与"CSS 声明归零"
    // 两条守卫都看不见它们（命中模式的热力图整块没底色、空白页背景恒定用 fallback）。
    const OLD_TOKENS = [
      '"--color-',
      '"--surface',
      '"--overlay',
      '"--highlight"',
      '"--mention"',
      '"--text-primary"',
      '"--text-secondary"',
      '"--text-muted"',
      '"--background-secondary"',
      '"--tooltip',
      '"--border-muted"',
      '"--border-subtle"',
      '"--accent-muted"',
      '"--mcp"',
    ];
    const hits: string[] = [];
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) return e.name === "ui" ? [] : walk(p);
        return /\.(tsx?|css)$/.test(e.name) ? [p] : [];
      });
    for (const file of walk(RENDERER)) {
      const text = fs.readFileSync(file, "utf8");
      for (const stale of OLD_TOKENS) {
        if (text.includes(stale))
          hits.push(`${path.relative(RENDERER, file)}: ${stale}`);
      }
    }
    expect(hits, `旧 token 名字面量残留：\n${hits.join("\n")}`).toEqual([]);
  });

  it("源码里不再有旧类名（vendored ui/ 除外）", () => {
    // ⚠️ 这张表里**故意**写的是旧名字（它们的存在就是为了抓旧名字）——
    // 批量改名脚本会把它"顺手改成"新名字，改完这条断言就恒绿了（踩过一次）。
    const STALE = [
      "text-text-",
      "bg-surface",
      "bg-background-secondary",
      "bg-overlay-",
      "bg-highlight",
      "bg-background-chrome",
      "border-border-muted",
      "border-border-subtle",
      "text-mention",
      "bg-error",
      "text-error",
      "border-error",
      "bg-danger",
      "bg-panel",
      "border-border-primary",
    ];
    const hits: string[] = [];
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) return e.name === "ui" ? [] : walk(p);
        return /\.(tsx?|css)$/.test(e.name) ? [p] : [];
      });
    for (const file of walk(RENDERER)) {
      const text = fs.readFileSync(file, "utf8");
      for (const stale of STALE) {
        if (text.includes(stale)) {
          hits.push(`${path.relative(RENDERER, file)}: ${stale}`);
        }
      }
    }
    expect(hits, `旧类名残留：\n${hits.join("\n")}`).toEqual([]);
  });
});

describe("渲染层 CSS 的 theme() 引用仍然解析得出来", () => {
  // 为什么单列一条：改名脚本只看得见**类名**，看不见 CSS 里的 `theme("colors.x.Y")`
  // 路径。路径解析不出来时 Tailwind 不是报错——它把**整条规则**从产物里丢掉，
  // 于是 `.prose-chat blockquote` 的 margin / padding / 边框全没了、`.prose-chat .footnotes`
  // 的字号也没了，而构建照常成功、测试照常绿（2026-10-10 官方词汇表切换后实测）。
  //
  // 扫全部渲染层 CSS 而不是只有 globals.css：`pet/*.css` 今天一处 theme() 都没有，
  // 但新加一个 CSS 文件时不该靠人记得把守卫也挪过去（评审建议，成本是一行 walk）。
  const cssFiles = (function walk(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return walk(p);
      return e.name.endsWith(".css") ? [p] : [];
    });
  })(RENDERER);

  /** 引用（文件:行 + 路径 + 透明度修饰符）。注释里提到反例不算 —— 与同文件其它守卫同一口径。 */
  const refs = cssFiles.flatMap((file) =>
    fs
      .readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .flatMap((line, i) =>
        [...line.matchAll(/theme\(\s*"([^"]+)"\s*\)/g)].map((m) => ({
          where: `${path.relative(RENDERER, file)}:${i + 1}`,
          path: m[1].replace(/\s*\/.*$/, "").trim(),
          alpha: /\/\s*([^/]+)$/.exec(m[1])?.[1]?.trim(),
        })),
      ),
  );

  it("每个 theme() 路径都能在解析后的配置里找到", () => {
    // 数量断言防止正则悄悄匹配不到东西而假绿（当前 4 处，全在 globals.css）。
    expect(refs.length, "渲染层 CSS 里一条 theme() 都没有").toBeGreaterThan(0);

    const resolved = resolveConfig(require("../../../tailwind.config.js"));
    const lookup = (root: unknown, dotted: string): unknown =>
      dotted
        .split(".")
        .reduce<unknown>(
          (acc, part) =>
            acc === null || typeof acc !== "object"
              ? undefined
              : (acc as Record<string, unknown>)[part],
          root,
        );

    const missing = refs
      .filter((r) => lookup(resolved.theme, r.path) === undefined)
      .map((r) => `${r.where}  ${r.path}`);
    expect(
      missing,
      `以下 theme() 路径解析不出来（整条规则会被静默丢弃）：\n${missing.join("\n")}`,
    ).toEqual([]);
  });

  it("theme() 里的透明度不写百分号（calc 不许两个百分数相乘）", () => {
    // `theme("colors.x.DEFAULT / 40%")` 生成 `color-mix(… calc(40% * 100%), transparent)`，
    // 而 CSS 的 calc 不允许 % × % —— 声明非法，Chromium 把**整条**声明丢掉。
    // 实测（浏览器 getComputedStyle）：
    //   color-mix(in srgb, var(--primary) calc(40% * 100%), transparent) → border-left: 0px / none
    //   color-mix(in srgb, var(--primary) calc(0.4 * 100%), transparent)  → border-left: 3px / solid
    // 后果是 `.prose-chat blockquote` 的竖线从未渲染过（构建成功、无人报错）。
    // 类名路径不受影响：`border-border/40` 给的是小数；`bg-primary/[40%]` 这类由
    // token-alpha.test.ts 的产物断言兜住。
    const percent = refs
      .filter((r) => r.alpha?.endsWith("%"))
      .map((r) => `${r.where}  / ${r.alpha}`);
    expect(
      percent,
      `theme() 的透明度写小数（/0.4）而不是百分号（/40%）：\n${percent.join("\n")}`,
    ).toEqual([]);
  });
});
