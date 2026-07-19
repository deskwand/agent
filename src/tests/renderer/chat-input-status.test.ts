import { describe, it, expect } from "vitest";
import { resolveInputStatus } from "../../renderer/components/ChatInputStatusBar";

describe("resolveInputStatus", () => {
  const base = {
    isSending: false,
    isCompacting: false,
    compactionResult: null as "success" | "failed" | "aborted" | null,
    steeringText: "",
    steeringAcceptedText: "",
    steeringFailedText: "",
    shouldShowThinkingIndicator: false,
    isResponding: false,
  };

  it("returns null when all inputs are inactive", () => {
    expect(resolveInputStatus(base)).toBeNull();
  });

  it("returns compacting when isCompacting is true", () => {
    expect(resolveInputStatus({ ...base, isCompacting: true })).toEqual({
      type: "compacting",
    });
  });

  it("returns sending when isSending is true", () => {
    expect(
      resolveInputStatus({ ...base, isSending: true }),
    ).toEqual({ type: "sending" });
  });

  it("compacting wins over everything else", () => {
    expect(
      resolveInputStatus({
        isSending: true,
        isCompacting: true,
        compactionResult: "failed",
        steeringText: "do something",
        steeringAcceptedText: "",
        steeringFailedText: "",
        shouldShowThinkingIndicator: true,
        isResponding: false,
      }),
    ).toEqual({ type: "compacting" });
  });

  it("returns compaction-failed when result is failed", () => {
    expect(
      resolveInputStatus({ ...base, compactionResult: "failed" }),
    ).toEqual({ type: "compaction-failed" });
  });

  it("returns compaction-aborted for a cancelled compaction", () => {
    expect(
      resolveInputStatus({ ...base, compactionResult: "aborted" }),
    ).toEqual({ type: "compaction-aborted" });
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

  it("returns responding when isResponding is true", () => {
    expect(
      resolveInputStatus({ ...base, isResponding: true }),
    ).toEqual({ type: "responding" });
  });

  it("thinking wins over responding", () => {
    expect(
      resolveInputStatus({
        ...base,
        shouldShowThinkingIndicator: true,
        isResponding: true,
      }),
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

  it("returns steering-accepted when accepted text is present", () => {
    expect(
      resolveInputStatus({
        ...base,
        steeringAcceptedText: "fix login",
      }),
    ).toEqual({ type: "steering-accepted", text: "fix login" });
  });

  it("steering-accepted wins over steering", () => {
    expect(
      resolveInputStatus({
        ...base,
        steeringText: "fix login",
        steeringAcceptedText: "fix login",
        shouldShowThinkingIndicator: true,
      }),
    ).toEqual({ type: "steering-accepted", text: "fix login" });
  });

  it("compaction-failed wins over steering-accepted", () => {
    expect(
      resolveInputStatus({
        ...base,
        compactionResult: "failed",
        steeringAcceptedText: "fix login",
      }),
    ).toEqual({ type: "compaction-failed" });
  });

  it("returns steering-failed when failed text is present", () => {
    expect(
      resolveInputStatus({
        ...base,
        steeringFailedText: "fix login",
      }),
    ).toEqual({ type: "steering-failed", text: "fix login" });
  });

  it("steering-failed wins over thinking", () => {
    expect(
      resolveInputStatus({
        ...base,
        steeringFailedText: "fix login",
        shouldShowThinkingIndicator: true,
      }),
    ).toEqual({ type: "steering-failed", text: "fix login" });
  });

});
