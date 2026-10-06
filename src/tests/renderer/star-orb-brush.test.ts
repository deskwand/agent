import { describe, expect, it } from "vitest";
import {
  GLOW_BRUSH,
  STARS_BRUSH_DARK,
  STARS_BRUSH_LIGHT,
} from "../../renderer/components/voice-mode/star-orb";
import {
  contrast,
  parseHex,
  rgbHex,
  themeBlocks,
  tokenOf,
} from "./theme-css-helpers";

/** palette 里各色相对亮度的算术平均，当「粒子亮度」；只用于方向性断言。 */
function meanRgb(palette: string[]): [number, number, number] {
  const sum = palette.reduce<[number, number, number]>(
    (acc, color) => {
      const [r, g, b] = color.split(",").map(Number);
      return [acc[0] + r, acc[1] + g, acc[2] + b];
    },
    [0, 0, 0],
  );
  return [
    Math.round(sum[0] / palette.length),
    Math.round(sum[1] / palette.length),
    Math.round(sum[2] / palette.length),
  ];
}

describe("星空球的画笔", () => {
  it("全屏档逐项等于现状", () => {
    expect(GLOW_BRUSH).toEqual({
      kind: "glow",
      palette: [
        "255,255,255",
        "204,224,255",
        "126,168,255",
        "172,152,255",
        "144,228,255",
      ],
      haze: 80,
      stars: 5200,
      sparks: 150,
      size: 1,
      composite: "lighter",
    });
  });

  it("两套星点画笔的结构一致，只有调色与描边不同", () => {
    for (const brush of [STARS_BRUSH_LIGHT, STARS_BRUSH_DARK]) {
      expect(brush.kind).toBe("stars");
      expect(brush.stars).toBe(300);
      expect(brush.core).toBe(40);
      expect(brush.size).toBe(0.75);
    }
    expect(STARS_BRUSH_LIGHT.edge).toBe("rgba(58,78,178,0.26)");
    expect(STARS_BRUSH_LIGHT.composite).toBe("source-over");
    expect(STARS_BRUSH_DARK.edge).toBe("rgba(190,212,255,0.22)");
    expect(STARS_BRUSH_DARK.composite).toBe("lighter");
  });

  it("粒子与底色的方向没搞反（浅底用深粒子、深底用浅粒子）", () => {
    const blocks = themeBlocks();
    const lightBlock = blocks.find((b) => /^\s*\.light/.test(b))!;
    const darkBlock = blocks.find((b) => /^\s*:root/.test(b))!;
    const lightBg = parseHex(tokenOf(lightBlock, "--color-background"));
    const darkBg = parseHex(tokenOf(darkBlock, "--color-background"));

    expect(
      contrast(rgbHex(meanRgb(STARS_BRUSH_LIGHT.palette)), rgbHex(lightBg)),
    ).toBeGreaterThanOrEqual(2.5);
    expect(
      contrast(rgbHex(meanRgb(STARS_BRUSH_DARK.palette)), rgbHex(darkBg)),
    ).toBeGreaterThanOrEqual(2.5);
  });
});
