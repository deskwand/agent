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

describe("project delete i18n key parity", () => {
  it("zh and en expose identical sidebar.deleteProject keys", () => {
    const zhKeys = flatten(zh)
      .filter((k) => k.startsWith("sidebar.deleteProject"))
      .sort();
    const enKeys = flatten(en)
      .filter((k) => k.startsWith("sidebar.deleteProject"))
      .sort();
    expect(enKeys).toEqual(zhKeys);
    expect(zhKeys).toContain("sidebar.deleteProjectRunningHint_one");
    expect(zhKeys).toContain("sidebar.deleteProjectRunningHint_other");

    // 只说 key 对齐不够：文案漏掉 {{count}} 时提示会写成「个会话还在进行中」，
    // 而 key 对比完全看不出来。
    for (const value of [
      zh.sidebar.deleteProjectRunningHint_one,
      zh.sidebar.deleteProjectRunningHint_other,
      en.sidebar.deleteProjectRunningHint_one,
      en.sidebar.deleteProjectRunningHint_other,
    ]) {
      expect(value).toContain("{{count}}");
    }
  });
});
