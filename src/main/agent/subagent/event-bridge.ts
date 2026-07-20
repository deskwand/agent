/**
 * 子 Agent 事件桥接 — 将插件结构化事件转换为 DeskWand ServerEvent 协议。
 *
 * 注意：subagent.lifecycle 事件类型尚未加入 renderer types 的 ServerEvent 联合类型，
 * V1 通过类型断言桥接。后续迭代中应正式扩展 ServerEvent 联合类型。
 */

/** 工具执行上下文，区分主 Agent 与子 Agent。 */
export interface ToolExecutionContext {
  scope: "main" | "subagent";
  executionId: string;
  agentId?: string;
  agentType?: string;
  parentToolCallId?: string;
}

export interface BuildExecutionContextInput {
  executionId?: string;
  agentId?: string;
  agentType?: string;
  parentToolCallId?: string;
}

/** 构建工具执行上下文 */
export function buildExecutionContext(
  input: BuildExecutionContextInput,
): ToolExecutionContext {
  if (!input.agentId) {
    return {
      scope: "main",
      executionId: input.executionId ?? "main",
      parentToolCallId: input.parentToolCallId,
    };
  }
  return {
    scope: "subagent",
    executionId: input.executionId ?? input.agentId,
    agentId: input.agentId,
    agentType: input.agentType,
    parentToolCallId: input.parentToolCallId,
  };
}

/** 子 Agent 生命周期事件载荷 */
export interface SubagentLifecyclePayload {
  agentId: string;
  agentType: string;
  parentToolCallId: string;
  status:
    | "created"
    | "running"
    | "completed"
    | "steered"
    | "stopped"
    | "aborted"
    | "error";
  toolUses?: number;
  turnCount?: number;
  maxTurns?: number;
  tokens?: { input: number; output: number; total: number };
  durationMs?: number;
  modelName?: string;
  error?: string;
}

/**
 * 将插件子 Agent 生命周期事件转换为 DeskWand 兼容格式。
 * 事件类型为 "subagent.lifecycle"，payload 包含 sessionId
 * 及所有生命周期字段。
 */
export function bridgeSubagentLifecycleEvent(
  payload: SubagentLifecyclePayload,
  sessionId: string,
): { type: string; payload: Record<string, unknown> } {
  return {
    type: "subagent.lifecycle",
    payload: {
      sessionId,
      ...payload,
    },
  };
}
