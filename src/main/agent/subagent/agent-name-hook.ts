/**
 * 子代理命名钩子：模型没给名字（或给的不是合法 ASCII slug）时补一个兜底名。
 *
 * 为什么可以就地改参数：pi 的 ToolCallEventResult 注释明确写着
 * "To modify arguments, mutate `event.input` in place instead"
 * （node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:887-896），
 * 而 beforeToolCall 收到的 args 就是随后传给工具执行的那个对象
 * （.../dist/core/agent-session.js:246-260）。
 *
 * 只绑定 root session：子会话不加载 DeskWand 的 inline 扩展，嵌套 spawn 天然不参与。
 *
 * 除补名字外，本钩子还负责把调用方传的裸 Profile 简写（如 "oa/gpt-5"）
 * 归一化为完整身份 `deskwand:oa/gpt-5`，使上游 resolveModel 走 exact 而不是
 * 依赖模糊匹配。门控依据是**本次调用的** ctx.modelRegistry.getAvailable()
 * —— 目标完整身份必须逐字可用，详见 model-spec.ts 的 normalizeCallerModelSpec。
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  isValidAgentName,
  pickFallbackAgentName,
} from "../../../shared/agent-names";
import { normalizeCallerModelSpec } from "./model-spec";

export const AGENT_TOOL_NAME = "Agent";

export function registerAgentNameHook(pi: ExtensionAPI): void {
  pi.on("tool_call", (event, ctx) => {
    if (event.toolName !== AGENT_TOOL_NAME) return;
    const input = event.input as unknown as Record<string, unknown>;
    if (typeof input.model === "string") {
      input.model = normalizeCallerModelSpec(
        input.model,
        ctx.modelRegistry.getAvailable(),
      );
    }
    if (isValidAgentName(input.name)) return;
    input.name = pickFallbackAgentName();
  });
}
