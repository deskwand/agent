// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  GLOW_BALL_DARK,
  GLOW_BALL_LIGHT,
  GLOW_BRUSH,
  prefersReducedMotion,
  STARS_BRUSH_DARK,
  STARS_BRUSH_ICON_DARK,
  STARS_BRUSH_ICON_LIGHT,
  STARS_BRUSH_LIGHT,
} from "../../renderer/components/voice-mode/star-orb";
import {
  composite,
  contrast,
  parseAlphaColor,
  parseHex,
  rgbHex,
  themeBlocks,
  tokenOf,
} from "./theme-css-helpers";

/** 两个主题块里的 `--background`，转成 hex。 */
function themeBackgrounds(): { light: string; dark: string } {
  const blocks = themeBlocks();
  const light = blocks.find((b) => /^\s*\.light/.test(b))!;
  const dark = blocks.find((b) => /^\s*:root/.test(b))!;
  return {
    light: rgbHex(parseHex(tokenOf(light, "--background"))),
    dark: rgbHex(parseHex(tokenOf(dark, "--background"))),
  };
}

/** 把（可能带 alpha 的）颜色叠到背景上 —— 对比度必须拿混合后的颜色算。 */
function over(color: string, background: string): string {
  const parsed = parseAlphaColor(color);
  return composite(background, rgbHex(parsed.rgb), parsed.alpha);
}

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
    const lightBg = parseHex(tokenOf(lightBlock, "--background"));
    const darkBg = parseHex(tokenOf(darkBlock, "--background"));

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

  it("两套球画笔与全屏那支只有 ball 一项不同", () => {
    // 这条是**配置钉子**：它锁的是四个字面值，不是行为 —— 改色必须改这里。
    // 「改完之后白底上还看得见吗」由下面两条对比度钉子守。
    expect(GLOW_BALL_LIGHT).toEqual({
      ...GLOW_BRUSH,
      ball: {
        body: "#050507",
        edge: "rgba(15,20,45,0.10)",
        arc: "rgba(58,78,178,0.85)",
        shadow: { rgb: "28,36,84", a: 0.18 },
      },
    });
    expect(GLOW_BALL_DARK).toEqual({
      ...GLOW_BRUSH,
      ball: {
        body: "#050507",
        edge: "rgba(190,212,255,0.10)",
        arc: "rgba(226,238,255,0.28)",
      },
    });
    // 深底上看不见落影 —— 不画
    expect(GLOW_BALL_DARK.ball?.shadow).toBeUndefined();
  });

  it("球在浅底上是实心暗物，球界看得见但不成为实体", () => {
    const { light, dark } = themeBackgrounds();

    const body = GLOW_BALL_LIGHT.ball!.body;
    expect(contrast(over(body, light), light)).toBeGreaterThanOrEqual(15);

    const pairs = [
      [GLOW_BALL_LIGHT.ball!.edge, light],
      [GLOW_BALL_DARK.ball!.edge, dark],
    ] as const;
    for (const [edge, bg] of pairs) {
      const c = contrast(over(edge, bg), bg);
      expect(c).toBeGreaterThan(1.05); // 看得见
      expect(c).toBeLessThan(1.6); // 但不成为「实体」
    }
  });

  it("blocked 那圈弧在白底上看得见，深底上仍是原来的值", () => {
    const { light } = themeBackgrounds();
    const arc = GLOW_BALL_LIGHT.ball!.arc;
    expect(contrast(over(arc, light), light)).toBeGreaterThanOrEqual(3);
    // 既有值，本次不动它 —— 改它就不再是「只改浅色」
    expect(GLOW_BALL_DARK.ball!.arc).toBe("rgba(226,238,255,0.28)");
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
