/**
 * @module main/agent/bash-intent-param
 *
 * 给 bash 工具补一个可选的 `description`：模型自己用一句话说明「这条命令要干什么」，
 * 界面拿它当工具行的标题（参考 Claude Code 的 Bash 工具）。
 *
 * 只改 schema，不碰执行 —— pi 的 bash 实现只读 `command` / `timeout`，
 * 多出来的字段不参与任何判断。这段 schema 进系统提示词，所以只在会话初始化时构造一次。
 */
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

const BASH_INTENT_PARAM_MAX_LENGTH = 160;

const BASH_INTENT_PARAM_DESCRIPTION =
  "One short phrase naming what this command is for — the user's language, 5–10 words, " +
  'no trailing period (e.g. "Check wrangler login status"). ' +
  "It is shown to the user as this step's title; the command itself is shown separately.";

export function withBashIntentParam(tools: ToolDefinition[]): ToolDefinition[] {
  return tools.map((tool) => {
    if (tool.name !== "bash") return tool;
    const schema = tool.parameters as unknown as {
      properties?: Record<string, unknown>;
    };
    // 只摊开再加一个属性，**不要**重新 Type.Object 一遍：pi 的 bash schema 由 typebox v1
    // 构造，本仓库装的是 @sinclair/typebox v0.34，重新构会把 v1 的 optional 标记吞掉，
    // timeout 变成必填 —— 而 pi 的校验在 execute 之前，不带 timeout 的调用会被直接拒掉。
    return {
      ...tool,
      parameters: {
        ...(tool.parameters as unknown as object),
        properties: {
          ...(schema.properties ?? {}),
          description: {
            type: "string",
            maxLength: BASH_INTENT_PARAM_MAX_LENGTH,
            description: BASH_INTENT_PARAM_DESCRIPTION,
          },
        },
      },
    } as unknown as ToolDefinition;
  });
}
