import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import { defaultStoredConfig } from "../../main/config/config-store";

const ROOT = process.cwd();
const read = (relative: string) =>
  fs.readFileSync(path.join(ROOT, relative), "utf8");

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
  it("defaults to disabled (so merging changes no behavior)", () => {
    expect(defaultStoredConfig().codemode).toMatchObject({ enabled: false });
  });

  it("persists codemode in configStore.update()", () => {
    const source = read("src/main/config/config-store.ts");
    expect(source).toContain(
      "stored.codemode = normalizeCodemodeConfig(updates.codemode)",
    );
  });

  it("spreads the defaultTools patch into the MAIN session, not the tool-less one", () => {
    const lines = read("src/main/agent/agent-runner.ts").split("\n");

    const patchLine = lines.findIndex((line) =>
      line.includes("...codemodeDefaultToolsPatch()"),
    );
    // 只应出现一次
    expect(
      lines.filter((line) => line.includes("...codemodeDefaultToolsPatch()")),
    ).toHaveLength(1);

    // 语义锚点：`customTools: allCustomTools` 主会话独有（冷启压缩会话没有自定义工具）。
    const mainSessionAnchor = lines.findIndex((line) =>
      line.includes("customTools: allCustomTools"),
    );
    expect(mainSessionAnchor).toBeGreaterThan(0);

    // 补丁必须与主会话锚点**同属一个 settings 块**（相邻若干行内）。
    // 若有人把补丁挪到冷启压缩会话（那里 `noTools: "all"` ⇒ defaultTools 失效），
    // 它会离这个锚点很远 —— 这个断言就会失败。
    expect(patchLine).toBeGreaterThan(mainSessionAnchor);
    expect(patchLine - mainSessionAnchor).toBeLessThan(20);
  });
});
