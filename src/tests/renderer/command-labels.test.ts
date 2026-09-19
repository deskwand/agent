// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { useAppStore } from "../../renderer/store";

describe("commandLabels", () => {
  it("初始为空 Map", () => {
    expect(useAppStore.getState().commandLabels.size).toBe(0);
  });

  it("setter 写入后可读回（slug → 显示文本）", () => {
    useAppStore.getState().setCommandLabels(
      new Map([
        ["translate", "翻译成英文"],
        ["plan", "/plan"],
      ]),
    );
    expect(useAppStore.getState().commandLabels.get("translate")).toBe("翻译成英文");
    expect(useAppStore.getState().commandLabels.get("plan")).toBe("/plan");
  });
});
