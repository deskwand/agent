import { describe, expect, it } from "vitest";
import {
  formatContextPercentage,
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
