import { describe, it, expect } from "vitest";
import {
  clampZoom,
  stepZoom,
  zoomPercent,
} from "../../renderer/components/ImageLightbox";

describe("ImageLightbox utilities", () => {
  // ── clampZoom ──
  it("clampZoom returns value within bounds", () => {
    expect(clampZoom(0.5)).toBe(0.5);
    expect(clampZoom(5.0)).toBe(5.0);
    expect(clampZoom(1.0)).toBe(1.0);
  });

  it("clampZoom floors values below min", () => {
    expect(clampZoom(0)).toBe(0.5);
    expect(clampZoom(-1)).toBe(0.5);
    expect(clampZoom(0.25)).toBe(0.5);
  });

  it("clampZoom caps values above max", () => {
    expect(clampZoom(6)).toBe(5.0);
    expect(clampZoom(5.5)).toBe(5.0);
    expect(clampZoom(10)).toBe(5.0);
  });

  // ── stepZoom ──
  it("stepZoom increases by step", () => {
    expect(stepZoom(1, 0.25)).toBe(1.25);
    expect(stepZoom(2, 0.25)).toBe(2.25);
  });

  it("stepZoom decreases by step", () => {
    expect(stepZoom(2, -0.25)).toBe(1.75);
    expect(stepZoom(1, -0.5)).toBe(0.5);
  });

  it("stepZoom stays within bounds on increment", () => {
    expect(stepZoom(5.0, 0.25)).toBe(5.0);
    expect(stepZoom(4.75, 0.5)).toBe(5.0);
  });

  it("stepZoom stays within bounds on decrement", () => {
    expect(stepZoom(0.5, -0.25)).toBe(0.5);
    expect(stepZoom(0.75, -0.5)).toBe(0.5);
  });

  // ── zoomPercent ──
  it("zoomPercent rounds correctly", () => {
    expect(zoomPercent(1)).toBe(100);
    expect(zoomPercent(0.5)).toBe(50);
    expect(zoomPercent(2.0)).toBe(200);
    expect(zoomPercent(0.333)).toBe(33);
    expect(zoomPercent(5.0)).toBe(500);
  });
});
