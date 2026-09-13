import { describe, expect, it } from "vitest";
import en from "../../renderer/i18n/locales/en.json";
import zh from "../../renderer/i18n/locales/zh.json";

type Json = Record<string, unknown>;

// i18next plural suffixes: Chinese has no plural forms and only uses the base
// key, English uses _one/_other. Comparing raw keys would flag that correct
// behaviour as drift and push people to give Chinese _one/_other keys too.
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

/** Flattens to "a.b.c" leaf keys, normalizing plural variants to the base key. */
function leafKeys(value: Json, prefix = ""): string[] {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child !== null && typeof child === "object") {
      return leafKeys(child as Json, path);
    }
    const leaf = key.replace(PLURAL_SUFFIX, "");
    return [prefix ? `${prefix}.${leaf}` : leaf];
  });
}

describe("i18n locale parity", () => {
  it("zh and en expose exactly the same key set", () => {
    const zhKeys = new Set(leafKeys(zh as Json));
    const enKeys = new Set(leafKeys(en as Json));

    const missingInEn = [...zhKeys].filter((key) => !enKeys.has(key)).sort();
    const missingInZh = [...enKeys].filter((key) => !zhKeys.has(key)).sort();

    expect({ missingInEn, missingInZh }).toEqual({
      missingInEn: [],
      missingInZh: [],
    });
  });
});
