import { describe, expect, it } from "vitest";
import { formatChangeCount } from "../src/renderer/utils/overview-format";

describe("formatChangeCount", () => {
  it("keeps small counts plain", () => {
    expect(formatChangeCount(0)).toBe("0");
    expect(formatChangeCount(999)).toBe("999");
  });

  it("compacts thousands so the stat row never wraps", () => {
    expect(formatChangeCount(1234)).toBe("1.2k");
    expect(formatChangeCount(73562)).toBe("73.6k");
  });

  it("compacts millions", () => {
    expect(formatChangeCount(2_400_000)).toBe("2.4M");
  });
});
