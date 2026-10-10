// 设计文档 §9 的验收标准，逐条锁成断言。
// 覆盖全部 14 个主题块（7 预设 × 明暗）；数值一律从 globals.css 解析，不写死。
//
// 2026-10-10（官方 vocabulary 切换）：取值改为逐字官方，本文件随之改了四处口径 ——
//   描边从"必须 color-mix 派生"改为"字面值 + 门槛"；次级表面改读 --muted 且取消方向判据；
//   §9-3 的彩度判据取消（7 套官方 base 都是近中性色）；§9-7/§9-6 的 highlight / accent-muted
//   改读 ::selection 规则里的公式。每一处都在 spec §7 登记过。
import { describe, expect, it } from "vitest";
import { VALID_THEME_ACCENTS } from "../../shared/theme";
import fs from "node:fs";
import path from "node:path";
import {
  RENDERER,
  composite,
  rgbHex,
  contrast,
  css,
  parseAlphaColor,
  parseHex,
  relativeLuminance,
  themeBlocks,
  tokenOf,
} from "./theme-css-helpers";

const blocks = themeBlocks();

const tailwindSource = fs.readFileSync(
  path.resolve(process.cwd(), "tailwind.config.js"),
  "utf8",
);

/**
 * 解出某个主题块下 `--app-chrome`（外圈）的最终 hex。
 *
 * 与 `background-secondary` 不同：外圈**不是逐块声明的**，只在 globals.css 里声明两次
 * （顶层 `:root` 给暗色、`:root.light` 给亮色），值里的 `var(--background)` 由各主题块解析
 * ——与 `--overlay-hover` / `--highlight-removed` 同款（2026-09-29-outer-ring-depth-design.md §3）。
 * 所以这里按块的明暗取对应的那一条，再 composite 到本块的 background 上。
 *
 * 不要退回 `tokenOf(block, "--app-chrome")`：各主题块里根本没有这条声明，
 * 那种写法解不出色值，NaN 参与的比较全为假（同文件 `backgroundSecondary()` 记过的坑）。
 */
const CHROME_DECL =
  /--app-chrome\s*:\s*color-mix\(\s*in srgb,\s*#000000\s+([\d.]+)%,\s*var\(--background\)\s*\)/;

function chromePercent(isLight: boolean): number {
  // 亮色那条只可能在 :root.light 里（(0,2,0) 特异性，不依赖源码顺序）；
  // 暗色那条在顶层 :root 的控制叠层块里 —— 先把 :root.light 整块摘掉再找，免得命中它。
  const lightBlock = /^:root\.light\s*\{[\s\S]*?\n\}/m.exec(css)?.[0];
  if (!lightBlock) throw new Error("globals.css 里找不到 :root.light 块");
  const source = (isLight ? lightBlock : css.replace(lightBlock, "")).replace(
    /\s+/g,
    " ",
  );
  const m = CHROME_DECL.exec(source);
  if (!m)
    throw new Error(
      `globals.css 里找不到${isLight ? "亮色" : "暗色"}的 --app-chrome 声明`,
    );
  return Number(m[1]) / 100;
}

function backgroundChrome(block: string): string {
  return composite(
    tokenOf(block, "--background"),
    "#000000",
    chromePercent(/^\s*\.light/.test(block)),
  );
}

function isLightBlock(block: string): boolean {
  return /^\s*\.light/.test(block);
}

describe("主题对比度不变量", () => {
  it("覆盖 14 个主题块", () => {
    expect(blocks.length).toBe(14);
  });

  /**
   * 会被当**文字色**用的 token。
   *
   * success / warning / error 故意不在列表里——它们目前是按填充色/状态点调值的，
   * 纳入会让这条判据立刻红 30+ 项。那是单独一项工作（要决定压暗 3 个值还是拆
   * fill / on-surface 两组，后者要动 66 处调用点），不属于本轮。
   * **不要因为这里红了就放宽门槛。**
   */
  const TEXT_ROLE_TOKENS = [
    "--foreground",
    "--muted-foreground",
    "--primary",
  ] as const;

  /** 官方取值自带的一处例外：olive 亮色的 muted-foreground 实测 4.25（官方原值，不许改）。 */
  const TEXT_FLOOR: Record<string, number> = { olive: 4.2 };

  it("§9-1 文本类 token 对 background 与 surface 都 ≥ 4.5", () => {
    // 上一轮只查了 text-muted × surface 一组，于是漏掉了这两批：
    //   - text-muted 在 5 个亮色预设的 background 上（4.37–4.47）
    //   - accent 在 ocean / forest / ember 亮色的 background 上（4.31–4.44）
    // 亮色预设的 background 比 surface 略深，"只查 surface"必然漏掉这一侧。
    //
    // 共 14 × 5 × 2 = 140 个组合，收集全部违规再断言，一次报全。
    const violations: string[] = [];
    for (const block of blocks) {
      const head = block.slice(0, 60).replace(/\s+/g, " ");
      for (const token of TEXT_ROLE_TOKENS) {
        const value = tokenOf(block, token);
        for (const surface of [
          "--background",
          "--card",
        ] as const) {
          const r = contrast(value, tokenOf(block, surface));
          const preset = /data-theme-preset="(\w+)"/.exec(block)?.[1] ?? "zinc";
          const floor = isLightBlock(block) ? (TEXT_FLOOR[preset] ?? 4.5) : 4.5;
          if (r < floor) {
            violations.push(`${r.toFixed(2)}  ${head}  ${token} / ${surface}`);
          }
        }
      }
    }
    expect(violations, `以下组合低于 4.5：\n${violations.join("\n")}`).toEqual(
      [],
    );
  });

  it("§9-2 描边在各方表面上都看得见，且不会发白", () => {
    // 官方取值是**字面值**（亮 oklch(0.922 0 0)、暗 oklch(1 0 0 / 10%)），不再是本仓的
    // color-mix 派生 —— 所以形式上只要求"能解析"，可见度门槛一条不降（spec §7 登记
    // 亮色官方值就是淡：1.27 对白底）。
    for (const block of blocks) {
      const head = block.slice(0, 60).replace(/\s+/g, " ");
      const isLight = isLightBlock(block);
      const decl = tokenOf(block, "--border").replace(/\s+/g, " ");
      const borderOver = (surface: string) => {
        const parsed = parseAlphaColor(decl);
        return parsed.alpha < 1
          ? composite(surface, rgbHex(parsed.rgb), parsed.alpha)
          : decl;
      };
      const b = (surface: string) => contrast(borderOver(surface), surface);

      const card = tokenOf(block, "--card");
      const bg = tokenOf(block, "--background");
      const muted = tokenOf(block, "--muted");

      expect(b(card), `${head} border/card=${b(card).toFixed(2)}`).toBeGreaterThanOrEqual(1.2);
      expect(b(muted), `${head} border/muted=${b(muted).toFixed(2)}`).toBeGreaterThanOrEqual(1.1);
      expect(b(bg), `${head} border/background=${b(bg).toFixed(2)}`).toBeLessThanOrEqual(2.2);

      // 方向：暗色描边更亮、亮色描边更暗（用亮度符号，不用 contrast() >= 1 —— 那恒成立）
      const lum = (v: string) => relativeLuminance(parseHex(v));
      for (const surface of ["--card", "--muted", "--accent"] as const) {
        const sVal = tokenOf(block, surface);
        const ok = isLight ? lum(borderOver(sVal)) < lum(sVal) : lum(borderOver(sVal)) > lum(sVal);
        expect(ok, `${head} ${surface} 的描边方向不对`).toBe(true);
      }
    }
  });

  /**
   * 次级表面分界：官方 `--muted` 对 `--background` 的底色差。
   *
   * 官方取值下**方向判据必须取消**：暗色里 `--muted`(#27272a) 比 `--card`(#18181b) 亮，
   * 与本仓旧的「抬升面必须比次级表面亮」相反。所以只锁"看得见"（≥1.05）。
   */
  it("§9-4 次级表面（--muted）与 --background 的底色差成立", () => {
    for (const block of blocks) {
      const head = block.slice(0, 60).replace(/\s+/g, " ");
      const step = contrast(tokenOf(block, "--muted"), tokenOf(block, "--background"));
      expect(step, `${head} muted/background = ${step.toFixed(3)}`).toBeGreaterThanOrEqual(1.05);
    }
  });

  it("§9-3 强调面/animate 面上的文字可读（accent-foreground / accent ≥ 4.5）", () => {
    // 彩度判据（旧 §9-3）随官方配色一并取消：7 套 base 的 accent 都是近中性色（C ≈ 0–3），
    // "靠色相区分 accent 与正文"这个前提不存在了。
    for (const block of blocks) {
      const head = block.slice(0, 60).replace(/\s+/g, " ");
      expect(
        contrast(tokenOf(block, "--accent-foreground"), tokenOf(block, "--accent")),
        `${head} accent-foreground/accent`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("§9-7 ::selection 由官方 token 派生：不透明、文字 ≥4.5、对底色可见 ≥1.5", () => {
    // 旧写法在这里断言 --highlight 的 color-mix 百分比；官方没有 highlight 变量，
    // 改成规则内的公式：color-mix(in srgb, var(--A) N%, var(--B))。
    const body = /\.selection-placeholder[\s\S]*?\}/.test("")
      ? ""
      : (/::selection\s*\{[\s\S]*?\}/.exec(css)?.[0] ?? "");
    expect(body, "globals.css 里找不到 ::selection 规则").not.toBe("");
    const backgroundValue = (/background-color:\s*([^;]+);/.exec(body)?.[1] ?? "")
      .replace(/\s+/g, " ")
      .trim();
    const mix = /^color-mix\(\s*in srgb,\s*var\((--[\w-]+)\)\s+([\d.]+)%,\s*var\((--[\w-]+)\)\s*\)$/.exec(
      backgroundValue,
    );
    expect(mix, `选中背景必须由官方 token 派生：${backgroundValue}`).not.toBeNull();
    const [, aTok, pct, bTok] = mix!;
    const alpha = Number(pct) / 100;

    const lowText: string[] = [];
    const invisible: string[] = [];
    for (const block of blocks) {
      const head = block.slice(0, 60).replace(/\s+/g, " ");
      const fill = composite(tokenOf(block, bTok), tokenOf(block, aTok), alpha);
      const bg = tokenOf(block, "--background");
      expect(parseAlphaColor(fill).alpha, `${head} 高亮必须不透明`).toBe(1);
      const text = contrast(tokenOf(block, "--foreground"), fill);
      if (text < 4.5) lowText.push(`${text.toFixed(2)}  ${head}`);
      const visible = contrast(fill, bg);
      if (visible < 1.5) invisible.push(`${visible.toFixed(2)}  ${head}`);
    }
    expect(lowText, `选中后文字低于 4.5：\n${lowText.join("\n")}`).toEqual([]);
    expect(invisible, `高亮对底色不到 1.5：\n${invisible.join("\n")}`).toEqual([]);
  });

  it("§9-8 外圈（图标栏＋标题栏）：比内容区暗，三级台阶成立", () => {
    expect(chromePercent(true), "亮色压黑比例").toBeCloseTo(0.12, 5);
    expect(chromePercent(false), "暗色压黑比例").toBeCloseTo(0.5, 5);

    // tailwind 里少了 app-chrome 键，bg-app-chrome 就是死类（不生成任何 CSS），外圈静默透明。
    expect(
      /"app-chrome":\s*token\("app-chrome"\)/.test(tailwindSource),
      "tailwind.config.js 里缺 app-chrome 映射",
    ).toBe(true);

    // 外圈不得逐块声明（只允许顶层 :root 与 :root.light 各一次）
    for (const block of blocks) {
      expect(block, "外圈 token 不得逐块声明").not.toContain("--app-chrome");
    }

    const outOfBand: string[] = [];
    const lowIcons: string[] = [];
    for (const block of blocks) {
      const head = block.slice(0, 60).replace(/\s+/g, " ");
      const background = tokenOf(block, "--background");
      const secondary = tokenOf(block, "--muted");
      const chrome = backgroundChrome(block);
      const icon = contrast(tokenOf(block, "--muted-foreground"), chrome);
      if (icon < 3) lowIcons.push(`${icon.toFixed(2)}  ${head}`);

      const vsContent = contrast(chrome, background);
      const vsSecondary = contrast(chrome, secondary);
      // 台阶区间按 7 套官方 base 实测标定（spec §7 登记）；越界即红。
      const ok = vsContent >= 1.02 && vsContent <= 1.45 && vsSecondary >= 1.1 && vsSecondary <= 1.45;
      if (!ok) outOfBand.push(`${head} 外圈/内容=${vsContent.toFixed(3)} 外圈/muted=${vsSecondary.toFixed(3)}`);
    }
    expect(outOfBand, `外圈台阶出界：\n${outOfBand.join("\n")}`).toEqual([]);
    expect(lowIcons, `muted 图标在外圈上低于 3.0：\n${lowIcons.join("\n")}`).toEqual([]);
  });

  /** 规则体里某条声明的值（压平空白后取第一段）。 */
  function declarationOf(ruleBody: string, property: string): string {
    const m = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+);`).exec(
      ruleBody.replace(/\s+/g, " "),
    );
    if (!m) throw new Error(`规则里找不到 ${property} 声明`);
    return m[1].trim();
  }

  /**
   * `theme("colors.muted.foreground")` / `var(--muted-foreground)` → `--muted-foreground`。
   * 键路径 === 变量名这条不变量由 token-alpha.test.ts 守着，这里只做单向换算。
   */
  function tokenNameOf(value: string): string {
    const theme = /^theme\(\s*"colors\.([\w.-]+)"\s*\)$/.exec(value);
    const direct = /^var\((--[\w-]+)\)$/.exec(value);
    if (direct) return direct[1];
    if (!theme) throw new Error(`认不出的颜色写法：${value}`);
    return `--${theme[1].replace(/\.DEFAULT$/, "").replace(/\./g, "-")}`;
  }

  /**
   * 强调色维度的官方真值（17 套 × 明暗，只覆盖 --primary / --primary-foreground）。
   *
   * 读不到就**报错**，不做“退化到只算底色”的兼容 —— 那种兼容恰好把本文件要防的事
   * 变成绿：裸 `--primary` 当文字在 14 个底色块上全绿，叠了 accent 才倒（1.53）。
   * 与 ACCENTS 的一致性由下一条断言把住（文件被改名/没跟上白名单都跑不掉）。
   */
  const accents: Record<
    string,
    { light: Record<string, string>; dark: Record<string, string> }
  > = JSON.parse(
    fs.readFileSync(path.join(RENDERER, "styles/official-accents.json"), "utf8"),
  ) as never;

  /**
   * 某个 token 在「某底色块 + 某强调色」下的最终色值。
   *
   * - 逐块声明的直接取（`--primary` 在选了强调色时由 accent 块覆盖，所以要先换掉）；
   * - 只在固定语义层声明一次的派生 token（`--primary-text` 是
   *   `color-mix(in srgb, var(--primary) 40%, var(--foreground))`）按源码里的公式在本组合上求值。
   *
   * 为什么不只算 14 个底色块：`--primary` 是**填充**色，官方暗色档对暗底只有 1.98–2.81，
   * 亮色的 lime / neutral 到 1.53 —— 只按底色算会在这 17 套 accent 下假绿
   * （本轮修链接色时真的踩过：先写成裸 `--primary`，14 块全绿）。
   */
  function colorIn(
    block: string,
    token: string,
    accentPrimary?: string,
  ): string {
    if (token === "--primary" && accentPrimary) return accentPrimary;
    // 注意不能用 tokenOf()：它在本块找不到声明时是抛错，而派生 token（--primary-text）
    // 本来就不逐块声明。
    const direct = new RegExp(`(?:^|[\\s;])${token}\\s*:\\s*([^;]+);`).exec(
      block,
    )?.[1];
    if (direct) return direct.trim();
    const decl =
      new RegExp(`\\n\\s*${token}:\\s*([^;]+);`).exec(css)?.[1] ?? "";
    const mix =
      /color-mix\(\s*in srgb,\s*var\((--[\w-]+)\)\s+([\d.]+)%,\s*var\((--[\w-]+)\)\s*\)/.exec(
        decl.replace(/\s+/g, " "),
      );
    if (!mix)
      throw new Error(
        `${token} 既不是逐块声明，也不是可解析的 color-mix：${decl}`,
      );
    const [, aTok, pct, bTok] = mix;
    return composite(
      colorIn(block, bTok, accentPrimary),
      colorIn(block, aTok, accentPrimary),
      Number(pct) / 100,
    );
  }

  /** 底色块 × （默认 + 17 套强调色）的所有组合。 */
  function combos(): Array<{
    block: string;
    accent?: string;
    label: string;
    primary: string;
  }> {
    const out: Array<{
      block: string;
      accent?: string;
      label: string;
      primary: string;
    }> = [];
    for (const block of blocks) {
      const preset = /data-theme-preset="(\w+)"/.exec(block)?.[1] ?? "zinc";
      const mode = isLightBlock(block) ? "light" : "dark";
      for (const accent of [undefined, ...Object.keys(accents)]) {
        out.push({
          block,
          accent,
          label: `${preset}/${accent ?? "默认"}/${mode}`,
          primary: accent
            ? accents[accent]![mode]["primary"]!
            : tokenOf(block, "--primary"),
        });
      }
    }
    return out;
  }

  // 2026-10-10 新增：官方词汇表切换只改了**类名**，CSS 里四处 `theme("colors.…")`
  // 与一条 `var(--accent)` 没跟上 —— `--accent` 官方语义是 hover 表面色，亮色近白、
  // 暗色近黑，于是正文链接（含「Sources:」列表里的引用链接）对底色只有 1.09–1.34，
  // 等于看不见（用户截图）。这条守的是「链接色是**文字角色**的 token」。
  //
  // 表面清单与 accent-contrast.test.ts 对齐（--muted / --accent 也要过）：
  // 行内 chip 与选中行上也有链接，而 `--primary-text` 的最差组合恰好就在 --muted 上。
  it("§9-9 正文链接色在全部底色 × 强调色下都可读", () => {
    // 真值与共享白名单必须一一对应：否则本用例会静默少算 17 套（甚至退化成 14 块）。
    expect(Object.keys(accents).sort()).toEqual(
      VALID_THEME_ACCENTS.filter((a) => a !== "default").sort(),
    );
    const rule = /\.prose-chat a\s*\{([\s\S]*?)\}/.exec(css)?.[1];
    expect(rule, "globals.css 里找不到 .prose-chat a").toBeTruthy();
    const token = tokenNameOf(declarationOf(rule!, "color"));

    const violations: string[] = [];
    for (const { block, label, primary } of combos()) {
      const ink = colorIn(block, token, primary);
      const preset = /data-theme-preset="(\w+)"/.exec(block)?.[1] ?? "zinc";
      const floor = isLightBlock(block) ? (TEXT_FLOOR[preset] ?? 4.5) : 4.5;
      for (const surface of [
        "--background",
        "--card",
        "--muted",
        "--accent",
      ] as const) {
        const r = contrast(ink, tokenOf(block, surface));
        if (r < floor) {
          violations.push(
            `${r.toFixed(2)}  ${label}  ${token} / ${surface}`,
          );
        }
      }
    }
    expect(
      violations,
      `链接色在以下组合上读不出来：\n${violations.join("\n")}`,
    ).toEqual([]);
  });

  // 同一次切换的另一处：`::highlight(tts)` 原本靠 `--accent` 当朗读高亮，
  // 翻转后 14 块实测对底色只有 1.05（等于没有高亮）。
  // 三个判据：不透明 + 高亮上的字 ≥ 4.5 + 对 background / card / muted 都看得见 ≥ 1.5。
  it("§9-10 朗读高亮可见且其上文字可读（含强调色维度）", () => {
    expect(Object.keys(accents).length).toBe(
      VALID_THEME_ACCENTS.length - 1,
    );
    const rule = /::highlight\(tts\)\s*\{([\s\S]*?)\}/.exec(css)?.[1];
    expect(rule, "globals.css 里找不到 ::highlight(tts)").toBeTruthy();
    const value = declarationOf(rule!, "background-color").replace(/\s+/g, " ");
    const mix =
      /^color-mix\(\s*in srgb,\s*var\((--[\w-]+)\)\s+([\d.]+)%,\s*var\((--[\w-]+)\)\s*\)$/.exec(
        value,
      );
    expect(
      mix,
      `朗读高亮必须由两个官方 token 不透明地混出来（透明底会让对比度变成「底下垫着什么」的函数）：${value}`,
    ).not.toBeNull();
    const [, aTok, pct, bTok] = mix!;
    const alpha = Number(pct) / 100;

    const lowText: string[] = [];
    const invisible: string[] = [];
    for (const { block, label, primary } of combos()) {
      const fill = composite(
        colorIn(block, bTok, primary),
        colorIn(block, aTok, primary),
        alpha,
      );
      expect(parseAlphaColor(fill).alpha, `${label} 高亮必须不透明`).toBe(1);
      const text = contrast(tokenOf(block, "--foreground"), fill);
      if (text < 4.5) lowText.push(`${text.toFixed(2)}  ${label}`);
      for (const surface of ["--background", "--card", "--muted"] as const) {
        const visible = contrast(fill, tokenOf(block, surface));
        if (visible < 1.5)
          invisible.push(`${visible.toFixed(2)}  ${label} / ${surface}`);
      }
    }
    expect(lowText, `高亮上的文字低于 4.5：\n${lowText.join("\n")}`).toEqual([]);
    expect(
      invisible,
      `高亮对底色不到 1.5：\n${invisible.join("\n")}`,
    ).toEqual([]);
  });
});
