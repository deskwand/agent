/**
 * 单次运行内的嵌套工具调用追踪器。
 *
 * 只记录真实嵌套执行事件（真实调用 ID）与外层结果消息的权威终态记录：
 *  - 实时事件建立子调用、父子关联与可用输出（详情用途）；
 *  - 外层 toolResult 的最终 `nestedCalls` 是成员、参数和状态的唯一权威来源；
 *  - `details.calls` 临时快照（临时 ID、可重复）不参与创建、合并或统计。
 *
 * 见 design-docs/2026-10-02-codemode-tool-group-spec.md §4、§7。
 */

import {
  normalizeNestedToolCalls,
  type NestedToolCallsUi,
  type NestedToolOutput,
  type NestedToolRuntimeUi,
  type NestedToolStatus,
} from "../../shared/nested-tool-calls";

export interface NestedToolCallStart {
  id: string;
  name: string;
  input?: Record<string, unknown>;
}

export interface NestedToolCallTracker {
  /** 外层 codemode 调用开始：建立运行快照，重复调用不重置。 */
  startParent(parentId: string): void;
  /** 子调用开始：以真实调用 ID 登记，重复开始视为幂等。 */
  start(parentId: string, call: NestedToolCallStart): void;
  /** 子调用结束：更新状态并把完整输出留在 outputs 供详情使用。 */
  finish(parentId: string, callId: string, output: NestedToolOutput): void;
  /**
   * 外层结果终态：raw 为 SDK `nestedCalls`（唯一权威来源），legacy 为旧
   * `details.calls` 快照。raw 缺失时必须保留已观察明细，不得清空。
   */
  finishParent(
    parentId: string,
    raw: unknown,
    legacy: unknown,
    isError: boolean,
  ): void;
  /** 运行结束/中断：只把仍在运行的实时记录收尾，返回全部快照。 */
  interrupt(): NestedToolRuntimeUi[];
  get(parentId: string): NestedToolRuntimeUi | undefined;
}

function liveSnapshot(parentId: string): NestedToolRuntimeUi {
  return {
    snapshot: {
      parentToolCallId: parentId,
      parentStatus: "running",
      calls: [],
      complete: true,
      source: "live",
    },
    outputs: {},
  };
}

export function createNestedToolCallTracker(): NestedToolCallTracker {
  const runtimes = new Map<string, NestedToolRuntimeUi>();
  // 子调用 ID 视为不透明标识：只按登记结果解析根，不拆分 ID 推断父子关系。
  const roots = new Map<string, string>();
  const getRoot = (id: string): string => roots.get(id) ?? id;

  const update = (
    root: string,
    current: NestedToolRuntimeUi,
    patch: Partial<NestedToolCallsUi>,
  ): void => {
    runtimes.set(root, {
      snapshot: { ...current.snapshot, ...patch },
      outputs: current.outputs,
    });
  };

  const toUnfinished = (
    calls: NestedToolCallsUi["calls"],
  ): NestedToolCallsUi["calls"] =>
    calls.map((call) =>
      call.status === "running"
        ? { ...call, status: "unfinished" as NestedToolStatus }
        : call,
    );

  return {
    startParent(parentId: string): void {
      if (runtimes.has(parentId)) return;
      runtimes.set(parentId, liveSnapshot(parentId));
    },

    start(parentId: string, call: NestedToolCallStart): void {
      const root = getRoot(parentId);
      const current = runtimes.get(root);
      if (!current || current.snapshot.source !== "live") return;
      roots.set(call.id, root);
      if (current.snapshot.calls.some((item) => item.id === call.id)) return;
      update(root, current, {
        calls: [...current.snapshot.calls, { ...call, status: "running" }],
      });
    },

    finish(parentId: string, callId: string, output: NestedToolOutput): void {
      const root = getRoot(parentId);
      const current = runtimes.get(root);
      if (!current) return;
      // 终态记录到达后不再改写成员/参数/状态；实时输出仍作为详情保留。
      const calls =
        current.snapshot.source === "live"
          ? current.snapshot.calls.map((call) =>
              call.id === callId
                ? {
                    ...call,
                    status: (output.isError
                      ? "error"
                      : "ok") as NestedToolStatus,
                    ...(output.isError
                      ? { error: output.content.slice(0, 500) }
                      : {}),
                  }
                : call,
            )
          : current.snapshot.calls;
      runtimes.set(root, {
        snapshot: { ...current.snapshot, calls },
        outputs: { ...current.outputs, [callId]: output },
      });
    },

    finishParent(
      parentId: string,
      raw: unknown,
      legacy: unknown,
      isError: boolean,
    ): void {
      const root = getRoot(parentId);
      const current = runtimes.get(root);
      if (!current || current.snapshot.source === "final") return;
      const parentStatus: NestedToolStatus = isError ? "error" : "ok";
      if (raw == null && current.snapshot.calls.length > 0) {
        // 终态记录不可用：保留已观察明细，pending 转 unfinished；
        // 参数只供详情保留，缺失来源不参与已完成文件统计。
        update(root, current, {
          parentStatus,
          source: "missing",
          complete: false,
          calls: toUnfinished(current.snapshot.calls),
        });
        return;
      }
      // 未观察到调用不能替代持久化事实；与历史使用相同的缺失记录降级。
      runtimes.set(root, {
        snapshot: normalizeNestedToolCalls(root, raw, legacy, parentStatus),
        outputs: current.outputs,
      });
    },

    interrupt(): NestedToolRuntimeUi[] {
      for (const [id, current] of runtimes) {
        if (
          current.snapshot.source !== "live" ||
          current.snapshot.parentStatus !== "running"
        ) {
          continue;
        }
        update(id, current, {
          parentStatus: "unfinished",
          complete: false,
          calls: toUnfinished(current.snapshot.calls),
        });
      }
      return [...runtimes.values()];
    },

    get(parentId: string): NestedToolRuntimeUi | undefined {
      return runtimes.get(getRoot(parentId));
    },
  };
}
