import { describe, expect, it } from "vitest";
import type { Message } from "../../renderer/types";
import {
  computeContextUsage,
  contextUsageLevel,
  findLastPromptInputTokens,
  formatContextPercentage,
  formatTokenCount,
  resolveDisplayedContextUsage,
} from "../../renderer/utils/context-usage";

describe("resolveDisplayedContextUsage", () => {
  it("uses exact usage when no compaction override exists", () => {
    expect(resolveDisplayedContextUsage(324745, undefined)).toEqual({
      tokens: 324745,
      isEstimated: false,
    });
  });

  it("uses the post-compaction estimate immediately", () => {
    expect(resolveDisplayedContextUsage(324745, 39400)).toEqual({
      tokens: 39400,
      isEstimated: true,
    });
  });

  it("returns unknown when compaction succeeded without an estimate", () => {
    expect(resolveDisplayedContextUsage(324745, null)).toEqual({
      tokens: null,
      isEstimated: true,
    });
  });
});

describe("formatContextPercentage", () => {
  it("omits the percent sign when usage is unknown", () => {
    expect(formatContextPercentage(null)).toBe("--");
  });

  it("appends the percent sign to known usage", () => {
    expect(formatContextPercentage("~14")).toBe("~14%");
  });
});


describe("computeContextUsage", () => {
  it("reports zero percent when the window is unknown", () => {
    expect(computeContextUsage(12000, undefined, undefined)).toEqual({
      tokens: 12000,
      isEstimated: false,
      percentage: 0,
    });
  });

  it("divides exact usage by the window", () => {
    expect(
      computeContextUsage(49000, undefined, 100000).percentage,
    ).toBeCloseTo(49);
  });

  it("clamps to 100 when usage exceeds the window", () => {
    expect(computeContextUsage(250000, undefined, 100000).percentage).toBe(100);
  });

  it("prefers the post-compaction estimate", () => {
    expect(computeContextUsage(250000, 30000, 100000)).toEqual({
      tokens: 30000,
      isEstimated: true,
      percentage: 30,
    });
  });
});

describe("contextUsageLevel", () => {
  it("keeps the default level at or below 80", () => {
    expect(contextUsageLevel(0)).toBe("default");
    expect(contextUsageLevel(80)).toBe("default");
  });

  it("warns above 80 and up to 95", () => {
    expect(contextUsageLevel(80.1)).toBe("warning");
    expect(contextUsageLevel(95)).toBe("warning");
  });

  it("turns destructive above 95", () => {
    expect(contextUsageLevel(95.1)).toBe("destructive");
  });
});

describe("formatTokenCount", () => {
  it("keeps small values plain", () => {
    expect(formatTokenCount(999)).toBe("999");
  });

  it("uses k for thousands and M for millions", () => {
    expect(formatTokenCount(1500)).toBe("1.5k");
    expect(formatTokenCount(1_500_000)).toBe("1.5M");
  });
});

describe("findLastPromptInputTokens", () => {
  const message = (id: string, totalPromptInput?: number): Message => ({
    id,
    sessionId: "s1",
    role: "assistant",
    content: [],
    timestamp: 1,
    tokenUsage: totalPromptInput
      ? { input: 0, output: 0, totalPromptInput }
      : undefined,
  });

  it("returns the last non-zero prompt token count", () => {
    expect(
      findLastPromptInputTokens([
        message("m1", 1000),
        message("m2"),
        message("m3", 4200),
      ]),
    ).toBe(4200);
  });

  it("returns zero when nothing reported usage", () => {
    expect(findLastPromptInputTokens([message("m1")])).toBe(0);
  });
});
