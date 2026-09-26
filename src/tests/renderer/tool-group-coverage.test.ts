import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createCodingTools,
  createReadOnlyTools,
} from "@earendil-works/pi-coding-agent";
import {
  buildToolDisplayBlocks,
  DEDICATED_CARD_TOOLS,
} from "../../renderer/utils/tool-display-blocks";
import type { ContentBlock } from "../../renderer/types";

/**
 * 主会话中注册的自定义工具：agent-runner.ts 的 allCustomTools（web ×3、browser ×11、
 * office ×4、vision_describe（条件注册））+ pi-subagents（Agent / get_subagent_result /
 * steer_subagent）+ memory 四件套 + goal 三件套。
 * 新增工具时必须同步加入此清单，并保证被摘要分组识别、或（对清单/提问这类必须
 * 独立可见的工具）在 DEDICATED_CARD_TOOLS 里声明且有真实渲染分支 —— 对应 AGENTS.md
 * 「不得默认作为未分组工具展示」规则。
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

const toolUseBlockSource = readFileSync(
  path.resolve(
    process.cwd(),
    "src/renderer/components/message/ToolUseBlock.tsx",
  ),
  "utf8",
);

/**
 * 要么被摘要分组识别，要么是声明过的专用卡片 —— 且 ToolUseBlock 必须真的有渲染分支。
 * 后半句是关键：防有人把工具记进白名单却忘了写分支，卡片静默退化成通用卡。
 */
function isGroupedOrDedicated(name: string): boolean {
  if (isGrouped(name)) return true;
  return (
    DEDICATED_CARD_TOOLS.has(name) &&
    toolUseBlockSource.includes(`block.name === "${name}"`)
  );
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
      expect(
        isGroupedOrDedicated(name),
        `custom tool "${name}" must be grouped or declared as a dedicated card`,
      ).toBe(true);
    }
  });

  // 这条是绊线而非正向分类：任何一个不在 PROCESS_TOOLS/RESULT_TOOLS 里的名字都会
  // 通过 `isGrouped === false`，所以它现在的意义是"将来有人把 todo_write 塞进
  // PROCESS_TOOLS 时立刻失败"——被吸收会让专用卡片再也渲染不出来。
  it("keeps dedicated-card tools out of the summaries", () => {
    for (const name of DEDICATED_CARD_TOOLS) {
      expect(
        isGrouped(name),
        `"${name}" 是专用卡片，必须留在摘要组之外（被吸收会折叠掉卡片）`,
      ).toBe(false);
      expect(
        toolUseBlockSource.includes(`block.name === "${name}"`),
        `"${name}" 在 ToolUseBlock 里没有渲染分支`,
      ).toBe(true);
    }
  });
});
