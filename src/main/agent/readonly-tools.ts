/**
 * @module main/agent/readonly-tools
 *
 * 语音模式允许的工具。只放"看一眼 / 搜一下"这类只读工具：语音里没法做审批，
 * 也没法看 diff（设计 §2.5）。
 *
 * 工具名已照实际注册处核对（2026-10-04）：
 *  - 内置：`createCodingTools` 只给 read / bash / edit / write（agent-runner.ts:3068）
 *  - 搜索：`web_search` / `fetch_content` / `get_search_content`（tools/web-access）
 *  - 文档与图片：`office_read_*` / `vision_describe`
 *  - 刻意排除：tts（会让模型自己朗读，与流式朗读撞双声）、ask_user（弹框）、
 *    todo_write（写操作）、bash / edit / write
 *
 * **也刻意不含 `read`**：pi 只当 `read` 或 `bash` 被激活时才把技能段落写进
 * 系统提示词（`system-prompt.js`: `const skillFileReadTool = ["read","bash"]
 * .find((tool) => selectedTools.includes(tool))`）。留着 `read` 就等于把技能
 * 一起带回来 —— 而那正是用户要求拿掉的东西。代价是语音模式读不了本地代码
 * 文件；查资料靠 `web_search` / `fetch_content`，读文档靠 `office_read_*`。
 */
export const READONLY_TOOLS: readonly string[] = [
  "web_search",
  "fetch_content",
  "get_search_content",
  "vision_describe",
  "office_read_docx",
  "office_read_pdf",
  "office_read_pptx",
  "office_read_xlsx",
];

/**
 * 从全量名单里选出本轮要激活的。保留全量名单的顺序，名单里没注册的名字自然被丢掉。
 * 不 readonly 时**原样返回入参**（同一个引用），避免每轮多一次拷贝。
 */
export function resolveActiveTools(
  allNames: string[],
  readonly: boolean,
): string[] {
  if (!readonly) return allNames;
  return allNames.filter((name) => READONLY_TOOLS.includes(name));
}
