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
 * 新增工具时必须同步加入此清单，并保证被摘要分组识别 —— 对应 AGENTS.md
 * 「不得默认作为未分组工具展示」规则。
 */
const MAIN_SESSION_TOOLS = [
  "Agent",
  "get_subagent_result",
  "steer_subagent",
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
  const first = blocks[0];
  return first?.type === "process-summary" || first?.type === "result-summary";
}

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
});
