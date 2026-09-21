// 设计文档 §9 的验收标准，逐条锁成断言。
// 覆盖全部 14 个主题块（7 预设 × 明暗）；数值一律从 globals.css 解析，不写死。
//
// 关于 color-mix：--color-border / --color-accent-muted 的最终色要装饰时才能算，
// 文本形式解析不出。所以对这两个 token 断言两件可验证的事：
//   1) 必须由语义 token 派生（杜绝退回硬编码/不透明实色）
//   2) 百分比必须是设计文档定下的值（否则把 18% 改成 3% 测试照样绿，而描边就没了）
import { describe, expect, it } from "vitest";
import {
  chroma,
  composite,
  contrast,
  parseAlphaColor,
  parseHex,
  relativeLuminance,
  themeBlocks,
  tokenOf,
} from "./theme-css-helpers";

const blocks = themeBlocks();

/**
 * 从 accent-muted 的声明里取 alpha。
 *
 * 两种合法写法：`color-mix(in srgb, var(--color-accent) N%, transparent)`
 * 与直接的 `rgba(r, g, b, a)`——后者在 5 个彩色预设的暗色块里已经在用，语义上同样是透明混合。
 */
function mutedAlpha(value: string): number {
  const mix =
    /color-mix\(\s*in srgb,\s*var\(--color-accent\)\s+(\d+)%,\s*transparent\s*\)/.exec(
      value.replace(/\s+/g, " "),
    );
  return mix ? Number(mix[1]) / 100 : parseAlphaColor(value).alpha;
}

/**
 * accent-muted 必须真的源自本块的 accent。
 *
 * 光断言"透明"不够：一个硬编码的 rgba(0, 0, 0, 0.12) 也是透明的，
 * 但它会得到一层灰雾而不是 accent 色调——而 accent-muted 的用途（chip / 选中底）
 * 正是要让底色染上 accent。所以两种允许形式：
 *   color-mix(... var(--color-accent) ...)  或  rgba() 的 rgb 等于本块的 accent。
 */
function mutedDerivesFromAccent(value: string, accent: string): boolean {
  const norm = value.replace(/\s+/g, " ");
  if (/color-mix\(\s*in srgb,\s*var\(--color-accent\)/.test(norm)) return true;
  const rgb = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/.exec(norm);
  if (!rgb) return false;
  const [a, b, c] = parseHex(accent);
  return (
    Math.round(+rgb[1]) === a &&
    Math.round(+rgb[2]) === b &&
    Math.round(+rgb[3]) === c
  );
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
    "--color-text-primary",
    "--color-text-secondary",
    "--color-text-muted",
    "--color-mention",
    "--color-accent",
  ] as const;

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
          "--color-background",
          "--color-surface",
        ] as const) {
          const r = contrast(value, tokenOf(block, surface));
          if (r < 4.5) {
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
    for (const block of blocks) {
      const head = block.slice(0, 60).replace(/\s+/g, " ");
      const isLight = /^\s*\.light/.test(block);
      const decl = tokenOf(block, "--color-border").replace(/\s+/g, " ");
      const m =
        /color-mix\(\s*in srgb,\s*var\(--color-text-primary\)\s+(\d+)%,\s*var\(--color-surface\)\s*\)/.exec(
          decl,
        );
      expect(
        m,
        `${head} border 应当是 text-primary/surface 的 color-mix：${decl}`,
      ).toBeTruthy();
      const pct = Number(m![1]) / 100;
      expect(pct, `${head} 暗色 18% / 亮色 22%`).toBe(isLight ? 0.22 : 0.18);

      // 把 color-mix 真正解出来再算，而不是只看声明形式 ——
      // 否则把百分比改成 3% 测试也绿，而描边就没了。
      const surface = tokenOf(block, "--color-surface");
      const border = composite(
        surface,
        tokenOf(block, "--color-text-primary"),
        pct,
      );

      // 方向一致性：描边必须在同一侧盖住它可能落在的每个表面。
      // 注意不能写成 `contrast(border, surface) > 1`——contrast() 用 max/min，
      // 恒 ≥ 1，那个断言只等价于"两者不相等"，而它声称要拦的缺陷
      // （改造前 border/surface-active = 1.06，描边比表面还暗）恰好能通过。
      // 所以必须断言亮度的符号：暗色描边更亮，亮色描边更暗。
      const borderLum = relativeLuminance(parseHex(border));
      for (const name of [
        "--color-surface",
        "--color-surface-hover",
        "--color-surface-active",
      ]) {
        const surfaceLum = relativeLuminance(parseHex(tokenOf(block, name)));
        const ok = isLight ? borderLum < surfaceLum : borderLum > surfaceLum;
        expect(
          ok,
          `${head} ${name}: 描边亮度 ${borderLum.toFixed(4)} 与表面 ${surfaceLum.toFixed(4)} 方向不一致`,
        ).toBe(true);
      }

      const vsSurface = contrast(border, surface);
      expect(
        vsSurface,
        `${head} border/surface=${vsSurface.toFixed(2)}`,
      ).toBeGreaterThanOrEqual(1.3);
      const vsBg = contrast(border, tokenOf(block, "--color-background"));
      expect(
        vsBg,
        `${head} border/background=${vsBg.toFixed(2)}`,
      ).toBeLessThanOrEqual(2.2);

      // 侧栏的填充色是 background-secondary（Task 2 把它的分隔从阴影改成 border），
      // 所以描边在它上面也必须看得见。这是上一轮漏掉的一组。
      const vsBgSecondary = contrast(
        border,
        tokenOf(block, "--color-background-secondary"),
      );
      expect(
        vsBgSecondary,
        `${head} border/background-secondary=${vsBgSecondary.toFixed(2)}`,
      ).toBeGreaterThanOrEqual(1.3);
    }
  });

  it("§9-3 §9-4 强调色与正文靠色相可分辨，且按钮字可读", () => {
    for (const block of blocks) {
      const head = block.slice(0, 60).replace(/\s+/g, " ");
      const accent = tokenOf(block, "--color-accent");
      const accentChroma = chroma(accent);
      const delta =
        accentChroma - chroma(tokenOf(block, "--color-text-primary"));
      expect(
        accentChroma,
        `${head} C(accent)=${accentChroma.toFixed(1)}`,
      ).toBeGreaterThanOrEqual(6);
      expect(
        delta,
        `${head} 彩度差=${delta.toFixed(1)}`,
      ).toBeGreaterThanOrEqual(5);
      expect(
        contrast(tokenOf(block, "--color-accent-foreground"), accent),
        `${head} accent-foreground/accent`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("§9-6 accent-muted 必须透明，且必须源自本块的 accent", () => {
    // 断言的是一一需求而不是实现写法：
    // 5 个彩色预设用的是 rgba(自身accent, 0.12)，语义上已经是透明混合，不该被判死。
    // 真正要堵的是两类漂移：
    //   （a）改造前 .light 里那个不透明的 #f4f4f5；
    //   （b）任何与本块 accent 无关的硬编码 rgba——它也是透明的，但会变成一层灰雾。
    for (const block of blocks) {
      const head = block.slice(0, 60).replace(/\s+/g, " ");
      const decl = tokenOf(block, "--color-accent-muted");
      const accent = tokenOf(block, "--color-accent");
      const alpha = mutedAlpha(decl);
      expect(alpha, `${head} accent-muted 的 alpha=${alpha}`).toBeLessThan(1);
      expect(alpha, `${head} accent-muted 太淡，等于隐形`).toBeGreaterThan(
        0.05,
      );
      expect(
        mutedDerivesFromAccent(decl, accent),
        `${head} accent-muted 与本块 accent (${accent}) 无关：${decl}`,
      ).toBe(true);
    }
  });
});
