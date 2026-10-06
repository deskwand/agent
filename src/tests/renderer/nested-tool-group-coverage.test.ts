import { describe, expect, it } from "vitest";
import { projectNestedToolBlocks } from "../../renderer/utils/nested-tool-display";
import { buildToolDisplayBlocks } from "../../renderer/utils/tool-display-blocks";
import type { ContentBlock } from "../../renderer/types";

/**
 * A1 之后，浏览器 / office / 视觉类工具只会以**嵌套调用**的形式出现（从 codemode 里调）。
 * AGENTS.md 要求任何工具都不得作为未分组工具展示 —— 这条断言把「嵌套投影块的摘要分组」
 * 钉住，而不是靠人工看一次。
 */
describe("嵌套调用的分组覆盖", () => {
  // A1 降级的每一组都抽一个代表：任何一组掉出分组表，这里就红。
  it.each([
    "office_read_xlsx",
    "internal_browser_screenshot",
    "vision_describe",
    "ocr",
    "tts",
  ])("嵌套调用的虚拟块仍走摘要分组：%s", (toolName) => {
    const parentId = "call-1";
    const blocks = [
      { type: "tool_use", id: parentId, name: "codemode", input: {} },
      {
        type: "tool_result",
        toolUseId: parentId,
        content: "ok",
        nestedCalls: {
          parentToolCallId: parentId,
          parentStatus: "ok",
          complete: true,
          source: "final",
          calls: [{ id: "nested-1", name: toolName, input: {}, status: "ok" }],
        },
      },
    ] as unknown as ContentBlock[];

    const projected = projectNestedToolBlocks(blocks, {}, false);
    const nested = projected.find(
      (block) => block.type === "tool_use" && block.name === toolName,
    );
    expect(nested).toBeDefined();
    const display = buildToolDisplayBlocks([nested as ContentBlock]);
    expect(["process-summary", "result-summary"]).toContain(display[0]?.type);
  });
});
