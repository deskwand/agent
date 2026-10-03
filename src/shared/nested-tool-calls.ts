/**
 * 嵌套工具调用（codemode 子调用）的标准化展示契约。
 *
 * 两个来源共用这一套字段：
 *  - SDK 外层 toolResult 的最终 `nestedCalls` 记录（source: "final"）；
 *  - 旧会话仅有 `details.calls` 预览快照（source: "legacy"）。
 *
 * 约束（见 design-docs/2026-10-02-codemode-tool-group-spec.md §4）：
 *  - 调用 ID 视为不透明标识，不做 ID 字符串推断；
 *  - 旧快照的参数预览字符串不解析为结构化参数，也不据此统计路径；
 *  - 历史缺失（source: "missing"）必须区别于确认的空记录（final + calls: []）。
 */

export type NestedToolStatus = "running" | "ok" | "error" | "unfinished";

export interface NestedToolOutput {
  content: string;
  isError: boolean;
  diff?: string;
  images?: Array<{ data: string; mimeType: string }>;
}

export interface NestedToolCallUi {
  id: string;
  name: string;
  input?: Record<string, unknown>;
  status: NestedToolStatus;
  argumentsBytes?: number;
  durationMs?: number;
  error?: string;
  cancelled?: boolean;
}

export interface NestedToolCallsUi {
  parentToolCallId: string;
  parentStatus: NestedToolStatus;
  calls: NestedToolCallUi[];
  /**
   * 完整性标记直接取 SDK 最终记录自带的 `complete`；调用行被丢弃（数量
   * 截断或去重）时在本层降级为 false。不从参数省略、状态等本地推断。
   */
  complete: boolean;
  source: "live" | "final" | "legacy" | "missing";
}

export interface NestedToolRuntimeUi {
  snapshot: NestedToolCallsUi;
  outputs: Record<string, NestedToolOutput>;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function normalizeNestedToolCalls(
  parentToolCallId: string,
  raw: unknown,
  legacyCalls: unknown,
  parentStatus: NestedToolStatus,
): NestedToolCallsUi {
  const record = object(raw);
  const rawCalls = record?.calls;
  const final = Array.isArray(rawCalls);
  const rows: unknown[] = Array.isArray(rawCalls)
    ? rawCalls
    : Array.isArray(legacyCalls)
      ? legacyCalls
      : [];
  const calls: NestedToolCallUi[] = [];
  const seen = new Set<string>();
  for (const [index, value] of rows.entries()) {
    const call = object(value);
    if (!call || typeof call.name !== "string") continue;
    // 旧快照可能重复使用临时 ID；索引只用于该记录的展示 key，
    // 真实（final）调用 ID 保持不透明并按真实 ID 去重。
    const id =
      final && typeof call.id === "string"
        ? call.id
        : `${parentToolCallId}:legacy:${index}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const status =
      call.status === "ok" || call.status === "error"
        ? call.status
        : "unfinished";
    const input = final ? object(call.arguments) : undefined;
    calls.push({
      id,
      name: call.name,
      status,
      ...(input ? { input } : {}),
      ...(typeof call.argumentsBytes === "number"
        ? { argumentsBytes: call.argumentsBytes }
        : {}),
      ...(typeof call.durationMs === "number"
        ? { durationMs: call.durationMs }
        : {}),
      ...(typeof call.error === "string" ? { error: call.error } : {}),
      ...(call.status === "cancelled" ? { cancelled: true } : {}),
    });
  }
  return {
    parentToolCallId,
    parentStatus,
    calls,
    complete:
      final && record?.complete === true && calls.length === rows.length,
    source: final ? "final" : calls.length > 0 ? "legacy" : "missing",
  };
}
