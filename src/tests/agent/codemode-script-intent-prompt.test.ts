import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SRC = path.join(__dirname, "../../main/agent/agent-runner.ts");
const src = fs.readFileSync(SRC, "utf-8");

describe("codemode 脚本意图约定", () => {
  it("常量存在且说的是「脚本首行写意图」", () => {
    expect(src).toContain("const codemodeIntentPrefix");
    expect(src).toContain("codemode script");
  });

  it("常量被插进 tool_behavior 的 codemode 那一句（不是定义了没人用）", () => {
    const usage = src.indexOf("${codemodeIntentPrefix}");
    // 源码里这组标签写成 \u003c…\u003e 转义形式，按字面量搜不到
    const toolBehavior = src.indexOf("\\u003ctool_behavior\\u003e");
    const toolBehaviorEnd = src.indexOf("\\u003c/tool_behavior\\u003e");
    expect(usage).toBeGreaterThan(toolBehavior);
    expect(usage).toBeLessThan(toolBehaviorEnd);
  });
});
