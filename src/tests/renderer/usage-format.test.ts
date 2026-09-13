import { describe, expect, it } from "vitest";
import {
  bucketHitRate,
  bucketVolume,
  compactNumber,
  formatHitRate,
  resolveCellLevel,
} from "../../renderer/utils/usage-format";
import type { UsageDayRow } from "../../shared/usage";

describe("compactNumber", () => {
  it("scales to K/M/B with one decimal", () => {
    expect(compactNumber(999)).toBe("999");
    expect(compactNumber(1_500)).toBe("1.5K");
    expect(compactNumber(2_400_000)).toBe("2.4M");
    expect(compactNumber(13_990_180_224)).toBe("13.99B");
  });
});

describe("formatHitRate", () => {
  it("renders an em dash when the provider reports no cache", () => {
    expect(formatHitRate(null)).toBe("—");
  });

  it("renders one decimal otherwise", () => {
    expect(formatHitRate(98.19)).toBe("98.2%");
  });
});

describe("bucketVolume", () => {
  const all = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

  it("returns 0 for missing data", () => {
    expect(bucketVolume(undefined as unknown as number, all)).toBe(0);
  });

  it("buckets into four levels by quantile", () => {
    expect(bucketVolume(1, all)).toBe(1);
    expect(bucketVolume(4, all)).toBe(2);
    expect(bucketVolume(7, all)).toBe(3);
    expect(bucketVolume(12, all)).toBe(4);
  });

  it("keeps any non-zero value visible even when tiny", () => {
    expect(bucketVolume(1, all)).toBeGreaterThan(0);
  });
});

describe("bucketHitRate", () => {
  it("uses semantic bands, 1-based so level 0 stays reserved for 'no record'", () => {
    expect(bucketHitRate(85)).toBe(1);
    expect(bucketHitRate(92)).toBe(2);
    expect(bucketHitRate(96)).toBe(3);
    expect(bucketHitRate(98)).toBe(4);
    expect(bucketHitRate(99.5)).toBe(5);
  });

  it("never returns 0, which would render a bad day as an empty cell", () => {
    for (const rate of [0, 10, 50, 89.9, 100]) {
      expect(bucketHitRate(rate)).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("resolveCellLevel", () => {
  const row = (
    input: number,
    output: number,
    cacheRead: number,
    hitRate: number | null,
  ): UsageDayRow => ({
    date: "2026-09-12",
    input,
    output,
    cacheRead,
    calls: 1,
    hitRate,
  });

  it("treats a missing day as empty", () => {
    expect(resolveCellLevel(undefined, "hit", [])).toBe(0);
  });

  it("gives a low but recorded hit rate a visible level (regression)", () => {
    const level = resolveCellLevel(row(100, 10, 20, 16.7), "hit", [30]);
    expect(level).toBe(1);
  });

  it("maps a day with no reported cache to empty rather than 0%", () => {
    expect(resolveCellLevel(row(100, 10, 0, null), "hit", [110])).toBe(0);
  });

  it("scales usage days by volume", () => {
    const level = resolveCellLevel(row(0, 0, 500, 99), "usage", [10, 100, 500]);
    expect(level).toBeGreaterThanOrEqual(1);
  });
});
