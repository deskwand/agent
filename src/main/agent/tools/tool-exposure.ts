import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

/**
 * 降到 codemode 层的工具：不在提示里声明（省掉每请求的 schema 成本），
 * 模型用 codemode 的 `tools.<name>({...})` 调用，用 `searchTools` / `describeTool` 查名字与参数。
 *
 * 为什么单独放一个模块（而不是每个定义里内联 exposure）：降级的**范围**（哪几组工具）
 * 和它的**天敌**（任何把工具名全量 `setActiveToolsByName` 的代码会抵消降级 ——
 * 例如 @tintinweb/pi-subagents 的 `renarrow()`，它只处理自己范围内的工具）
 * 这两条知识需要一个共同的落脚点。
 *
 * 动机与范围见 design-docs/2026-10-06-tool-exposure-slim-design.md（A1）。
 */
export const CODEMODE_EXPOSURE = { exposure: "codemode" } as const;

/** 把一组工具整体降到 codemode 层。 */
export function codemodeOnly(tools: ToolDefinition[]): ToolDefinition[] {
  return tools.map((tool) => ({ ...tool, ...CODEMODE_EXPOSURE }));
}
