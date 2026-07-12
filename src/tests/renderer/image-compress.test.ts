import { describe, it, expect } from "vitest";
import {
  computeTargetDimensions,
  shouldProcessImage,
} from "../../renderer/utils/image-compress";

describe("computeTargetDimensions", () => {
  const MAX_DIM = 1568;

  it("scales down landscape image exceeding max dimension", () => {
    const result = computeTargetDimensions(3000, 2000, MAX_DIM);
    expect(result.width).toBe(1568);
    expect(result.height).toBe(1045); // Math.round(2000 * 1568/3000) = 1045
  });

  it("scales down portrait image exceeding max dimension", () => {
    const result = computeTargetDimensions(2000, 3000, MAX_DIM);
    expect(result.width).toBe(1045); // Math.round(2000 * 1568/3000) = 1045
    expect(result.height).toBe(1568); // Math.round(3000 * 1568/3000) = 1568
  });

  it("keeps square image at max dimension when oversized", () => {
    const result = computeTargetDimensions(2000, 2000, MAX_DIM);
    expect(result.width).toBe(1568);
    expect(result.height).toBe(1568);
  });

  it("leaves small images unchanged", () => {
    const result = computeTargetDimensions(500, 300, MAX_DIM);
    expect(result.width).toBe(500);
    expect(result.height).toBe(300);
  });

  it("leaves image exactly at limit unchanged", () => {
    const result = computeTargetDimensions(1568, 1000, MAX_DIM);
    expect(result.width).toBe(1568);
    expect(result.height).toBe(1000);
  });

  it("handles edge case: width is longest but both exceed", () => {
    const result = computeTargetDimensions(4000, 1569, MAX_DIM);
    expect(result.width).toBe(1568);
    expect(result.height).toBe(615); // Math.round(1569 * 1568/4000) = 615
  });

  it("handles edge case: height is longest but both exceed", () => {
    const result = computeTargetDimensions(1569, 4000, MAX_DIM);
    expect(result.width).toBe(615); // Math.round(1569 * 1568/4000) = 615
    expect(result.height).toBe(1568); // Math.round(4000 * 1568/4000) = 1568
  });
});

describe("shouldProcessImage", () => {
  it("returns true for common raster image types", () => {
    expect(shouldProcessImage("image/png")).toBe(true);
    expect(shouldProcessImage("image/jpeg")).toBe(true);
    expect(shouldProcessImage("image/webp")).toBe(true);
    expect(shouldProcessImage("image/bmp")).toBe(true);
    expect(shouldProcessImage("image/avif")).toBe(true);
  });

  it("returns false for GIF", () => {
    expect(shouldProcessImage("image/gif")).toBe(false);
  });

  it("returns false for SVG", () => {
    expect(shouldProcessImage("image/svg+xml")).toBe(false);
  });

  it("returns false for non-image types", () => {
    expect(shouldProcessImage("text/plain")).toBe(false);
    expect(shouldProcessImage("application/pdf")).toBe(false);
    expect(shouldProcessImage("")).toBe(false);
  });

  it("returns true for degenerate image/ type (gracefully rejects later)", () => {
    // "image/" has no subtype — shouldProcessImage lets it through.
    // loadImageFromBlob will reject on decode, so the error is surfaced correctly.
    // In practice, real Blobs always have a subtype (image/png, etc.),
    // so this path is never hit in normal usage.
    expect(shouldProcessImage("image/")).toBe(true);
  });
});
