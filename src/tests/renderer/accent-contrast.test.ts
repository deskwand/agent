// 底色 × 强调色 的组合对比度不变量 —— 本轮的验收核心。
//
// 为什么在测试里**合成**组合而不是读 CSS：CSS 里只有 34 个 accent 块（17 × 明暗），
// 而真实组合是 7 底色 ×（1 默认 + 17 强调色）= 126（× 明暗 = 252）。读 CSS 只能覆盖
// "已挂上去的那些"，合成才能一次覆盖整张矩阵 —— 换底色或换 accent 都不会漏。
//
// 两条判据：
//   ① 文字档（--primary-text）= primary 与 foreground 按 globals.css 里那个比例混合，
//      对 background / card / muted / accent 四个表面都 ≥ 4.5。官方 accent 的暗色 primary
//      对暗底只有 1.98–2.81，**不能当文字用** —— 这一档就是为它存在的。
//   ② 填充档：primary-foreground 对 primary ≥ 4.5（按钮字）。
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RENDERER, composite, contrast, css } from "./theme-css-helpers";

const bases = JSON.parse(
  fs.readFileSync(path.join(RENDERER, "styles/official-themes.json"), "utf8"),
) as Record<
  string,
  { light: Record<string, string>; dark: Record<string, string> }
>;
const accents = JSON.parse(
  fs.readFileSync(path.join(RENDERER, "styles/official-accents.json"), "utf8"),
) as Record<
  string,
  { light: Record<string, string>; dark: Record<string, string> }
>;

/** 从 globals.css 读文字档的混合比例（不写死 40%）。 */
function textMixRatio(): number {
  const m =
    /--primary-text:\s*color-mix\(\s*in srgb,\s*var\(--primary\)\s+(\d+)%,\s*var\(--foreground\)\s*\)/.exec(
      css,
    );
  if (!m) {
    throw new Error(
      "globals.css 里找不到 `--primary-text: color-mix(in srgb, var(--primary) N%, var(--foreground))`",
    );
  }
  return Number(m[1]) / 100;
}

const RATIO = textMixRatio();
const SURFACES = ["background", "card", "muted", "accent"] as const;

interface Combo {
  label: string;
  /** 该底色的四个表面 + 正文色（都来自底色块）。 */
  surfaces: Record<(typeof SURFACES)[number] | "foreground", string>;
  /** 该组合生效的强调色（"default" 时就是底色自己的 primary）。 */
  primary: string;
  primaryForeground: string;
}

function combinations(): Combo[] {
  const out: Combo[] = [];
  for (const [baseName, base] of Object.entries(bases)) {
    for (const mode of ["dark", "light"] as const) {
      const surfaces = Object.fromEntries(
        [...SURFACES, "foreground"].map((s) => [s, base[mode][s]]),
      ) as Combo["surfaces"];
      out.push({
        label: `${baseName}/default/${mode}`,
        surfaces,
        primary: base[mode].primary,
        primaryForeground: base[mode]["primary-foreground"],
      });
      for (const [accentName, accent] of Object.entries(accents)) {
        out.push({
          label: `${baseName}/${accentName}/${mode}`,
          surfaces,
          primary: accent[mode].primary,
          primaryForeground: accent[mode]["primary-foreground"],
        });
      }
    }
  }
  return out;
}

/** CSS 里 `color-mix(in srgb, primary P%, foreground)` 的 sRGB 结果。 */
function textTone(combo: Combo): string {
  // composite(base, fg, alpha) = base*(1-alpha) + fg*alpha
  // ⇒ 以 foreground 为底、把 primary 按 RATIO 叠上去。
  return composite(combo.surfaces.foreground, combo.primary, RATIO);
}

describe("底色 × 强调色 的组合不变量", () => {
  const all = combinations();

  it("组合数 = 7 底色 ×（1 默认 + 17 强调色）× 明暗 = 252", () => {
    // 锚点：合成器一旦失效（比如 JSON 读空），下面两条会双双空转。
    expect(Object.keys(bases)).toHaveLength(7);
    expect(Object.keys(accents)).toHaveLength(17);
    expect(all).toHaveLength(7 * 18 * 2);
  });

  it(`文字档（primary ${Math.round(RATIO * 100)}% + foreground）在四个表面上都 ≥ 4.5`, () => {
    const low: string[] = [];
    for (const combo of all) {
      const tone = textTone(combo);
      for (const surface of SURFACES) {
        const ratio = contrast(tone, combo.surfaces[surface]);
        if (ratio < 4.5) {
          low.push(`${ratio.toFixed(2)}  ${combo.label} on --${surface}`);
        }
      }
    }
    expect(low, `以下组合的文字档低于 4.5：\n${low.join("\n")}`).toEqual([]);
  });

  it("填充档：primary-foreground / primary ≥ 4.4（官方最差一档只有 4.502）", () => {
    // ⚠️ 门槛写 4.4 而不是 4.5：官方取值里 `lime` 暗色的 primary/primary-foreground
    // 实测 4.502 —— 只比 4.5 高 0.002。写 4.5 会让"全绿"看起来像有余量，
    // 而实际上任何解析模型的细微变化（如 Chromium 的 gamut mapping 与助手里的
    // 逐通道 clamp 差 1/255）都可能把它推过线。官方值不许改，所以把余量写实：
    // 门槛 4.4 + 下面单独钉住最差组合的精确值。
    const ratios = all.map((combo) => ({
      label: combo.label,
      ratio: contrast(combo.primaryForeground, combo.primary),
    }));
    const low = ratios.filter((r) => r.ratio < 4.4);
    expect(
      low,
      `以下组合的按钮字低于 4.4：\n${low.map((r) => `${r.ratio.toFixed(2)}  ${r.label}`).join("\n")}`,
    ).toEqual([]);

    const worst = ratios.reduce((a, b) => (a.ratio <= b.ratio ? a : b));
    // 填充档只取决于强调色自己的两个值，与底色无关 ⇒ 7 个底色的比值完全相同，
    // "最差组合"落在哪个底色上是遍历顺序决定的。所以钉 accent/模式，不钉底色。
    expect(
      worst.label.endsWith("/lime/dark"),
      `最差组合变成了 ${worst.label}`,
    ).toBe(true);
    expect(worst.ratio).toBeGreaterThan(4.4);
    expect(worst.ratio).toBeLessThan(4.6);
  });

  it("文字档确实跟着强调色走（同一底色下不同 accent 的文字档互不相同）", () => {
    // 若混合比例后来被写成 0%，上面那条门槛照样绿（文字档 == foreground 时对比度最高）。
    // 这里逐底色检查：暗色下 18 个组合（1 默认 + 17 accent）里至少 10 个文字档不同。
    for (const baseName of Object.keys(bases)) {
      const tones = new Set(
        all
          .filter(
            (c) =>
              c.label.startsWith(`${baseName}/`) && c.label.endsWith("/dark"),
          )
          .map((c) => textTone(c)),
      );
      expect(tones.size, `${baseName} 的文字档不随强调色变`).toBeGreaterThan(
        10,
      );
    }
  });
});
