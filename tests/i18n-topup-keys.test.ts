import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const zh = JSON.parse(
  fs.readFileSync(
    path.resolve(process.cwd(), "src/renderer/i18n/locales/zh.json"),
    "utf8",
  ),
);
const en = JSON.parse(
  fs.readFileSync(
    path.resolve(process.cwd(), "src/renderer/i18n/locales/en.json"),
    "utf8",
  ),
);

function flatten(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    return typeof v === "object" && v !== null
      ? flatten(v as Record<string, unknown>, key)
      : [key];
  });
}

describe("topUp i18n key parity", () => {
  it("zh and en expose identical topUp and accountMenu keys", () => {
    const zhKeys = flatten(zh)
      .filter((k) => k.startsWith("topUp.") || k.startsWith("accountMenu."))
      .sort();
    const enKeys = flatten(en)
      .filter((k) => k.startsWith("topUp.") || k.startsWith("accountMenu."))
      .sort();
    expect(zhKeys).toEqual(enKeys);
  });
});
