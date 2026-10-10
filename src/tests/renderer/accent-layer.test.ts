// accent 层的不变量。三件事：
//   1) 逐字：每个 accent 块与官方快照的对应键逐值相等（只比对被写进 CSS 的那 2 个键）
//   2) 不越界：accent 块只许有 --primary / --primary-foreground —— 多写一个都会静默吃掉底色
//   3) 顺序：accent 块必须排在所有底色块之后（同为 (0,1,1)/(0,2,0)，靠源码顺序定胜负）
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RENDERER, css, tokensOf } from "./theme-css-helpers";

const accents = JSON.parse(
  fs.readFileSync(path.join(RENDERER, "styles/official-accents.json"), "utf8"),
) as Record<
  string,
  { light: Record<string, string>; dark: Record<string, string> }
>;

const EMITTED = ["--primary", "--primary-foreground"] as const;

function selectorOf(name: string, mode: "dark" | "light"): string {
  return mode === "light"
    ? `.light[data-theme-accent="${name}"]`
    : `:root[data-theme-accent="${name}"]`;
}

/**
 * 按选择器取块。accent 块不以 `:root` / `.light` 的"主题块"形状被 themeBlocks()
 * 收走（它们没有 --background），所以这里按选择器文本自己扫。
 */
function blockByAnySelector(selector: string): string | undefined {
  const re = new RegExp(
    `^ {2}${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{[\\s\\S]*?^ {2}\\}`,
    "m",
  );
  return re.exec(css)?.[0];
}

describe("accent 层", () => {
  it("覆盖 17 套 × 明暗 = 34 个块", () => {
    const names = Object.keys(accents);
    expect(names).toHaveLength(17);
    const missing: string[] = [];
    for (const name of names) {
      for (const mode of ["dark", "light"] as const) {
        if (!blockByAnySelector(selectorOf(name, mode))) {
          missing.push(selectorOf(name, mode));
        }
      }
    }
    expect(missing, `缺块：\n${missing.join("\n")}`).toEqual([]);
  });

  it("与官方快照逐值相等（primary / primary-foreground）", () => {
    const mismatched: string[] = [];
    for (const [name, modes] of Object.entries(accents)) {
      for (const mode of ["dark", "light"] as const) {
        const sel = selectorOf(name, mode);
        const got = tokensOf(blockByAnySelector(sel)!);
        for (const key of EMITTED) {
          const official = modes[mode][key.slice(2)];
          if (got[key] !== official) {
            mismatched.push(
              `${sel} ${key}: ${got[key] ?? "(缺)"} ≠ ${official}`,
            );
          }
        }
      }
    }
    expect(
      mismatched,
      `与官方 accent 值不一致：\n${mismatched.join("\n")}`,
    ).toEqual([]);
  });

  it("不越界：只许 --primary / --primary-foreground 两个键", () => {
    const extra: string[] = [];
    for (const name of Object.keys(accents)) {
      for (const mode of ["dark", "light"] as const) {
        const sel = selectorOf(name, mode);
        const keys = Object.keys(tokensOf(blockByAnySelector(sel)!)).sort();
        if (keys.join(",") !== [...EMITTED].sort().join(",")) {
          extra.push(`${sel} 写了 ${keys.join(", ")}`);
        }
      }
    }
    expect(
      extra,
      `accent 块只许写 ${EMITTED.join(" / ")}（多写会静默吃掉底色）：\n${extra.join("\n")}`,
    ).toEqual([]);
  });

  it("顺序：accent 块排在所有底色块之后", () => {
    const firstAccent = css.indexOf('  :root[data-theme-accent="');
    expect(firstAccent, "找不到 accent 块").toBeGreaterThan(-1);
    const lastBase = Math.max(
      css.lastIndexOf("  .light[data-theme-preset="),
      css.lastIndexOf("  :root[data-theme-preset="),
      css.lastIndexOf("  .light {"),
    );
    expect(firstAccent, "accent 块必须排在底色块之后").toBeGreaterThan(
      lastBase,
    );
  });

  it("文字档 --primary-text 声明在固定语义层，且只声明一次", () => {
    const count = (css.match(/--primary-text\s*:/g) ?? []).length;
    expect(count, `--primary-text 声明了 ${count} 次，应为 1`).toBe(1);
    // 必须在顶层（未包裹 @layer 的那个 :root），不在任何主题块里
    const top = css.slice(0, css.indexOf("@layer base {"));
    expect(top).toContain("--primary-text:");
  });
});
