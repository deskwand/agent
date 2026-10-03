// src/tests/config/voice-wiring.test.ts
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  defaultStoredConfig,
  normalizeVoiceEngineConfig,
} from "../../main/config/config-store";

const read = (relative: string) =>
  fs.readFileSync(path.join(process.cwd(), relative), "utf8");

/**
 * 接线守卫（不是行为断言）。守的是 `codemode-wiring.test.ts` 记录过的那类真实
 * 回归：加了配置字段却漏了 configStore.update() 的持久化分支，设置界面一改就被
 * 无声回滚。
 */
describe("voice wiring guards", () => {
  it("persists voiceEngine in configStore.update()", () => {
    const source = read("src/main/config/config-store.ts");
    expect(source).toContain("stored.voiceEngine =");
  });

  it("projects it out of stored config", () => {
    const source = read("src/main/config/config-store.ts");
    // 不能只查 `voiceEngine:` —— 那个字符串在接口声明、默认值里都会命中，
    // 而漏掉投影恰恰是本测试要防的那个回归。
    expect(source).toContain(
      "voiceEngine: normalizeVoiceEngineConfig(stored.voiceEngine)",
    );
  });

  it("ships the engine disabled by default — it costs 140MB and 300MB RAM", () => {
    expect(defaultStoredConfig().voiceEngine?.enabled).toBe(false);
  });

  it("defaults the push-to-talk shortcut to the right Option key", () => {
    expect(defaultStoredConfig().voiceEngine?.shortcut).toBe("AltRight");
  });
});

describe("normalizeVoiceEngineConfig", () => {
  it("falls back to the default shortcut for a bogus stored value", () => {
    expect(normalizeVoiceEngineConfig({ shortcut: "banana" }).shortcut).toBe(
      "AltRight",
    );
  });

  it("accepts a whitelisted shortcut", () => {
    expect(normalizeVoiceEngineConfig({ shortcut: "AltSpace" }).shortcut).toBe(
      "AltSpace",
    );
  });

  it("survives a null config", () => {
    expect(normalizeVoiceEngineConfig(null).enabled).toBe(false);
  });
});
