import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_THEME_ACCENT,
  normalizeThemeAccent,
  VALID_THEME_ACCENTS,
} from "../../shared/theme";

describe("accent id 归一", () => {
  it("17 套官方强调色 + default 都在白名单里", () => {
    expect(VALID_THEME_ACCENTS[0]).toBe("default");
    const official = VALID_THEME_ACCENTS.slice(1);
    expect(official).toHaveLength(17);
    for (const id of [
      "amber",
      "blue",
      "cyan",
      "emerald",
      "fuchsia",
      "green",
      "indigo",
      "lime",
      "orange",
      "pink",
      "purple",
      "red",
      "rose",
      "sky",
      "teal",
      "violet",
      "yellow",
    ]) {
      expect(official, `缺 ${id}`).toContain(id);
    }
  });

  it("缺省/未知值落 default（老配置里没有这个字段）", () => {
    expect(normalizeThemeAccent(undefined)).toBe(DEFAULT_THEME_ACCENT);
    expect(normalizeThemeAccent("nope")).toBe(DEFAULT_THEME_ACCENT);
    expect(normalizeThemeAccent(7)).toBe(DEFAULT_THEME_ACCENT);
  });

  it("合法 id 原样通过", () => {
    for (const id of VALID_THEME_ACCENTS) {
      expect(normalizeThemeAccent(id)).toBe(id);
    }
  });

  it("强调色白名单与官方快照逐一对齐（不许多也不许少）", () => {
    // 用 fs 读而不是 require()：ESLint 的 @typescript-eslint/no-var-requires 会拦下后者。
    const official = Object.keys(
      JSON.parse(
        fs.readFileSync(
          path.resolve(
            process.cwd(),
            "src/renderer/styles/official-accents.json",
          ),
          "utf8",
        ),
      ),
    ).sort();
    expect(
      [...VALID_THEME_ACCENTS].filter((a) => a !== "default").sort(),
    ).toEqual(official);
  });
});
