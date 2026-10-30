import { describe, expect, it } from "vitest";
import { formatFailureSuffix } from "../../renderer/utils/tool-display-blocks";

const t = ((key: string, params?: Record<string, unknown>) =>
  params ? `${key}:${params.count}` : key) as never;

describe("formatFailureSuffix", () => {
  it("没有失败时不产出后缀", () => {
    expect(formatFailureSuffix(0, t)).toBe("");
  });

  it("有失败时带计数", () => {
    expect(formatFailureSuffix(1, t)).toBe("tool.grouped.failedCount:1");
    expect(formatFailureSuffix(3, t)).toBe("tool.grouped.failedCount:3");
  });
});
