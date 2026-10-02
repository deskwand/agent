import { describe, expect, it } from "vitest";
import {
  DEFAULT_CODEMODE_INLINE_BUDGET,
  MAX_CODEMODE_INLINE_BUDGET,
  normalizeCodemodeConfig,
} from "../../shared/codemode-config";

describe("normalizeCodemodeConfig", () => {
  it("defaults to the upstream values, and has no global enable switch", () => {
    // pi 没有 `enabled` —— 激活是派生的（有 exposure=codemode 的 server 连上时）。
    expect(normalizeCodemodeConfig(undefined)).toEqual({
      mode: "on",
      inlineBudget: DEFAULT_CODEMODE_INLINE_BUDGET,
    });
    expect(normalizeCodemodeConfig(undefined)).not.toHaveProperty("enabled");
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
    expect(normalizeCodemodeConfig("junk").mode).toBe("on");
    expect(normalizeCodemodeConfig(null).mode).toBe("on");
  });
});
