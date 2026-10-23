import { describe, expect, it } from "vitest";
import {
  PET_CUTOUT_LIMITS,
  alphaStats,
  biggestInteriorHole,
  cornerBackground,
  cutoutAlpha,
  evaluateGate,
  extractAlpha,
  hasUsableAlpha,
  isUniformBackground,
  opaqueBBox,
  type RgbaImage,
} from "../../shared/pet-cutout";

type Pixel = [number, number, number, number];

function makeImage(
  width: number,
  height: number,
  pixel: (x: number, y: number) => Pixel,
): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = pixel(x, y);
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return { data, width, height };
}

const white: Pixel = [255, 255, 255, 255];
const red: Pixel = [255, 0, 0, 255];

function redSquareOnWhite(size = 16, inset = 4): RgbaImage {
  return makeImage(size, size, (x, y) =>
    x >= inset && x < size - inset && y >= inset && y < size - inset
      ? red
      : white,
  );
}

describe("hasUsableAlpha / extractAlpha", () => {
  it("detects pre-existing transparency and extracts the alpha channel", () => {
    const transparent = makeImage(2, 1, (x) =>
      x === 0 ? [0, 0, 0, 0] : [10, 20, 30, 255],
    );
    expect(hasUsableAlpha(transparent.data)).toBe(true);
    expect(Array.from(extractAlpha(transparent.data))).toEqual([0, 255]);

    const opaque = makeImage(2, 1, () => [10, 20, 30, 255]);
    expect(hasUsableAlpha(opaque.data)).toBe(false);
  });
});

describe("cornerBackground", () => {
  it("uses the median of the four 8×8 corner patches", () => {
    const image = makeImage(16, 16, (x, y) => {
      // 右上角混进一个噪点，中位数应仍然是白色。
      if (x === 15 && y === 0) return [0, 0, 0, 255];
      return white;
    });
    expect(cornerBackground(image)).toEqual([255, 255, 255]);
  });
});

describe("isUniformBackground", () => {
  it("accepts a flat background and a noisy flat background", () => {
    expect(isUniformBackground(redSquareOnWhite())).toBe(true);
    const noisy = makeImage(16, 16, (x, y) =>
      x === 15 && y === 0 ? [0, 0, 0, 255] : white,
    );
    expect(isUniformBackground(noisy)).toBe(true);
  });

  it("rejects a gradient background", () => {
    const gradient = makeImage(16, 16, (x) => [
      Math.round((x / 15) * 255),
      255,
      255,
      255,
    ]);
    expect(isUniformBackground(gradient)).toBe(false);
  });
});

describe("cutoutAlpha", () => {
  it("removes the edge-connected white background and keeps the red square", () => {
    const image = redSquareOnWhite();
    const cut = cutoutAlpha(image);
    expect(cut.alpha[0]).toBe(0);
    expect(cut.alpha[8 * 16 + 8]).toBe(255);
    expect(cut.bbox).toEqual({ x: 4, y: 4, w: 8, h: 8 });
    expect(cut.backgroundRatio).toBeGreaterThan(0.5);
  });

  it("keeps an interior region that matches the background color", () => {
    // 红方块中心留一块白：从边缘泛洪到不了，必须保持不透明（白肚/白衬衫）。
    const image = makeImage(16, 16, (x, y) => {
      const inSquare = x >= 4 && x < 12 && y >= 4 && y < 12;
      const inBelly = x >= 7 && x < 9 && y >= 7 && y < 9;
      return inSquare && !inBelly ? red : white;
    });
    const cut = cutoutAlpha(image);
    expect(cut.alpha[7 * 16 + 7]).toBe(255);
    expect(cut.alpha[0]).toBe(0);
  });

  it("returns no bbox when the whole image is background", () => {
    const image = makeImage(16, 16, () => white);
    const cut = cutoutAlpha(image);
    expect(cut.bbox).toBeNull();
    expect(cut.backgroundRatio).toBe(1);
  });

  it("reports a low background ratio for a busy/colorful image", () => {
    const image = makeImage(16, 16, (x, y) => [
      (x * 37) % 256,
      (y * 53) % 256,
      ((x + y) * 29) % 256,
      255,
    ]);
    expect(cutoutAlpha(image).backgroundRatio).toBeLessThan(
      PET_CUTOUT_LIMITS.BG_MIN_RATIO,
    );
  });
});

describe("opaqueBBox / biggestInteriorHole", () => {
  it("measures the opaque bbox and ignores a transparent border", () => {
    const alpha = new Uint8ClampedArray(16 * 16);
    for (let y = 4; y < 12; y += 1) {
      for (let x = 4; x < 12; x += 1) alpha[y * 16 + x] = 255;
    }
    expect(opaqueBBox(alpha, 16, 16)).toEqual({ x: 4, y: 4, w: 8, h: 8 });

    const allTransparent = new Uint8ClampedArray(16 * 16);
    expect(opaqueBBox(allTransparent, 16, 16)).toBeNull();
  });

  it("counts an interior transparent hole but not the background border", () => {
    const mask = new Uint8Array(16 * 16).fill(1);
    for (let y = 4; y < 12; y += 1) {
      for (let x = 4; x < 12; x += 1) mask[y * 16 + x] = 0;
    }
    // 中心 2×2 透明洞
    for (let y = 7; y < 9; y += 1) {
      for (let x = 7; x < 9; x += 1) mask[y * 16 + x] = 1;
    }
    expect(biggestInteriorHole(mask, 16, 16)).toBe(4);
  });
});

describe("alphaStats / evaluateGate", () => {
  const stats = (
    transparentRatio: number,
    opaqueRatio: number,
    biggestHole = 0,
  ) => ({ transparentRatio, opaqueRatio, biggestHole });

  it("accepts a subject with a reasonable transparent margin", () => {
    expect(evaluateGate(stats(0.75, 0.25))).toEqual({ ok: true });
  });

  it("rejects a tiny subject, an eaten subject and a missing subject", () => {
    expect(evaluateGate(stats(0.75, 0.01))).toEqual({
      ok: false,
      code: "too-small",
    });
    expect(evaluateGate(stats(0.95, 0.05))).toEqual({
      ok: false,
      code: "eaten-subject",
    });
    expect(evaluateGate(stats(0.05, 0.95))).toEqual({
      ok: false,
      code: "no-subject",
    });
    expect(evaluateGate(stats(0.5, 0.5, 300))).toEqual({
      ok: false,
      code: "holes",
    });
  });

  it("exposes the eagent thresholds unchanged", () => {
    expect(PET_CUTOUT_LIMITS).toEqual({
      BG_TOL: 40,
      SOFT_TOL: 70,
      SOFT_RING_PX: 2,
      FILL_HOLE_MAX_PX: 256,
      ALPHA_MIN: 0.1,
      ALPHA_MAX: 0.85,
      OPAQUE_MIN: 0.04,
      BG_MIN_RATIO: 0.02,
    });
  });
});

describe("alphaStats", () => {
  it("reports transparent/opaque ratios and the biggest interior hole", () => {
    const image = makeImage(16, 16, (x, y) => {
      const inSquare = x >= 4 && x < 12 && y >= 4 && y < 12;
      const inHole = x >= 7 && x < 9 && y >= 7 && y < 9;
      return inSquare && !inHole ? red : [0, 0, 0, 0];
    });
    expect(alphaStats(image)).toEqual({
      transparentRatio: 1 - 60 / 256,
      opaqueRatio: 60 / 256,
      biggestHole: 4,
    });
  });
});
