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

/** Linux 上常见的 CJK **等宽**族名。都没有打包，只是兜底；命中不了会落到 generic monospace。 */
const CJK_MONO_FALLBACKS = [
  "Noto Sans Mono CJK SC",
  "Sarasa Mono SC",
  "WenQuanYi Micro Hei Mono",
];

/** CSS 里族名带引号，取值时去掉包裹的引号再比较。 */
function firstFamily(stack: string): string {
  return stack
    .split(",")[0]
    .trim()
    .replace(/^["']|["']$/g, "");
}

/**
 * 栈里第一个出现的 CJK 兜底族的下标；一个都没有则返回 -1。
 *
 * 必须用下标而不是「包含」：把 CJK 族排在 generic 关键字**之后**的栈，
 * 用 includes() 判断同样通过，但那是一个**永远不会被用到**的兜底——
 * 而 generic（Linux 上的 DejaVu 一类）通常没有 CJK 覆盖。
 */
/**
 * 把 font-family 值拆成族名列表，去掉引号与空白。
 *
 * 必须按逗号切分后**整项比较**，不能用子串 indexOf：
 *   - ui-monospace 包含子串 "monospace"，子串查找会先命中它，
 *     于是 generic 下标算成 0，而在它之后的 CJK 兜底全被判成"死兜底"；
 *   - "WenQuanYi Micro Hei" 是 "WenQuanYi Micro Hei Mono" 的前缀，同理会误配。
 */
function familiesOf(stack: string): string[] {
  return stack
    .split(",")
    .map((entry) => entry.trim().replace(/^["']|["']$/g, ""));
}

/**
 * 栈里第一个出现的 CJK 兜底族的下标；一个都没有则返回 -1。
 *
 * 必须用下标而不是「包含」：把 CJK 族排在 generic 关键字**之后**的栈，
 * 用 includes() 判断同样通过，但那是一个**永远不会被用到**的兜底——
 * 而 generic（Linux 上的 DejaVu 一类）通常没有 CJK 覆盖。
 */
function firstCjkIndex(stack: string, families: readonly string[]): number {
  const found = familiesOf(stack)
    .map((entry, i) => (families.includes(entry) ? i : -1))
    .filter((i) => i >= 0);
  return found.length > 0 ? Math.min(...found) : -1;
}

/** 某个族名在栈里的项下标（找不到为 -1）。整项比较，不做子串匹配。 */
function familyIndex(stack: string, family: string): number {
  return familiesOf(stack).indexOf(family);
}

function fontFamilyDeclarations(source: string): string[] {
  return [...source.matchAll(/font-family:\s*([^;]+);/g)].map((m) => m[1]);
}

describe("字体栈", () => {
  it("§9-5 打包并从入口引入 Geist 可变字体", () => {
    expect(mainTsx).toContain("@fontsource-variable/geist");
    expect(mainTsx).toContain("@fontsource-variable/geist-mono");
  });

  it("§9-5 每一处非 monospace 字体栈都用 Geist 且含 Linux CJK 兜底", () => {
    // 上一轮只断言了 body / .heading-sans，于是 .prose-chat 与 .message-user-text
    // 在没有 Geist、也没有 CJK 兜底的情况下让测试保持绿色——而它们管的正是
    // 聊天正文，一个 AI 聊天 app 里读得最多的文字。
    // 这里改成扫描全部声明，同类漏改不再可能发生。
    const sans = fontFamilyDeclarations(css).filter(
      (stack) => !/monospace|mono/i.test(stack),
    );
    expect(sans.length).toBeGreaterThan(0);
    // 收集全部违规再断言，一次报全：逐个 expect 的话只看到第一处，
    // 要跑好几遍才知道到底漏了几处。
    const problems = sans.filter((stack) => {
      if (firstFamily(stack) !== SANS_FAMILY) return true;
      const cjk = firstCjkIndex(stack, CJK_LINUX_FALLBACKS);
      const generic = familyIndex(stack, "sans-serif");
      // cjk < 0：没写兜底；cjk > generic：兜底排在 generic 之后，是死兜底
      return cjk < 0 || (generic >= 0 && cjk > generic);
    });
    expect(
      problems,
      `以下字体栈不符合要求（须以 ${SANS_FAMILY} 开头，且 Linux CJK 兜底必须排在 generic 之前）：\n${problems.join("\n\n")}`,
    ).toEqual([]);
  });

  it("§9-5 tailwind 的 sans 与 mono 栈用的是打包的族名", () => {
    expect(tailwindConfig).toContain(SANS_FAMILY);
    expect(tailwindConfig).toContain(MONO_FAMILY);
  });

  it("§9-5 不再引用从未打包过的 JetBrains Mono", () => {
    expect(css).not.toContain("JetBrains Mono");
    expect(tailwindConfig).not.toContain("JetBrains Mono");
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
      expect(
        firstFamily(stack),
        `monospace 栈的第一个族名应为 ${MONO_FAMILY}：${stack}`,
      ).toBe(MONO_FAMILY);
    }
  });

  it("§9-5 每一处 monospace 字体栈含 Linux CJK 兜底", () => {
    // .prose-chat pre code 显示的是助手生成的代码，里面常有中文注释。
    // generic monospace 在 Linux 上通常没有 CJK 覆盖 → 方块。
    const monoStacks = fontFamilyDeclarations(css).filter((stack) =>
      /monospace/i.test(stack),
    );
    expect(monoStacks.length).toBeGreaterThan(0);
    const problems = monoStacks.filter((stack) => {
      const cjk = firstCjkIndex(stack, CJK_MONO_FALLBACKS);
      const generic = familyIndex(stack, "monospace");
      return cjk < 0 || (generic >= 0 && cjk > generic);
    });
    expect(
      problems,
      `以下 monospace 栈缺 CJK 兜底，或兜底排在 generic monospace 之后（死兜底）：\n${problems.join("\n\n")}`,
    ).toEqual([]);
  });
});
