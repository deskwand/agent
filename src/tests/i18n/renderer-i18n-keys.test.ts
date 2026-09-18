import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import en from "../../renderer/i18n/locales/en.json";
import zh from "../../renderer/i18n/locales/zh.json";

/**
 * `t()` 查不到 key 时会把 key 原样渲染到界面上（tooltip 里出现
 * `titlebar.fileBrowser` 这种原始 key）。`main-i18n-keys.test.ts` 守的是主进程
 * 消息表，`locale-parity.test.ts` 只比 zh/en 两侧的 key 集合，都看不到
 * 「代码里写了、语言包里没有」这一类，所以在这里兜。
 *
 * 已知缺口（刻意不处理）：首参是变量或模板字符串的调用（约 70 处，如
 * t(`usage.range.${value})`、t(banner.key)），以及存在数据表里再传给 t() 的
 * key（如 utils/sandbox-i18n.ts 的映射表、ScheduleCalendar 的 WEEKDAY 数组）。
 * 这类靠运行时 missing-key 告警兜底。
 */
const T_CALL = /\bt\(\s*["`]([a-zA-Z][\w.]*)["`]/g;

// i18next 用 _one/_other 表达复数，代码里写的是不带后缀的基础 key。
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

type Json = Record<string, unknown>;

function leafKeys(value: Json, prefix = ""): string[] {
  return Object.entries(value).flatMap(([key, child]) => {
    const full = prefix ? `${prefix}.${key}` : key;
    return child !== null && typeof child === "object"
      ? leafKeys(child as Json, full)
      : [full.replace(PLURAL_SUFFIX, "")];
  });
}

function listSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) listSourceFiles(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("renderer i18n keys", () => {
  it("resolves every literal t() key used in src/renderer", () => {
    const zhKeys = new Set(leafKeys(zh as Json));
    const enKeys = new Set(leafKeys(en as Json));
    const unresolved: string[] = [];

    for (const file of listSourceFiles("src/renderer")) {
      const relative = file.split("\\").join("/");
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(T_CALL)) {
        const key = match[1];
        if (zhKeys.has(key) && enKeys.has(key)) continue;
        const zhStatus = zhKeys.has(key) ? "ok" : "MISSING";
        const enStatus = enKeys.has(key) ? "ok" : "MISSING";
        unresolved.push(`${relative}: ${key} (zh:${zhStatus} en:${enStatus})`);
      }
    }

    expect([...new Set(unresolved)].sort()).toEqual([]);
  });
});
