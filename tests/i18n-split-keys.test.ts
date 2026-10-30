import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const load = (locale: string) =>
  JSON.parse(
    fs.readFileSync(
      path.resolve(process.cwd(), `src/renderer/i18n/locales/${locale}.json`),
      "utf8",
    ),
  );

function flatten(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const full = prefix ? `${prefix}.${key}` : key;
    return typeof value === "object" && value !== null
      ? flatten(value as Record<string, unknown>, full)
      : [full];
  });
}

describe("split i18n key parity", () => {
  it("zh and en expose identical split keys", () => {
    const zhKeys = flatten(load("zh"))
      .filter((key) => key.startsWith("split."))
      .sort();
    const enKeys = flatten(load("en"))
      .filter((key) => key.startsWith("split."))
      .sort();

    expect(zhKeys.length).toBeGreaterThan(10);
    expect(zhKeys).toEqual(enKeys);
  });
});
