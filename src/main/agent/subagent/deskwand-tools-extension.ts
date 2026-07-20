/**
 * DeskWand Tools Extension — 将 DeskWand 工具集包装为内联 Pi Extension，
 * 使子 Agent 可以通过插件原有的 Extension 加载机制使用 DeskWand 工具。
 *
 * V1: 仅注入 Pi 内置只读工具（read、grep、find、ls）。
 * V2: 注入 MCP、Web、Browser、Vision、Office 等完整工具集。
 */

import type {
  ExtensionAPI,
  InlineExtension,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { log } from "../../utils/logger";

export function createDeskwandToolsExtension(
  cwd: string,
  sessionId: string,
  customTools?: ToolDefinition[],
  codingTools?: ToolDefinition[],
): InlineExtension | undefined {
  if (!cwd || !sessionId) return undefined;

  return {
    name: "deskwand-tools",
    factory: (pi: ExtensionAPI) => {
      const allTools = [...(codingTools ?? []), ...(customTools ?? [])];
      for (const tool of allTools) {
        pi.registerTool(tool);
      }
      log(
        `[DeskWandTools] Registered ${allTools.length} subagent tools for session ${sessionId}`,
      );
    },
  };
}
