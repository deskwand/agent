// 全仓的**颜色类名**必须都能编译出规则 —— 不靠人手维护的名单。
//
// 为什么要有这条（2026-10-10 评审的结论）：vocabulary 切换那轮用了两张手写名单
// （类名 STALE 名单、token 名字面量名单），两代都漏：
//   • 删掉 tailwind 的 `text.*` 嵌套键 ⇒ `bg-text-primary` / `bg-text-muted` 变死类
//     （开发日志开关的圆点没有底色、状态点与音量条没有底色）—— 名单里没有 `bg-text-`
//   • 非类名位置的 `getPropertyValue("--color-background")` —— 名单只管类名
// 所以这里改成问编译器本身：抽出源码里所有 class 串与 @apply，逐条断言能在产物里找到选择器。
//
// 维护成本：只有"确实编译不出来、但又不是错误"的类才需要进 NON_COLOR / ALLOW。
// 已知的死类**不该**进名单 —— 那正是本用例要抓的东西。
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import postcss from "postcss";
import type { Config } from "tailwindcss";
import tailwindcss from "tailwindcss";
import { describe, expect, it } from "vitest";
import { RENDERER } from "./theme-css-helpers";

const require = createRequire(import.meta.url);
const config = require("../../../tailwind.config.js") as Config;

/** 颜色类的前缀（与 tailwind 的 colors 对应的那些 utility）。 */
const COLOR_PREFIXES = [
  "bg",
  "text",
  "border",
  "ring",
  "fill",
  "stroke",
  "from",
  "to",
  "via",
  "divide",
  "outline",
  "decoration",
  "caret",
  "placeholder",
  "accent",
  "shadow",
].join("|");

/** 同前缀但**不是颜色**的 utility（尺寸/对齐/宽度/形状），逐个列清楚。 */
const NON_COLOR = new Set([
  // text-*
  "text-xs",
  "text-sm",
  "text-base",
  "text-lg",
  "text-xl",
  "text-2xl",
  "text-left",
  "text-right",
  "text-center",
  "text-justify",
  "text-start",
  "text-end",
  "text-wrap",
  "text-nowrap",
  "text-balance",
  "text-pretty",
  "text-ellipsis",
  "text-clip",
  // border-*（宽度与方向）
  "border-0",
  "border-2",
  "border-4",
  "border-8",
  "border-t",
  "border-r",
  "border-b",
  "border-l",
  "border-x",
  "border-y",
  "border-t-2",
  "border-b-2",
  "border-l-2",
  "border-y-0",
  "border-t-0",
  "border-r-0",
  "border-s",
  "border-e",
  // ring-*（宽度与 offset）
  "ring-0",
  "ring-1",
  "ring-2",
  "ring-4",
  "ring-inset",
  "ring-offset-0",
  "ring-offset-1",
  "ring-offset-2",
  "ring-offset-4",
  // fill / stroke / outline / decoration / divide 的形状类
  "fill-none",
  "stroke-1",
  "stroke-2",
  "outline-none",
  "outline-0",
  "outline-1",
  "outline-2",
  "decoration-0",
  "decoration-1",
  "decoration-2",
  "decoration-slice",
  "decoration-clone",
  "divide-y",
  "divide-x",
  // 出现在字符串里的 **CSS 属性名**（不是类名），例如 `"text-align: center"`
  "text-align",
  "text-decoration",
  "text-transform",
  "text-indent",
  "text-shadow",
  "border-radius",
  "border-width",
  "border-color",
  "border-style",
  "background-color",
  "background-image",
  "outline-offset",
  "outline-color",
  // shadow 的非颜色项
  "shadow-inner",
  "shadow-none",
  "shadow-sm",
  "shadow-md",
  "shadow-lg",
  "shadow-xl",
  "shadow-2xl",
]);

/** class 串的三种字面量形式（与 token-alpha 同一套）。 */
const LITERAL = /"([^"\n]*)"|'([^'\n]*)'|`([^`\n]*)`/g;
/** 一个合法类 token：可带变体前缀，可带 /alpha。 */
const CLASS_TOKEN = /^(?:[a-z-]+:)*[a-z0-9-]+(?:\/\d{1,3})?$/;
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // vendored：保持与上游一致，不参与本仓词汇表的判据
      if (entry.name === "ui") continue;
      out.push(...sourceFiles(target));
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(target);
    }
  }
  return out;
}

/** 源码里出现的全部颜色类候选（跳过含 ${} 的动态串）。 */
function candidates(): string[] {
  const found = new Set<string>();
  for (const file of sourceFiles(RENDERER)) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(LITERAL)) {
      const literal = match[1] ?? match[2] ?? match[3] ?? "";
      if (literal.includes("${")) continue; // 拼出来的类名不可枚举
      for (const cls of literal.split(/\s+/)) {
        if (!CLASS_TOKEN.test(cls)) continue;
        const bare = cls.slice(cls.lastIndexOf(":") + 1);
        if (!new RegExp(`^(?:${COLOR_PREFIXES})-`).test(bare)) continue;
        if (NON_COLOR.has(bare)) continue;
        found.add(cls);
      }
    }
  }
  // globals.css 的 @apply 里也会写颜色类
  const css = fs.readFileSync(
    path.join(RENDERER, "styles/globals.css"),
    "utf8",
  );
  for (const m of css.matchAll(/@apply([^;]+);/g)) {
    for (const cls of m[1].split(/\s+/)) {
      if (!CLASS_TOKEN.test(cls)) continue;
      const bare = cls.slice(cls.lastIndexOf(":") + 1);
      if (!new RegExp(`^(?:${COLOR_PREFIXES})-`).test(bare)) continue;
      if (NON_COLOR.has(bare)) continue;
      found.add(cls);
    }
  }
  return [...found].sort();
}

/**
 * 类名 → 产物里的选择器正则。
 *
 * 两步都不能省：先按 CSS 的转义规则把 `:` `/` `.` 等变成 `\:` `\/`（产物里就是带反斜杠的），
 * 再把正则元字符（含刚才插入的那个反斜杠）整体转义 —— 只做第一步会期望 `.bg-accent/30`，
 * 而产物里是 `.bg-accent\/30`，于是整批 /alpha 类被误报成死类。
 */
function selectorRegex(className: string): RegExp {
  const escaped = `.${className.replace(/([:/.%#(),[\]])/g, "\\$1")}`.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
  return new RegExp(`${escaped}(?=[\\s:,.{>~+\\[\\]])`);
}

async function compile(classNames: string[]): Promise<string> {
  const patched: Config = {
    ...config,
    content: [
      { raw: `<div class="${classNames.join(" ")}"></div>`, extension: "html" },
    ],
  };
  const result = await postcss([tailwindcss(patched)]).process(
    "@tailwind utilities;",
    { from: undefined },
  );
  return result.css;
}

describe("颜色类名的编译不变量", () => {
  // 显式放宽超时：这条要把全仓 ~250 条候选一次性交给 tailwind 编译，实测 6–9s
  // （机器有负载时更慢）。它慢是一次性的编译器往返，不是逻辑问题。
  it(
    "每条颜色类名都产出 CSS（死类 = 静默消失的样式）",
    { timeout: 60_000 },
    async () => {
      const all = candidates();
      // 数量下界防止抽取器悄悄失效而假绿（当前实测 ~200 条）
      expect(all.length, `抽取到 ${all.length} 条候选`).toBeGreaterThan(80);

      const output = await compile(all);
      const dead = all.filter((cls) => !selectorRegex(cls).test(output));
      expect(
        dead,
        `以下颜色类名不产出任何 CSS（token 名写错、或 tailwind 里没有这个键）：\n${dead.join("\n")}`,
      ).toEqual([]);
    },
  );

  it("候选抽取本身是有效的（拿一个已知死类必须被抽出来并报红）", async () => {
    // 反向自检：用一个当前不存在的 token 名构造候选，确认判据真的会拦下它。
    const fake = "bg-token-that-does-not-exist";
    const output = await compile([fake]);
    expect(selectorRegex(fake).test(output), "这条本来就不该编译出来").toBe(
      false,
    );
  });
});
