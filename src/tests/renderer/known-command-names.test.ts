// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { useAppStore } from "../../renderer/store";

describe("knownCommandNames", () => {
  it("初始为空集合", () => {
    expect(useAppStore.getState().knownCommandNames.size).toBe(0);
  });

  it("setter 写入后可读回", () => {
    useAppStore.getState().setKnownCommandNames(new Set(["plan", "review"]));
    expect([...useAppStore.getState().knownCommandNames].sort()).toEqual([
      "plan",
      "review",
    ]);
  });
});
