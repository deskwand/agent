import { describe, expect, it } from "vitest";
import { hasMorePages } from "../../renderer/components/PiMarketList";

describe("hasMorePages", () => {
  it("allows loading within the 240 cap", () => {
    expect(hasMorePages(0, 6437)).toBe(true); // 20 < 240
    expect(hasMorePages(10, 6437)).toBe(true); // 220 < 240
    expect(hasMorePages(11, 6437)).toBe(false); // 240 已满
    expect(hasMorePages(12, 6437)).toBe(false);
  });

  it("stops at total when fewer than 240", () => {
    expect(hasMorePages(0, 15)).toBe(false); // 20 >= 15
    expect(hasMorePages(1, 30)).toBe(false); // 40 >= 30
    expect(hasMorePages(0, 30)).toBe(true); // 20 < 30
  });
});
