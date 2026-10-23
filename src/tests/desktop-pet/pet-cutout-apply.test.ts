import { describe, expect, it } from "vitest";
import {
  applyPetCutout,
  compositionRect,
  decodeDataUrl,
  isPetCutoutCandidate,
} from "../../renderer/pet-cutout-apply";

describe("isPetCutoutCandidate", () => {
  it("only accepts PNG data URLs", () => {
    expect(isPetCutoutCandidate("data:image/png;base64,AAAA")).toBe(true);
    expect(isPetCutoutCandidate("data:image/jpeg;base64,AAAA")).toBe(false);
    expect(isPetCutoutCandidate("data:image/gif;base64,AAAA")).toBe(false);
    expect(isPetCutoutCandidate("data:image/webp;base64,AAAA")).toBe(false);
    expect(isPetCutoutCandidate("https://example.com/cat.png")).toBe(false);
  });
});

describe("decodeDataUrl", () => {
  it("decodes base64 bytes and the MIME type", () => {
    expect(decodeDataUrl("data:image/png;base64,AAEC")).toEqual({
      mime: "image/png",
      bytes: new Uint8Array([0, 1, 2]),
    });
  });

  it("returns null for a non-base64 or malformed payload", () => {
    expect(decodeDataUrl("https://example.com/cat.png")).toBeNull();
    expect(decodeDataUrl("data:image/png;base64,!!!")).toBeNull();
  });
});

describe("compositionRect", () => {
  it("scales a landscape bbox to 92% and centers it", () => {
    expect(compositionRect({ x: 4, y: 4, w: 16, h: 8 })).toEqual({
      sx: 4,
      sy: 4,
      sw: 16,
      sh: 8,
      dx: 9,
      dy: 59,
      dw: 199,
      dh: 99,
    });
  });

  it("scales a portrait bbox by height and centers it", () => {
    expect(compositionRect({ x: 0, y: 0, w: 8, h: 16 })).toEqual({
      sx: 0,
      sy: 0,
      sw: 8,
      sh: 16,
      dx: 59,
      dy: 9,
      dw: 99,
      dh: 199,
    });
  });

  it("centers a square bbox", () => {
    expect(compositionRect({ x: 2, y: 3, w: 8, h: 8 })).toEqual({
      sx: 2,
      sy: 3,
      sw: 8,
      sh: 8,
      dx: 9,
      dy: 9,
      dw: 199,
      dh: 199,
    });
  });
});

describe("applyPetCutout", () => {
  it("returns null for non-PNG images immediately", async () => {
    await expect(
      applyPetCutout("data:image/gif;base64,AAAA"),
    ).resolves.toBeNull();
  });

  it("returns null when the environment has no createImageBitmap", async () => {
    // 单元测试跑在 node 环境：没有 canvas / createImageBitmap，必须安静回退。
    await expect(
      applyPetCutout("data:image/png;base64,AAAA"),
    ).resolves.toBeNull();
  });
});
