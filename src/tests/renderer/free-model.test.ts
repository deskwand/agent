import { describe, expect, it } from "vitest";
import { isFreeModel } from "../../renderer/utils/free-model";

describe("isFreeModel", () => {
  it.each([
    "longcat-2.5-preview-free",
    "minimax-m3.1-flash-free",
    "beam-free",
    "openrouter/anthropic/claude:free",
  ])("treats %s as free by id", (id) => {
    expect(isFreeModel({ id })).toBe(true);
  });

  it("treats a Free word in the display name as free", () => {
    expect(
      isFreeModel({ id: "some-model", name: "LongCat 2.5 Preview Free" }),
    ).toBe(true);
    expect(isFreeModel({ id: "some-model", label: "Beam Free" })).toBe(true);
  });

  it("does not match free as part of another word", () => {
    expect(isFreeModel({ id: "freedom", name: "Freedom" })).toBe(false);
    expect(isFreeModel({ id: "freestyle-model", name: "Freestyle" })).toBe(
      false,
    );
  });

  it("ignores paid models", () => {
    expect(isFreeModel({ id: "kimi-k3", name: "Kimi K3" })).toBe(false);
    expect(isFreeModel({ id: "deepseek-v4.1-flash" })).toBe(false);
  });

  it("falls back to the label when the name is empty", () => {
    expect(
      isFreeModel({ id: "some-model", name: "", label: "Beam Free" }),
    ).toBe(true);
  });

  it("prefers an explicit free flag over the text heuristic", () => {
    expect(isFreeModel({ id: "big-pickle", free: true })).toBe(true);
  });
});
