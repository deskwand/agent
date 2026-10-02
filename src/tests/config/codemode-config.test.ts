import { describe, expect, it } from "vitest";
import {
  DEFAULT_CODEMODE_INLINE_BUDGET,
  MAX_CODEMODE_INLINE_BUDGET,
  normalizeCodemodeConfig,
} from "../../shared/codemode-config";

describe("normalizeCodemodeConfig", () => {
  it("defaults to disabled with the upstream defaults (follows the reference implementation)", () => {
    expect(normalizeCodemodeConfig(undefined)).toEqual({
      enabled: false,
      mode: "on",
      inlineBudget: DEFAULT_CODEMODE_INLINE_BUDGET,
    });
  });

  it("requires an explicit true to enable", () => {
    // 只有字面 true 才开 —— 任何真值（"1"/1/{}）都不开，避免配置漂移
    expect(normalizeCodemodeConfig({ enabled: "true" }).enabled).toBe(false);
    expect(normalizeCodemodeConfig({ enabled: 1 }).enabled).toBe(false);
    expect(normalizeCodemodeConfig({ enabled: true }).enabled).toBe(true);
  });

  it("falls back to mode=on for unknown modes", () => {
    expect(normalizeCodemodeConfig({ mode: "nope" }).mode).toBe("on");
    expect(normalizeCodemodeConfig({ mode: "only" }).mode).toBe("only");
  });

  it("clamps a non-finite or out-of-range inlineBudget", () => {
    expect(normalizeCodemodeConfig({ inlineBudget: NaN }).inlineBudget).toBe(
      DEFAULT_CODEMODE_INLINE_BUDGET,
    );
    expect(normalizeCodemodeConfig({ inlineBudget: "abc" }).inlineBudget).toBe(
      DEFAULT_CODEMODE_INLINE_BUDGET,
    );
    expect(normalizeCodemodeConfig({ inlineBudget: -5 }).inlineBudget).toBe(0);
    expect(normalizeCodemodeConfig({ inlineBudget: 1e9 }).inlineBudget).toBe(
      MAX_CODEMODE_INLINE_BUDGET,
    );
    // 0 = 只列 namespace（上游语义），必须被保留而不是被当成缺省
    expect(normalizeCodemodeConfig({ inlineBudget: 0 }).inlineBudget).toBe(0);
  });

  it("survives non-object input", () => {
    expect(normalizeCodemodeConfig("junk").enabled).toBe(false);
    expect(normalizeCodemodeConfig(null).mode).toBe("on");
  });
});
