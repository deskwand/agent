// 语义色透明度（`bg-accent/40` 这类）的编译不变量与对比度不变量。
//
// 背景：tailwind.config.js 里的语义色原本是 `var(--color-*)` 整值字符串。
// tailwind v3 处理 `<utility>-<token>/<alpha>` 时走 withAlphaValue()：
//   parseColor("var(--color-accent)", { loose: true }) → null
//   → 返回 defaultValue（undefined）→ 值为 undefined 的 utility 被丢弃，
//     产物里一条规则都没有。
// 于是 <mark> 落回 UA 默认的荧光黄，`border-error/30` 回落到 preflight 的
// var(--color-border)，`ring-accent/30` 回落到 tailwind 预置的蓝色环。
// 焦点环那一轮只做了局部绕开（见 focus-ring-css.test.ts），根因留在原地，
// 调用点从 24 处长到了 358 处。
//
// 注意：本文件在 tailwind 的 content 扫描范围内，**不要**写出完整的工具类字面量
// ——写了就会被当成用法、把那个类真的生成出来。类名一律用模板拼接生成。
//
// 已验证（本仓库 vitest 环境实测）：`import postcss from "postcss"`（有 ESM 入口）与
// `import tailwindcss from "tailwindcss"`（仅 CJS，靠 vite 互操作）都能拿到函数，
// `postcss([tailwindcss(config)]).process("@tailwind utilities;")` 能产出规则。
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import postcss from "postcss";
import type { Config } from "tailwindcss";
import tailwindcss from "tailwindcss";
import { describe, expect, it } from "vitest";
import {
  RENDERER,
  composite,
  contrast,
  css,
  themeBlocks,
  tokenOf,
} from "./theme-css-helpers";

const require = createRequire(import.meta.url);

type ColorFn = (args: { opacityValue?: string }) => string;

const config = require("../../../tailwind.config.js") as Config;

/** colors 的叶子：键路径 → token 名（不含 --color- 前缀）。 */
function colorLeaves(
  node: Record<string, unknown>,
  prefix = "",
): Array<{ key: string; name: string; value: unknown }> {
  const out: Array<{ key: string; name: string; value: unknown }> = [];
  for (const [key, value] of Object.entries(node)) {
    const full = prefix ? `${prefix}-${key}` : key;
    if (value !== null && typeof value === "object") {
      out.push(...colorLeaves(value as Record<string, unknown>, full));
      continue;
    }
    out.push({
      key: full,
      name: full.endsWith("-DEFAULT")
        ? full.slice(0, -"-DEFAULT".length)
        : full,
      value,
    });
  }
  return out;
}

const leaves = colorLeaves(
  (config.theme?.extend?.colors ?? {}) as Record<string, unknown>,
);

/** 源码里所有 `(变体:)*<utility>-<token>/<alpha>` 类名。 */
const UTILITIES = [
  "bg",
  "border",
  "ring",
  "text",
  "fill",
  "stroke",
  "from",
  "to",
  "via",
  "divide",
  "outline",
  "decoration",
  "placeholder",
];

/** 扫类名时**不能**只看 config 里注册的语义 token。
 *
 * 早期版本用 config 的叶子当 token 白名单，于是 token 名写错（根本不在 config 里）
 * 的死类对断言完全隐形——真实的假阴性路径：`bg-danger/10`、`bg-muted/30`
 * 当时就不产出任何规则，却是全绿。现在 token 段用通用形状，断言改成直接问
 * 「这条类到底编译得出来吗」。 */
function classPattern(): RegExp {
  return new RegExp(
    `(?:[a-z-]+:)*(?:${UTILITIES.join("|")})-([a-z][a-z0-9-]*)/(?:\\d{1,3}|\\[[^\\]]+\\])`,
    "g",
  );
}

/** 已知的、与本轮无关的死类。
 *
 * 它们不是 /alpha 的问题，而是 token 名根本不存在：`muted` / `danger` 从来就不是
 * `colors` 的键（真名是 surface-muted / border-muted / text-muted 与 error）。
 * 记在这里是为了让断言能覆盖全量：新出现的死类会被拦下，这几个则已声明为非目标
 * （设计文档 §8）。名单反过来也被断言守着，避免腐烂。 */
const KNOWN_DEAD_CLASSES = new Set([
  // PiExtensionManagerView.tsx —— danger 不存在，看着是 error 的误写
  "bg-danger/10",
  "border-danger/40",
  // AgentRunContainer.tsx / PiExtensionManagerView.tsx —— muted 不是 colors 的键
  "bg-muted/30",
  "bg-muted/50",
  "hover:bg-muted/50",
]);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(target));
    else if (/\.tsx?$/.test(entry.name)) out.push(target);
  }
  return out;
}

/** 类名 → CSS 选择器（`.bg-accent\/40`）。 */
function selectorOf(className: string): string {
  return `.${className.replace(/([:/.%#(),[\]])/g, "\\$1")}`;
}

/** 选择器在产物里出现的正则。
 *
 * 尾部必须用**分隔符前瞻**而不是固定空格：变体类生成的选择器后面跟的是伪类
 * （`.hover\:border-accent\/50:hover`、`.disabled\:bg-accent\/40:disabled`），
 * 要求空格会把所有带变体前缀的类误报成死类。
 * 前瞻同时兼作前缀保护：`bg-accent/4` 不会因为 `bg-accent/40` 存在而假绿。
 */
function selectorRegex(className: string): RegExp {
  const escaped = selectorOf(className).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escaped}(?=[\\s:,.{>~+\\[\\]])`);
}

/** 用真实 config 在内存里编译一串类名，返回产物 CSS。 */
async function compile(classNames: string[]): Promise<string> {
  const patched: Config = {
    ...config,
    content: [
      {
        raw: `<div class="${classNames.join(" ")}"></div>`,
        extension: "html",
      },
    ],
  };
  const result = await postcss([tailwindcss(patched)]).process(
    "@tailwind utilities;",
    { from: undefined },
  );
  return result.css;
}

describe("语义色 token 形状", () => {
  it("colors 的每个叶子都是函数色（整值 var() 字符串会吞掉 /alpha）", () => {
    const notFunctions = leaves
      .filter((leaf) => typeof leaf.value !== "function")
      .map((leaf) => leaf.key);
    expect(notFunctions).toEqual([]);
  });

  it("token() 解析出的变量名与键路径一致", () => {
    for (const leaf of leaves) {
      // 非函数色由上面那条断言负责报出来，这里跳过以免甩出 TypeError
      // 掩盖真正的发现。
      if (typeof leaf.value !== "function") continue;
      const resolved = (leaf.value as ColorFn)({ opacityValue: undefined });
      expect(resolved, leaf.key).toBe(`var(--color-${leaf.name})`);
    }
  });

  it("每个 token 在 globals.css 里都有真实声明", () => {
    for (const leaf of leaves) {
      expect(
        new RegExp(`--color-${leaf.name}\\s*:`).test(css),
        `globals.css 缺少 --color-${leaf.name}`,
      ).toBe(true);
    }
  });
});

describe("token/alpha 编译", () => {
  it("全仓的 token/alpha 类名都能编译出规则", async () => {
    const names = new Set<string>();
    for (const file of sourceFiles(RENDERER)) {
      for (const match of fs
        .readFileSync(file, "utf8")
        .matchAll(classPattern())) {
        names.add(match[0]);
      }
    }
    const sorted = [...names].sort();
    // 目前 358 处、87 个完整类名。数量断言防止正则悄悄匹配不到东西而假绿。
    expect(sorted.length).toBeGreaterThan(50);

    const output = await compile(sorted);
    const dead = (name: string) => !selectorRegex(name).test(output);

    // 新出现的死类必须为空。这一条覆盖全仓，不只覆盖 config 里注册过的 token，
    // 所以「token 名写错」与「/alpha 写不出规则」两类都跑不掉。
    const unexpected = sorted.filter(
      (name) => dead(name) && !KNOWN_DEAD_CLASSES.has(name),
    );
    expect(
      unexpected,
      `以下类名不产出任何 CSS：\n${unexpected.join("\n")}`,
    ).toEqual([]);

    // 反向：名单里的类如果已经能编译了，说明它被修好了，就该从名单里删掉。
    const stale = [...KNOWN_DEAD_CLASSES].filter((name) => !dead(name));
    expect(
      stale,
      `以下类已能编译，请从 KNOWN_DEAD_CLASSES 移除：\n${stale.join("\n")}`,
    ).toEqual([]);
  });

  it("修饰符里的 alpha 真的进了产物", async () => {
    const cases = [
      { property: "background-color", utility: "bg", percent: 40 },
      { property: "border-color", utility: "border", percent: 30 },
      { property: "--tw-ring-color", utility: "ring", percent: 30 },
    ];
    const names = cases.map((item) => `${item.utility}-accent/${item.percent}`);
    const output = await compile(names);

    for (const [index, item] of cases.entries()) {
      const start = selectorRegex(names[index]).exec(output)?.index ?? -1;
      expect(start, `${names[index]} 没有产出规则`).toBeGreaterThan(-1);
      const rule = output.slice(start, output.indexOf("}", start));
      expect(rule, names[index]).toContain(item.property);
      expect(rule, names[index]).toContain("var(--color-accent)");
      expect(rule, names[index]).toContain(
        `calc(${item.percent / 100} * 100%)`,
      );
    }
  });
});

// 高亮 token 的形式与强度。阈值与百分比都从 globals.css 解析，不写死——
// 调百分比只需要改 globals.css，测试会跟着动。
describe("高亮 token", () => {
  /** globals.css 里 --color-highlight 的 color-mix 声明。
   *
   * 命名对齐 composite(base, fg, alpha) 的语义：`base` 是垫底的那个
   * （--color-background），`overlay` 是按 alpha 叠上去的那个
   * （--color-accent）。搞反会静默算出一个偏暗的色，让对比度虚低。 */
  function highlightSpec(): { base: string; overlay: string; alpha: number } {
    const m =
      /--color-highlight\s*:\s*color-mix\(\s*in srgb,\s*var\((--[\w-]+)\)\s*([\d.]+)%,\s*var\((--[\w-]+)\)\s*\)/.exec(
        css.replace(/\s+/g, " "),
      );
    if (!m) {
      throw new Error(
        "--color-highlight 不再是 `color-mix(in srgb, var(--a) N%, var(--b))` 形式——" +
          "带 alpha（第三参数 transparent）会让高亮与底下垫什么合成，见 design §5.2",
      );
    }
    return { overlay: m[1], alpha: Number(m[2]) / 100, base: m[3] };
  }

  it("只声明一次", () => {
    const count = (css.match(/--color-highlight\s*:/g) ?? []).length;
    expect(count, `--color-highlight 声明了 ${count} 次，应为 1`).toBe(1);
  });

  it("14 个主题块下文字与可见度都达标", () => {
    // 先把锚点锁住：themeBlocks() 一旦因为选择器格式漂移返回空数组，
    // 下面两个 expect([], ...).toEqual([]) 会双双通过，整条断言静默失效。
    // 同一条约定见 tests/file-icon-colors.test.ts。
    expect(themeBlocks().length).toBeGreaterThanOrEqual(14);

    const spec = highlightSpec();
    const lowText: string[] = [];
    const invisible: string[] = [];

    for (const block of themeBlocks()) {
      const head = block.slice(0, 60).replace(/\s+/g, " ");
      const fill = composite(
        tokenOf(block, spec.base),
        tokenOf(block, spec.overlay),
        spec.alpha,
      );
      const text = contrast(tokenOf(block, "--color-text-primary"), fill);
      const visible = contrast(fill, tokenOf(block, spec.base));
      // 必须先确认解出了数字：token 一旦不再是 hex（比如改成 color-mix），
      // contrast() 会静默返回 NaN，而 NaN 参与的比较全为假——断言会变成永远绿。
      // 同一条坑见 theme-css-helpers.ts 里 backgroundSecondary 的注释。
      if (!Number.isFinite(text) || !Number.isFinite(visible)) {
        throw new Error(
          `${head} 解出了 NaN——${spec.base} / ${spec.overlay} / --color-text-primary ` +
            `可能不再是 hex：${fill}`,
        );
      }
      if (text < 4.5) lowText.push(`${text.toFixed(2)}  ${head}`);
      if (visible < 1.5) invisible.push(`${visible.toFixed(2)}  ${head}`);
    }

    expect(
      lowText,
      `以下主题块高亮上的文字低于 4.5：\n${lowText.join("\n")}`,
    ).toEqual([]);
    expect(
      invisible,
      `以下主题块的高亮对底色不到 1.5（等于看不见）：\n${invisible.join("\n")}`,
    ).toEqual([]);
  });

  it("与 ::selection 保持同一种形式（都不得掺 alpha）", () => {
    const body = /::selection\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    const background = (/background-color:\s*([^;]+);/.exec(body)?.[1] ?? "")
      .replace(/\s+/g, " ")
      .trim();
    expect(background).toMatch(
      /^color-mix\( in srgb, var\(--color-accent\) [\d.]+%, var\(--color-background\) \)$/,
    );
  });
});

// ── 调用点不变量：半透明底上的前景色 ──
//
// `text-*-foreground` 是按「压在实心 accent/success/... 上」调值的。一旦它落在
// 半透明底上，实际对比度就变成「底下垫着什么」的函数。改前全仓 9 处踩到这个
// （其中搜索高亮改用不透明 token 修掉，剩 8 处）。
//
// 只按单个字符串字面量判断——同元素的两个类在仓库里一定落在同一行。
// 已知局限：跨行模板字面量、以及 cn(".../40", "text-x-foreground") 这类把两个类
// 拆到不同字面量的写法捕不到（已扫描全仓 className 属性做交叉检查，当前 0 处）。

/** 一行里的字符串字面量（含模板字面量的单行部分）。 */
const LITERAL = /"([^"\n]*)"|'([^'\n]*)'|`([^`\n]*)`/g;

/** 一个合法的工具类 token（可带变体前缀）。
 *
 * 必须允许 `/NN`：否则 `bg-accent/40` 会在过滤阶段被丢掉，`lowBackground` 恒为空，
 * 整条断言退化成「永远绿」。（这个坑实际踩过一次，已修正。） */
const CLASS_TOKEN = /^(?:[a-z-]+:)*[a-z0-9-]+(?:\/\d+)?$/;

/** 去掉变体前缀，只留裸类名。 */
const bare = (className: string) =>
  className.slice(className.lastIndexOf(":") + 1);

describe("半透明底上的前景色", () => {
  it("同一 class 串里不得让 *-foreground 文字色压在 <60% 的底上", () => {
    const violations: string[] = [];

    for (const file of sourceFiles(RENDERER)) {
      const lines = fs.readFileSync(file, "utf8").split("\n");
      for (const [index, line] of lines.entries()) {
        for (const match of line.matchAll(LITERAL)) {
          const literal = match[1] ?? match[2] ?? match[3] ?? "";
          const tokens = literal
            .split(/\s+/)
            .filter((t) => CLASS_TOKEN.test(t));
          // 至少两个类 token、且至少一个是颜色类，才当成类串。
          if (tokens.length < 2) continue;
          if (!tokens.some((t) => /^(?:bg|text|border|ring)-/.test(bare(t)))) {
            continue;
          }

          const foreground = tokens.filter((t) =>
            /^text-[a-z-]+-foreground$/.test(bare(t)),
          );
          const lowBackground = tokens.filter((t) => {
            const m = /^bg-[a-z-]+\/(\d+)$/.exec(bare(t));
            return m !== null && Number(m[1]) < 60;
          });
          if (foreground.length > 0 && lowBackground.length > 0) {
            violations.push(
              `${path.relative(RENDERER, file)}:${index + 1}  ` +
                `${foreground[0]} + ${lowBackground.join(", ")}`,
            );
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
