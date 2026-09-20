// 设计文档 §3：拉丁打包 Geist，中文走系统栈并补 CJK 兜底。
// 族名不写死 —— 从 @fontsource 包的 @font-face 里读，再断言我们引用的就是那个名字。
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { RENDERER, css } from "./theme-css-helpers";

const tailwindConfig = fs.readFileSync(
  path.resolve(process.cwd(), "tailwind.config.js"),
  "utf8",
);
const mainTsx = fs.readFileSync(path.join(RENDERER, "main.tsx"), "utf8");

/**
 * 从 @fontsource 包里读**真实的** @font-face 族名。
 *
 * 不写死 "Geist Variable"：如果栈里写的族名与包里的 @font-face 不一致，字体根本不会加载，
 * 而只断言"字符串里有 Geist"的测试会绿着放过这个错误。这里把"包声明的族名"与
 * "我们引用的族名"直接对齐，写错就红。
 */
function packagedFamily(pkg: string): string {
  const indexCss = fs.readFileSync(
    path.resolve(
      process.cwd(),
      `node_modules/@fontsource-variable/${pkg}/index.css`,
    ),
    "utf8",
  );
  const m = /font-family:\s*['"]([^'"]+)['"]/.exec(indexCss);
  if (!m)
    throw new Error(`${pkg}/index.css 里找不到 @font-face 的 font-family`);
  return m[1];
}

const SANS_FAMILY = packagedFamily("geist");
const MONO_FAMILY = packagedFamily("geist-mono");

/** 非 macOS 的 CJK 兜底族：mac 只有 PingFang，Windows 只有雅黑，两者都不算真正的兜底，
 *  因为 Linux 上一个都没有（而仓库有 build:linux）。 */
const CJK_LINUX_FALLBACKS = [
  "Noto Sans CJK SC",
  "Noto Sans SC",
  "Source Han Sans SC",
  "WenQuanYi Micro Hei",
];

function fontFamilyDeclarations(source: string): string[] {
  return [...source.matchAll(/font-family:\s*([^;]+);/g)].map((m) => m[1]);
}

describe("字体栈", () => {
  it("打包并从入口引入 Geist 可变字体", () => {
    expect(mainTsx).toContain("@fontsource-variable/geist");
    expect(mainTsx).toContain("@fontsource-variable/geist-mono");
  });

  it("body 的字体栈以打包的族名开头且含 Linux CJK 兜底", () => {
    const body = /body\s*\{[\s\S]*?\}/.exec(css)?.[0];
    expect(body, "globals.css 里找不到 body 规则").toBeTruthy();
    const stack = fontFamilyDeclarations(body!)[0];
    expect(stack).toBeTruthy();
    // CSS 里族名带引号，取值时去掉包裹的引号再精确比较
    const firstFamily = stack
      .split(",")[0]
      .trim()
      .replace(/^["']|["']$/g, "");
    expect(
      firstFamily,
      `body 字体栈的第一个族名应为 @font-face 声明的族名：${stack}`,
    ).toBe(SANS_FAMILY);
    expect(
      CJK_LINUX_FALLBACKS.some((family) => stack.includes(family)),
      `body 字体栈缺 Linux CJK 兜底：${stack}`,
    ).toBe(true);
  });

  it("tailwind 的 sans 与 mono 栈用的是打包的族名", () => {
    expect(tailwindConfig).toContain(SANS_FAMILY);
    expect(tailwindConfig).toContain(MONO_FAMILY);
  });

  it("不再引用从未打包过的 JetBrains Mono", () => {
    expect(css).not.toContain("JetBrains Mono");
    expect(tailwindConfig).not.toContain("JetBrains Mono");
  });

  it("标题字体不再跳过拉丁直接落到中文族", () => {
    const heading = /\.heading-sans\s*\{[\s\S]*?\}/.exec(css)?.[0];
    expect(heading).toBeTruthy();
    expect(fontFamilyDeclarations(heading!)[0]).toContain(SANS_FAMILY);
  });

  it("每一处 monospace 字体栈都用打包的族名", () => {
    // 只断言 tailwind 配置不够：globals.css 里的 .prose-chat pre code 与
    // .prose-chat :not(pre) > code 是独立声明的，写错成 "Geist-Mono Variable"
    // 会静默回退到 Menlo 而不报错。
    const monoStacks = fontFamilyDeclarations(css).filter((stack) =>
      /monospace|mono/i.test(stack),
    );
    expect(monoStacks.length).toBeGreaterThan(0);
    for (const stack of monoStacks) {
      const first = stack
        .split(",")[0]
        .trim()
        .replace(/^["']|["']$/g, "");
      expect(
        first,
        `monospace 栈的第一个族名应为 ${MONO_FAMILY}：${stack}`,
      ).toBe(MONO_FAMILY);
    }
  });
});
