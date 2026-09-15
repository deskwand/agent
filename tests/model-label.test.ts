import { describe, it, expect } from "vitest";
import { resolveModelLabel } from "../src/renderer/utils/model-label";
import type { ModelOptionGroup } from "../src/renderer/components/ChatInputBottomBar";

function group(
  profileKey: string,
  items: Array<{ id: string; name: string }>,
): ModelOptionGroup {
  return { profileKey, groupLabel: profileKey, items };
}

describe("resolveModelLabel", () => {
  const options: ModelOptionGroup[] = [
    group("custom:deskwand", [
      { id: "deepseek-v4-flash", name: "deepseek-v4-flash" },
      { id: "deepseek-v4-pro", name: "deepseek-v4-pro" },
    ]),
    group("custom:openai", [
      { id: "deepseek-v4-flash", name: "deepseek-v4-flash" },
    ]),
  ];

  it("returns the real model id for deskwand cloud models", () => {
    expect(
      resolveModelLabel(options, "custom:deskwand", "deepseek-v4-flash"),
    ).toBe("deepseek-v4-flash");
    expect(
      resolveModelLabel(options, "custom:deskwand", "deepseek-v4-pro"),
    ).toBe("deepseek-v4-pro");
  });

  it("does not leak labels across providers with the same model id", () => {
    // custom:openai 分组的同名模型 label 是 id 本身
    expect(
      resolveModelLabel(options, "custom:openai", "deepseek-v4-flash"),
    ).toBe("deepseek-v4-flash");
  });

  it("falls back to model id when not found", () => {
    expect(resolveModelLabel(options, "custom:deskwand", "unknown-model")).toBe(
      "unknown-model",
    );
    expect(resolveModelLabel(options, "nonexistent", "deepseek-v4-flash")).toBe(
      "deepseek-v4-flash",
    );
  });

  it("falls back to empty string when model is empty", () => {
    expect(resolveModelLabel(options, "custom:deskwand", "")).toBe("");
  });
});
