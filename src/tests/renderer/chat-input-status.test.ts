import { describe, it, expect } from "vitest";
import { resolveInputStatus } from "../../renderer/components/ChatInputStatusBar";

describe("resolveInputStatus", () => {
  const base = {
    isCompacting: false,
    compactionResult: null as "success" | "failed" | null,
    steeringText: "",
    shouldShowThinkingIndicator: false,
  };

  it("returns null when all inputs are inactive", () => {
    expect(resolveInputStatus(base)).toBeNull();
  });

  it("returns compacting when isCompacting is true", () => {
    expect(resolveInputStatus({ ...base, isCompacting: true })).toEqual({
      type: "compacting",
    });
  });

  it("compacting wins over everything else", () => {
    expect(
      resolveInputStatus({
        isCompacting: true,
        compactionResult: "failed",
        steeringText: "do something",
        shouldShowThinkingIndicator: true,
      }),
    ).toEqual({ type: "compacting" });
  });

  it("returns compaction-failed when result is failed", () => {
    expect(
      resolveInputStatus({ ...base, compactionResult: "failed" }),
    ).toEqual({ type: "compaction-failed" });
  });

  it("compaction-failed wins over steering", () => {
    expect(
      resolveInputStatus({
        ...base,
        compactionResult: "failed",
        steeringText: "do something",
      }),
    ).toEqual({ type: "compaction-failed" });
  });

  it("returns steering when steeringText is present", () => {
    expect(
      resolveInputStatus({ ...base, steeringText: "fix login" }),
    ).toEqual({ type: "steering", text: "fix login" });
  });

  it("steering wins over thinking", () => {
    expect(
      resolveInputStatus({
        ...base,
        steeringText: "fix login",
        shouldShowThinkingIndicator: true,
      }),
    ).toEqual({ type: "steering", text: "fix login" });
  });

  it("returns thinking when shouldShowThinkingIndicator is true", () => {
    expect(
      resolveInputStatus({ ...base, shouldShowThinkingIndicator: true }),
    ).toEqual({ type: "thinking" });
  });

  it("returns compaction-success only when nothing higher is active", () => {
    expect(
      resolveInputStatus({ ...base, compactionResult: "success" }),
    ).toEqual({ type: "compaction-success" });
  });

  it("compaction-success is hidden by steering", () => {
    expect(
      resolveInputStatus({
        ...base,
        compactionResult: "success",
        steeringText: "fix login",
      }),
    ).toEqual({ type: "steering", text: "fix login" });
  });

  it("compaction-success wins over thinking", () => {
    expect(
      resolveInputStatus({
        ...base,
        compactionResult: "success",
        shouldShowThinkingIndicator: true,
      }),
    ).toEqual({ type: "compaction-success" });
  });

});
