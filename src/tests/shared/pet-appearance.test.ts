import { describe, expect, it, vi } from "vitest";
import {
  isPetAppearance,
  normalizePetCustomImage,
  resolvePetAppearance,
} from "../../shared/pet-appearance";

describe("normalizePetCustomImage", () => {
  it("accepts a safe file name and coerces enabled to a boolean", () => {
    expect(
      normalizePetCustomImage({ fileName: "custom-123.png", enabled: 1 }),
    ).toEqual({ fileName: "custom-123.png", enabled: true });
  });

  it.each([
    "../custom-1.png",
    "custom-1.jpg/../x",
    "/tmp/custom-1.png",
    "custom-1.bmp",
    "custom-1",
  ])("rejects %s", (fileName) => {
    expect(normalizePetCustomImage({ fileName, enabled: true })).toBeNull();
  });

  it("treats null, undefined and junk as no custom image", () => {
    expect(normalizePetCustomImage(null)).toBeNull();
    expect(normalizePetCustomImage(undefined)).toBeNull();
    expect(normalizePetCustomImage("custom-1.png")).toBeNull();
  });
});

describe("resolvePetAppearance", () => {
  it("does not read the file when the custom image is disabled", async () => {
    const readImage = vi.fn(async () => "data:image/png;base64,AAA");
    await expect(
      resolvePetAppearance({
        character: "ghost",
        customImage: { fileName: "custom-1.png", enabled: false },
        readImage,
      }),
    ).resolves.toEqual({ character: "ghost", image: null });
    expect(readImage).not.toHaveBeenCalled();
  });

  it("returns the custom image when enabled", async () => {
    await expect(
      resolvePetAppearance({
        character: "ghost",
        customImage: { fileName: "custom-1.png", enabled: true },
        readImage: async () => "data:image/png;base64,AAA",
      }),
    ).resolves.toEqual({
      character: "ghost",
      image: "data:image/png;base64,AAA",
    });
  });

  it("falls back to the built-in character when the read rejects", async () => {
    await expect(
      resolvePetAppearance({
        character: "ghost",
        customImage: { fileName: "custom-1.png", enabled: true },
        readImage: async () => {
          throw new Error("missing");
        },
      }),
    ).resolves.toEqual({ character: "ghost", image: null });
  });
});

describe("isPetAppearance", () => {
  it("accepts valid messages and rejects junk", () => {
    expect(isPetAppearance({ character: "lens", image: null })).toBe(true);
    expect(
      isPetAppearance({
        character: "lens",
        image: "data:image/png;base64,AAA",
      }),
    ).toBe(true);
    expect(isPetAppearance({ character: "dragon", image: null })).toBe(false);
    expect(isPetAppearance({ character: "lens", image: 42 })).toBe(false);
    expect(isPetAppearance(null)).toBe(false);
  });
});
