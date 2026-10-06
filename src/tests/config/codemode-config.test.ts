import { describe, expect, it } from "vitest";
import { normalizeCodemodeConfig } from "../../shared/codemode-config";

describe("normalizeCodemodeConfig", () => {
  it("defaults to mode=on, and has no global enable switch", () => {
    // pi 没有 `enabled` —— 激活是派生的（有 exposure=codemode 的 server 连上时）。
    expect(normalizeCodemodeConfig(undefined)).toEqual({ mode: "on" });
    expect(normalizeCodemodeConfig(undefined)).not.toHaveProperty("enabled");
  });

  it("keeps a known mode and falls back to on for unknown ones", () => {
    expect(normalizeCodemodeConfig({ mode: "only" }).mode).toBe("only");
    expect(normalizeCodemodeConfig({ mode: "nope" }).mode).toBe("on");
  });

  it("drops the retired inlineBudget key from stored configs", () => {
    // 老用户配置里存过 3000；旋钮下线后这个键必须被丢弃，不再回落到用户值。
    expect(normalizeCodemodeConfig({ mode: "on", inlineBudget: 3000 })).toEqual(
      { mode: "on" },
    );
  });

  it("survives non-object input", () => {
    expect(normalizeCodemodeConfig("junk").mode).toBe("on");
    expect(normalizeCodemodeConfig(null).mode).toBe("on");
  });
});
