// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { selectEffectiveTheme } from "../../renderer/store/selectors";

describe("有效主题推导", () => {
  it("显式 light / dark 不被系统设置覆盖", () => {
    expect(selectEffectiveTheme("light", true)).toBe("light");
    expect(selectEffectiveTheme("dark", false)).toBe("dark");
  });

  it("system 跟随系统深浅", () => {
    expect(selectEffectiveTheme("system", true)).toBe("dark");
    expect(selectEffectiveTheme("system", false)).toBe("light");
  });
});
