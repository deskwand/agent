// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  GLOW_BRUSH,
  prefersReducedMotion,
  STARS_BRUSH_DARK,
  STARS_BRUSH_ICON_DARK,
  STARS_BRUSH_ICON_LIGHT,
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

/** 取 `rgba(...)` 里的 alpha。写法变了就是 NaN，断言会带着它一起失败。 */
function alphaOf(color: string): number {
  return Number(color.match(/rgba\([^)]*?,\s*([\d.]+)\)/)?.[1]);
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

  it("图标档：粒子砍到 64、放大到 1.5×、描边让开", () => {
    for (const brush of [STARS_BRUSH_ICON_LIGHT, STARS_BRUSH_ICON_DARK]) {
      expect(brush.kind).toBe("stars");
      expect(brush.stars).toBe(64);
      expect(brush.core).toBe(14);
      expect(brush.size).toBe(1.5);
    }
    expect(STARS_BRUSH_ICON_LIGHT.composite).toBe("source-over");
    expect(STARS_BRUSH_ICON_DARK.composite).toBe("lighter");
    // 描边要比 40px 那支更淡：小尺寸下它是抢戏元素，不是球界
    expect(alphaOf(STARS_BRUSH_ICON_LIGHT.edge)).toBeLessThan(
      alphaOf(STARS_BRUSH_LIGHT.edge),
    );
    expect(alphaOf(STARS_BRUSH_ICON_DARK.edge)).toBeLessThan(
      alphaOf(STARS_BRUSH_DARK.edge),
    );
  });

  it("图标档与 40px 档是同族两支，不是同一支的缩放", () => {
    expect(STARS_BRUSH_ICON_LIGHT.stars).toBeLessThan(STARS_BRUSH_LIGHT.stars);
    expect(STARS_BRUSH_ICON_LIGHT.size).toBeGreaterThan(STARS_BRUSH_LIGHT.size);
    // 深浅方向没搞反：两支的调色是同一份
    expect(STARS_BRUSH_ICON_LIGHT.palette).toEqual(STARS_BRUSH_LIGHT.palette);
    expect(STARS_BRUSH_ICON_DARK.palette).toEqual(STARS_BRUSH_DARK.palette);
  });
});

describe("减少动态偏好", () => {
  it("媒体查询命中时返回 true，未命中 / 环境没有 matchMedia 时返回 false", () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes("prefers-reduced-motion: reduce"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    expect(prefersReducedMotion()).toBe(true);

    window.matchMedia = (() => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    expect(prefersReducedMotion()).toBe(false);

    // 没有 matchMedia 的环境（老 jsdom / 极简替身）不能抛
    delete (window as unknown as { matchMedia?: unknown }).matchMedia;
    expect(prefersReducedMotion()).toBe(false);

    window.matchMedia = original;
  });
});
