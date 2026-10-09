// shadcn 契约 → 本仓 token 的桥接不变量。
//
// 背景（设计文档 §5.1，v3 定稿）：本仓的 colors 键路径**必须等于** CSS 变量名
// ——这是 token-alpha.test.ts 锁定的既有不变量
//（断言 `token()({}) === var(--color-<键路径>)`）。
// 因此 shadcn 的契约名不能直接映射到本仓既有的变量名上（`primary` → `--color-accent`
// 会破那条不变量），而是在 globals.css 顶层 :root 里为契约名建立**同名别名变量**，
// 用 var() 指向本仓 token。var() 在使用时求值，所以 14 个主题块一处不用改。
//
// 由此本文件锁三件事：
//   1. **别名指向**：globals.css 里每个契约别名都指向预期的那条本仓 token
//      —— 指错不会报错，只在特定主题下静默显示错误的颜色
//   2. **config 就位**：每个契约名在 colors 里都存在且是 token() 函数色
//      —— 硬编码色值会绕过 14 套主题
//   3. **两个守卫**：accent 未提前翻转；本仓自有名未被契约名顶掉
//
// 注意：本文件在 tailwind 的 content 扫描范围内，**不要**写出完整的工具类字面量
// ——写了就会被当成用法、把那个类真的生成出来。类名一律用模板拼接生成。
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import type { Config } from "tailwindcss";
import { css } from "./theme-css-helpers";

const require = createRequire(import.meta.url);
const config = require("../../../tailwind.config.js") as Config;

type ColorFn = (args: { opacityValue?: string }) => string;

/**
 * 契约别名表：契约变量名 → 它应当指向的本仓 token。
 *
 * 只收录 vendored 文件实际用到的名字（spec §5.2：枚举后定稿，不凭猜）。
 * 枚举来源：`grep -rhoE '\b(bg|text|border|ring|…)-[a-z][a-z0-9-]*'
 * src/renderer/components/ui/*.tsx | sort -u`，去掉方向/布局类得下表。
 */
const CONTRACT_ALIASES: Array<[string, string]> = [
  // 品牌蓝：契约名 primary，指向本仓的品牌 token
  ["color-primary", "var(--color-accent)"],
  ["color-primary-hover", "var(--color-accent-hover)"],
  ["color-primary-muted", "var(--color-accent-muted)"],
  ["color-primary-foreground", "var(--color-accent-foreground)"],
  // 次级表面：本仓 .btn-secondary 就是 surface + text-primary
  ["color-secondary", "var(--color-surface)"],
  ["color-secondary-foreground", "var(--color-text-primary)"],
  // 危险操作
  ["color-destructive", "var(--color-error)"],
  ["color-destructive-foreground", "var(--color-error-foreground)"],
  // 正文与弱化文字
  ["color-foreground", "var(--color-text-primary)"],
  ["color-muted-foreground", "var(--color-text-muted)"],
  // 描边与焦点环
  ["color-input", "var(--color-border)"],
  ["color-ring", "var(--color-accent)"],
];

/** 去掉 CSS 注释后再匹配，避免注释里的示例声明被当成真声明。 */
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, "");

/** 读 globals.css 里某条自定义属性的字面值。 */
function declaredValue(prop: string): string | null {
  const m = new RegExp(`--${prop}\\s*:\\s*([^;]+);`).exec(cssNoComments);
  return m ? m[1].trim() : null;
}

/** 取某个 colors 键路径上的叶子，要求是 token() 函数。 */
function leafAt(path: string): ColorFn {
  let node: unknown = config.theme?.extend?.colors;
  for (const key of path.split(".")) {
    if (node === null || typeof node !== "object") {
      throw new Error(`colors 上找不到路径 ${path}`);
    }
    node = (node as Record<string, unknown>)[key];
  }
  if (typeof node !== "function") {
    throw new Error(
      `${path} 不是 token() 函数（实际是 ${typeof node}）——` +
        `硬编码色值会绕过 14 套主题`,
    );
  }
  return node as ColorFn;
}

describe("契约别名指向本仓 token（globals.css）", () => {
  for (const [contractVar, target] of CONTRACT_ALIASES) {
    it(`--${contractVar} → ${target}`, () => {
      expect(declaredValue(contractVar)).toBe(target);
    });
  }
});

describe("契约名在 tailwind colors 里就位且是函数色", () => {
  // 键路径与变量名必须一致（token-alpha.test.ts 的不变量），
  // 所以这里断言 function 返回同名变量 —— 顺带把 config 里的拼写错误也钉住。
  const KEYS = [
    "primary.DEFAULT",
    "primary.hover",
    "primary.muted",
    "primary.foreground",
    "secondary.DEFAULT",
    "secondary.foreground",
    "destructive.DEFAULT",
    "destructive.foreground",
    "foreground",
    "muted-foreground",
    "input",
    "ring",
  ];

  for (const path of KEYS) {
    it(`${path} 是 token() 函数色`, () => {
      const name = path.replace(/\.DEFAULT$/, "").replace(/\./g, "-");
      expect(leafAt(path)({})).toBe(`var(--color-${name})`);
    });
  }
});

describe("accent 的语义翻转尚未发生（两阶段改名）", () => {
  // ⚠️ 这是本次迁移最重要的守卫。
  //
  // 全仓有 526 处 accent 家族类名，其中 **515 处不在迁移范围内**。
  // 若谁把 utility accent 提前改成 hover 底色（config 里 accent → token("surface-hover")），
  // 那 515 处会立刻渲染成淡灰 —— 主按钮、强调链接、焦点环、强调描边全变。
  // 而 8 个不变量测试会红，但按「修 config 不改断言」的规则又修不好，
  // 因为红是翻转本身造成的。
  //
  // 翻转推迟到所有 bg-accent 都迁成 bg-primary 之后，作为独立一步（计划 7）。
  //
  // 注意断言的对象：翻转改的是 **utility** 的指向，不是 --color-accent 变量本身
  //（那个变量永远是品牌蓝）。所以这条锁的是 config 里 accent 的映射值。
  it("still points the accent utility at the brand colour", () => {
    expect(leafAt("accent.DEFAULT")({})).toBe("var(--color-accent)");
    expect(leafAt("accent.foreground")({})).toBe(
      "var(--color-accent-foreground)",
    );
  });
});

describe("secondary 是保留给 shadcn 的表面名（陷阱登记）", () => {
  // ⚠️ 这条不是「改完就好」的用例，而是把一条**静默陷阱**登记成可执行的记录。
  //
  // 本仓的「次级文字」是嵌套键产物：`text.text.secondary` → utility `text-text-secondary`
  //（221 处使用）。而 shadcn 契约需要一个名叫 secondary 的**表面色**，
  // 于是新增的 `colors.secondary` 同时也生成了 `text-secondary` ——
  // 那个名字看起来像「次级文字」，实际会渲染成表面色。
  //
  // 深色主题下那是近乎不可见的字（`--color-surface` #27272a 写在 #18181b 上），
  // 而且不会有任何报错。当前全仓 `text-secondary` 使用量为 0，故今天没有可见缺陷；
  // 这条用例把两个名字的语义分开钉住，避免日后有人「顺手」拿它当文字色用。
  it("text-secondary 解析为表面色，不是文字色", () => {
    expect(leafAt("secondary.DEFAULT")({})).toBe("var(--color-secondary)");
    // 真正的次级文字色在另一个键上，两者不可互换
    expect(leafAt("text.secondary")({})).toBe("var(--color-text-secondary)");
  });
});

describe("契约名不覆盖本仓自有名", () => {
  // 本仓的正文色 utility 是嵌套键产物（text.text.primary → text-text-primary），
  // 与 shadcn 的 text-primary 不同名。这条锁住「新增 primary 不会动到 text.*」
  it("leaves the text.* nested colours untouched", () => {
    expect(leafAt("text.primary")({})).toBe("var(--color-text-primary)");
    expect(leafAt("text.muted")({})).toBe("var(--color-text-muted)");
    expect(leafAt("text.secondary")({})).toBe("var(--color-text-secondary)");
  });
});
