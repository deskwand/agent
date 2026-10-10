// 默认主题的**接线**不变量。
//
// 2026-10-10 改口径：默认调色板从自造的 graphite 换成官方 zinc，取值本身由
// `src/tests/renderer/official-vocabulary.test.ts` 逐字对着 registry 快照守 ——
// 本文件只守"默认槽位接对了"，不再断言具体色值（那会在换官方版本时假红）。
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const stylesPath = path.resolve(
  process.cwd(),
  "src/renderer/styles/globals.css",
);
const sharedThemePath = path.resolve(process.cwd(), "src/shared/theme.ts");

describe("default theme wiring", () => {
  it("zinc 占默认槽位：暗色在 :root、亮色在 .light", () => {
    const source = fs.readFileSync(stylesPath, "utf8");
    // 官方 zinc 的暗色背景（oklch(0.141 0.005 285.823)）必须出现在默认槽位块里
    const darkBlock = /^ {2}:root \{[\s\S]*?^ {2}\}/m.exec(source)?.[0] ?? "";
    expect(darkBlock, "找不到默认暗色块").not.toBe("");
    expect(darkBlock).toContain("--background: oklch(0.141 0.005 285.823);");
    expect(darkBlock).not.toMatch(/data-theme-preset/);

    const lightBlock =
      /^ {2}\.light \{[\s\S]*?^ {2}\}/m.exec(source)?.[0] ?? "";
    expect(lightBlock, "找不到默认亮色块").not.toBe("");
    expect(lightBlock).toContain("--background: oklch(1 0 0);");
  });

  it("默认 preset 是 zinc，且 7 套 id 都是官方 base 名", () => {
    const source = fs.readFileSync(sharedThemePath, "utf8");
    // 用正则而不是整串包含：prettier 会把这行折行，字面量断言会因此假红。
    expect(source).toMatch(
      /DEFAULT_THEME_PRESET\s*:\s*ThemePreset\s*=\s*"zinc"/,
    );
    for (const id of [
      "zinc",
      "neutral",
      "stone",
      "mauve",
      "olive",
      "mist",
      "taupe",
    ]) {
      expect(source, `缺 ${id}`).toContain(`"${id}"`);
    }
    // 旧的自造 id 不该再出现在**校验数组**里（只允许出现在 LEGACY 迁移映射里）。
    // ⚠️ 写这条时踩过坑：批量改名脚本会把断言里的旧名一起改成新名，于是断言变成
    // "数组里不该有 zinc" 而恒红。所以断言对象改成"数组文本里不得含旧名"。
    const valid =
      /export const VALID_THEME_PRESETS[^=]*=\s*\[([^\]]*)\]/s.exec(
        source,
      )?.[1] ?? "";
    expect(valid, "找不到 VALID_THEME_PRESETS 数组").not.toBe("");
    for (const legacy of [
      "graphite",
      "paper",
      "void",
      "ocean",
      "forest",
      "ember",
      "aurora",
    ]) {
      expect(valid, `校验数组里还有旧 id ${legacy}`).not.toContain(
        `"${legacy}"`,
      );
    }
  });
});
