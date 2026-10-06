import { describe, expect, it } from "vitest";
import {
  MEMORY_POLICY_PROMPT,
  MEMORY_POLICY_SCHEMA_VERSION,
} from "../../main/memory/memory-policy";
import * as fs from "node:fs";
import * as path from "node:path";

const read = (relative: string) =>
  fs.readFileSync(path.join(process.cwd(), relative), "utf8");

/** 模板字面量里写的是 \\n / \\u003c，换算成运行时真正发出去的字符数。 */
function runtimeLength(block: string): number {
  return block
    .split("\\n")
    .join("\n")
    .split("\\u003c")
    .join("<")
    .split("\\u003e")
    .join(">").length;
}

/** 取出 coworkAppendPrompt 数组里的字面量（顺序即拼接顺序）。 */
function addendumStaticBlocks(): string[] {
  const source = read("src/main/agent/agent-runner.ts");
  const start = source.indexOf("const coworkAppendPrompt = [");
  const end = source.indexOf("].filter(", start);
  if (start < 0 || end < 0) throw new Error("coworkAppendPrompt 未找到");
  return [...source.slice(start, end).matchAll(/`([\s\S]*?)`|"([^"]*)"/g)].map(
    (m) => m[1] ?? m[2] ?? "",
  );
}

/**
 * **成本守卫**：`coworkAppendPrompt` 里的每一句都随每个请求发送一次。
 * 这里不测措辞，只钉四件事：冗余块已删、5 条行为规则还在、
 * `subagent_naming` 与其它块没被误删、整段没长回去。
 */
describe("addendum 固定开销守卫", () => {
  const source = read("src/main/agent/agent-runner.ts");

  it("删掉了冗余的 bundled_executables（PATH 已注入）", () => {
    expect(source).not.toContain("bundled_executables");
    expect(source).not.toContain("getBundledPathHints");
  });

  it("5 条行为规则一条不少", () => {
    for (const marker of [
      "Default to chat", // CHAT FIRST
      "actionable", // 可执行就执行
      "publication days", // 相对时间窗
      "bracketed placeholders", // 方括号占位符
      "Start the task", // 立刻开工
    ]) {
      expect(source, `缺规则标记：${marker}`).toContain(marker);
    }
  });

  it("保留 subagent_naming（子代理继续用历史人物名）与其它块", () => {
    // 用裸名断言：源码里有的块写成 \u003c 转义形式，带尖括号会假阴。
    expect(source).toContain("subagent_naming");
    expect(source).toContain("tool_behavior");
    expect(source).toContain("citation_requirements");
    expect(source).toContain("file_references");
  });
});

describe("memory-policy 的三条约束与长度", () => {
  it("schema 版本保持不变（memory-extension 依赖它）", () => {
    expect(MEMORY_POLICY_SCHEMA_VERSION).toBe("memory-policy-v2");
    expect(MEMORY_POLICY_PROMPT).toContain("memory-policy-v2");
  });

  it("三条策略仍在一句话里说得清", () => {
    expect(MEMORY_POLICY_PROMPT).toContain("memory_search");
    expect(MEMORY_POLICY_PROMPT).toContain("current workspace first");
    expect(MEMORY_POLICY_PROMPT).toContain("explicitly asks");
    expect(MEMORY_POLICY_PROMPT).toContain("untrusted historical context");
  });

  it("addendum 的静态块总长有上限（拦住「再塞一段」）", () => {
    const blocks = addendumStaticBlocks();
    expect(blocks.length).toBeGreaterThanOrEqual(4);
    // 规则 + citation + tool_behavior + file_references + subagent + memory + workspace_info(变量拼的，按量级给 110)
    const total =
      blocks.reduce((sum, block) => sum + runtimeLength(block), 0) +
      MEMORY_POLICY_PROMPT.length +
      110;
    // 实测 2,968（包含为内联产物新增的 artifacts 协议块 256 字符）。上限 3,050：
    // 它要拦的是「再塞一整块」（当年那段 bundled_executables 就有 569 字符），
    // 新增一个模型必须知道的产品协议不算在内。
    expect(total).toBeLessThanOrEqual(3050);
  });

  it("单块长度上限（每请求固定成本）", () => {
    // 压缩前 1,049；三条策略一句不少地保留后落在 813。上限给一点余量，
    // 目的是拦住"再往里塞一段"的改动，不是逼着继续删规则。
    expect(MEMORY_POLICY_PROMPT.length).toBeLessThanOrEqual(850);
  });
});
