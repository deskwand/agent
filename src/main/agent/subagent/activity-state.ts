/**
 * 子代理活动状态的纯函数核心：会话事件 → 步骤状态 → IPC 快照。
 *
 * 刻意不持有定时器、不发 IPC、不碰 SDK —— 这三件事都在 session-tap.ts，
 * 这里只保证「同样的输入给同样的输出」，好在单测里穷举边界。
 */
import type {
  SubagentActivity,
  SubagentStep,
} from "../../../shared/subagent-activity";

export const MAX_STEPS = 20;
const MAX_ARG_LENGTH = 200;
const MAX_PATTERN_LENGTH = 120;

const PATH_TOOLS = new Set([
  "read",
  "read_file",
  "write",
  "write_file",
  "edit",
  "edit_file",
  "ls",
]);
const COMMAND_TOOLS = new Set(["bash", "execute_command"]);

export interface StepState extends SubagentStep {
  startedAt: number;
}

export interface ActivityState {
  steps: StepState[];
  current?: StepState;
  turnCount: number;
}

/** 子会话事件里我们用得到的部分（其余事件一律忽略）。 */
export interface SessionEventLike {
  type: string;
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  isError?: boolean;
}

/** record 里我们用得到的部分，避免把插件类型泄漏进逻辑。 */
export interface AgentRecordView {
  status?: string;
  /** 插件在 spawn 时写入的 spawn 语义：true = 后台并发型。 */
  isBackground?: boolean;
  toolUses?: number;
  startedAt?: number;
  completedAt?: number;
  alias?: string;
  handle?: string;
  lifetimeUsage?: {
    input?: number;
    output?: number;
    cacheWrite?: number;
    /** 声明但不参与 tokens 计算：上游的显示口径刻意排除它。 */
    cacheRead?: number;
    cost?: number;
  };
  invocation?: {
    modelName?: string;
    modelId?: string;
    thinking?: string;
    maxTurns?: number;
  };
}

export function createActivityState(): ActivityState {
  return { steps: [], turnCount: 0 };
}

function truncate(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (!text) return undefined;
  if (text.length <= max) return text;
  // 截断后丢掉落单的高位代理码元，免得 UI 出现半个 emoji
  return `${text.slice(0, max).replace(/[\uD800-\uDBFF]$/, "")}…`;
}

/**
 * 只下发展示必需的字段。白名单之外的工具（含 mcp__*）一律只给空对象，
 * 只显示工具名 —— 宁可少显示，也不把任意参数搬进 UI。write/edit 的正文永不外发。
 */
export function pickStepArgs(
  toolName: string,
  args: unknown,
): Record<string, string> {
  if (!args || typeof args !== "object") return {};
  const input = args as Record<string, unknown>;
  const name = toolName.toLowerCase();
  const path = truncate(input.file_path ?? input.path, MAX_ARG_LENGTH);
  const out: Record<string, string> = {};

  if (PATH_TOOLS.has(name)) {
    if (path) out.path = path;
    return out;
  }
  if (COMMAND_TOOLS.has(name)) {
    const command = truncate(input.command ?? input.cmd, MAX_ARG_LENGTH);
    if (command) out.command = command;
    return out;
  }
  if (name === "grep") {
    const pattern = truncate(input.pattern, MAX_PATTERN_LENGTH);
    if (pattern) out.pattern = pattern;
    if (path) out.path = path;
    return out;
  }
  if (name === "find" || name === "glob") {
    const pattern = truncate(input.pattern, MAX_PATTERN_LENGTH);
    if (pattern) out.pattern = pattern;
    return out;
  }
  if (name === "agent") {
    const subagentType = truncate(input.subagent_type, MAX_PATTERN_LENGTH);
    const description = truncate(input.description, MAX_ARG_LENGTH);
    if (subagentType) out.subagent_type = subagentType;
    if (description) out.description = description;
    return out;
  }
  return out;
}

/** 就地更新 state；返回是否有对 UI 可见的变化（false 时调用方不必重发快照）。 */
export function applySessionEvent(
  state: ActivityState,
  event: SessionEventLike,
  now: number,
): boolean {
  if (
    event.type === "tool_execution_start" &&
    event.toolCallId &&
    event.toolName
  ) {
    const step: StepState = {
      id: event.toolCallId,
      toolName: event.toolName,
      args: pickStepArgs(event.toolName, event.args),
      done: false,
      startedAt: now,
    };
    state.steps.push(step);
    if (state.steps.length > MAX_STEPS) {
      state.steps.splice(0, state.steps.length - MAX_STEPS);
    }
    state.current = step;
    return true;
  }
  if (event.type === "tool_execution_end" && event.toolCallId) {
    let changed = false;
    const step = state.steps.find((s) => s.id === event.toolCallId);
    if (step) {
      step.done = true;
      step.isError = event.isError === true;
      step.durationMs = Math.max(0, now - step.startedAt);
      changed = true;
    }
    if (state.current?.id === event.toolCallId) {
      state.current = undefined;
      changed = true;
    }
    return changed;
  }
  if (event.type === "turn_end") {
    state.turnCount += 1;
    return true;
  }
  return false;
}

const TERMINAL_STATUSES = new Set([
  "completed",
  "error",
  "stopped",
  "aborted",
  "steered",
]);

export function isTerminalRecordStatus(status: string | undefined): boolean {
  return status !== undefined && TERMINAL_STATUSES.has(status);
}

/** stopped / aborted 在 UI 上按「失败」呈现：结果确实是残缺的。 */
function toSnapshotStatus(
  status: string | undefined,
): "running" | "completed" | "error" {
  if (status === "error" || status === "stopped" || status === "aborted") {
    return "error";
  }
  if (isTerminalRecordStatus(status)) return "completed";
  return "running";
}

export function buildSnapshot(params: {
  sessionId: string;
  agentId: string;
  toolCallId: string;
  state: ActivityState;
  record: AgentRecordView;
  now: number;
  /** tap 收尾时显式传入，代替改写上游 record —— 插件自己也读 record.status。 */
  status?: "running" | "completed" | "error";
}): SubagentActivity {
  const { state, record, now } = params;
  const usage = record.lifetimeUsage;
  const tokens = usage
    ? (usage.input ?? 0) + (usage.output ?? 0) + (usage.cacheWrite ?? 0)
    : 0;
  const invocation = record.invocation;
  const hasModel = Boolean(invocation?.modelName || invocation?.modelId);

  return {
    sessionId: params.sessionId,
    agentId: params.agentId,
    parentToolCallId: params.toolCallId,
    name: record.alias ?? record.handle,
    // 只有插件明确标了 isBackground 才算后台；undefined（如 cross-extension spawn）不当后台。
    background: record.isBackground === true ? true : undefined,
    status: params.status ?? toSnapshotStatus(record.status),
    current: state.current ? { ...state.current } : undefined,
    steps: state.steps.map((step) => ({ ...step })),
    stats: {
      toolUses: record.toolUses ?? state.steps.length,
      turnCount: state.turnCount > 0 ? state.turnCount : undefined,
      maxTurns: invocation?.maxTurns,
      tokens: tokens > 0 ? tokens : undefined,
      durationMs: Math.max(
        0,
        (record.completedAt ?? now) - (record.startedAt ?? now),
      ),
    },
    model: hasModel
      ? {
          name: invocation?.modelName,
          id: invocation?.modelId,
          thinking: invocation?.thinking,
        }
      : undefined,
  };
}
