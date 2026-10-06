import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import { defaultStoredConfig } from "../../main/config/config-store";

const read = (relative: string) =>
  fs.readFileSync(path.join(process.cwd(), relative), "utf8");

/**
 * **接线守卫**（不是行为断言）。
 *
 * 行为由 `src/tests/agent/codemode-extension.test.ts`（注册/激活）与
 * `src/tests/config/codemode-config.test.ts`（归一化）覆盖。
 *
 * 但那一份测试**自己搭会话**，所以它看不到产品路径上的接线错误 —— 代码评审抓到过两个
 * 真实的 Critical，两个测试在当时全是绿的：
 *
 *  1. `codemodeDefaultToolsPatch()` 被展开进了**冷启压缩会话**的 `PiSettingsManager.inMemory(...)`
 *     （那里有 `noTools: "all"` ⇒ initialActive 为空 ⇒ 补丁失效），而主会话没有 ⇒ 功能空转。
 *  2. `configStore.update()` 缺 `codemode` 的持久化分支 ⇒ 设置界面一改就被无声回滚。
 *
 * 本文件就是为这两个失败模式立的哨兵。
 */
describe("codemode wiring guards", () => {
  it("persists codemode in configStore.update()", () => {
    // 这条守的是一个真实回归：删掉 `codemode.enabled` 时把**整个** codemode 分支
    // 一起删了，于是 mode/inlineBudget 存不进去、设置界面一改就被无声回滚。
    // （严格说该断言行为而非源码文本 —— 行为版需要实例化 configStore，
    //   见 src/tests/config/config-store-defaults.test.ts 的现状。）
    expect(read("src/main/config/config-store.ts")).toContain(
      "stored.codemode = normalizeCodemodeConfig(updates.codemode)",
    );
  });

  it("stored defaults carry only the mode knob, no global enable switch", () => {
    // 守的是「别再加回一个会被派生激活静默盖过的全局开关」，以及
    // 「inlineBudget 不再回落到配置」。
    expect(defaultStoredConfig().codemode).toEqual({ mode: "on" });
    expect(defaultStoredConfig().codemode).not.toHaveProperty("enabled");
    expect(defaultStoredConfig().codemode).not.toHaveProperty("inlineBudget");
  });

  it("no longer renders the inline budget row in the settings page", () => {
    // 旋钮下线的接线守卫：删了字段却忘了删 UI，用户就会看着一个改了没反应的输入框。
    expect(
      read("src/renderer/components/settings/SettingsGeneral.tsx"),
    ).not.toContain("codemodeInlineBudget");
  });
});
