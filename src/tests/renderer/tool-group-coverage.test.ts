import { describe, expect, it } from "vitest";
import {
  createCodingTools,
  createReadOnlyTools,
} from "@earendil-works/pi-coding-agent";
import { buildToolDisplayBlocks } from "../../renderer/utils/tool-display-blocks";
import type { ContentBlock } from "../../renderer/types";

/**
 * 主会话中注册的自定义工具：agent-runner.ts 的 allCustomTools（web ×3、browser ×11、
 * office ×4、vision_describe（条件注册））+ pi-subagents（Agent / get_subagent_result /
 * steer_subagent）+ memory 四件套 + goal 三件套。
 * 新增工具时必须同步加入此清单，并保证被摘要分组识别（`isGrouped`）——
 * 对应 AGENTS.md「不得默认作为未分组工具展示」规则。
 */
const MAIN_SESSION_TOOLS = [
  "Agent",
  "get_subagent_result",
  "steer_subagent",
  "SubagentWorkflow",
  "vision_describe",
  "office_read_xlsx",
  "office_read_docx",
  "office_read_pptx",
  "office_read_pdf",
  "web_search",
  "fetch_content",
  "get_search_content",
  "memory_search",
  "memory_read",
  "memory_upsert",
  "memory_delete",
  "get_goal",
  "update_goal",
  "goal_complete",
  "todo_write",
  "internal_browser_navigate",
  "internal_browser_screenshot",
  "internal_browser_click",
  "internal_browser_fill",
  "internal_browser_scroll",
  "internal_browser_hover",
  "internal_browser_select",
  "internal_browser_press",
  "internal_browser_snapshot",
  "internal_browser_evaluate",
  "internal_browser_wait_for",
  "internal_browser_get_state",
];

function isGrouped(name: string): boolean {
  const blocks = buildToolDisplayBlocks([
    { type: "tool_use", id: "t-1", name, input: {} } as ContentBlock,
    { type: "tool_result", toolUseId: "t-1", content: "ok" } as ContentBlock,
  ]);
  // 未分组的工具会被包成 `{ type: "content", block }`（tool-display-blocks.ts:407,416），
  // 不是 `tool_use` —— 这里只关心"首块是不是摘要"。
  const first = blocks[0];
  return first?.type === "process-summary" || first?.type === "result-summary";
}

/**
 * 每个主会话自定义工具都必须被摘要分组识别。
 *
 * 历史：这里以前还有一条"专用卡片"分支（`DEDICATED_CARD_TOOLS` 白名单 + 断言
 * ToolUseBlock 有渲染分支）。清单折入过程摘要之后白名单为空、那条勒线会**空过**
 * （测试还在、实际一条不跑），所以两者一并删了；将来真有工具需要独立卡片时再加回来。
 */

describe("tool group coverage", () => {
  it("classifies every SDK built-in coding tool", () => {
    const names = [
      ...createCodingTools(process.cwd()).map((tool) => tool.name),
      ...createReadOnlyTools(process.cwd()).map((tool) => tool.name),
    ];
    for (const name of new Set(names)) {
      expect(isGrouped(name), `SDK tool "${name}" must be grouped`).toBe(true);
    }
  });

  it("classifies every main-session custom tool", () => {
    for (const name of MAIN_SESSION_TOOLS) {
      expect(isGrouped(name), `custom tool "${name}" must be grouped`).toBe(
        true,
      );
    }
  });

  // 本次决定：清单不再独占卡片，折入过程摘要。两个名字都要管 ——
  // 历史会话里是驼峰 TodoWrite，MAIN_SESSION_TOOLS 那个循环覆盖不到它。
  it("folds todo_write into the process summary instead of a dedicated card", () => {
    expect(isGrouped("todo_write")).toBe(true);
    expect(isGrouped("TodoWrite")).toBe(true);
  });
});
