import { describe, it, expect } from "vitest";
import { hashColor } from "../../renderer/components/PiMarketDetail";

describe("hashColor", () => {
  it("returns a deterministic hex color for a name", () => {
    expect(hashColor("pi-subagents")).toBe(hashColor("pi-subagents"));
    expect(hashColor("pi-web-access")).toMatch(/^#[0-9a-f]{6}$/);
    // 深色保证白字可读（三通道均 ≤ 0x66）
    const hex = hashColor("pi-web-access").slice(1);
    for (let i = 0; i < 3; i++) {
      expect(parseInt(hex.slice(i * 2, i * 2 + 2), 16)).toBeLessThanOrEqual(0x66);
    }
  });

  it("differs across names", () => {
    expect(hashColor("pi-a")).not.toBe(hashColor("pi-b"));
  });
});
