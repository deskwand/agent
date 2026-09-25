/**
 * 子代理实时活动 tap —— 把「父会话里的一次 Agent 工具调用」绑定到插件的子代理 record，
 * 订阅子会话事件并节流成 subagent.activity 快照。
 *
 * 绑定的两个条件必须分开等：
 *   - record.toolCallId 在 spawn 后立刻就有（后台由插件写、前台由补丁写）；
 *   - record.session 要等子会话创建完成（插件里 onStart 早于会话创建：
 *     node_modules/@tintinweb/pi-subagents/dist/agent-manager.js:506 vs :568-608）。
 * 只等 toolCallId 就 subscribe 会拿到 undefined。
 */
import { logWarn } from "../../utils/logger";
import type { SubagentActivity } from "../../../shared/subagent-activity";
import {
  type ActivityState,
  type AgentRecordView,
  type SessionEventLike,
  applySessionEvent,
  buildSnapshot,
  createActivityState,
  isTerminalRecordStatus,
} from "./activity-state";

export const MANAGER_LIST_SYMBOL = "pi-subagents:manager-list";

export interface TapSubscribableSession {
  subscribe(listener: (event: unknown) => void): () => void;
}

export interface TapRecord extends AgentRecordView {
  id?: string;
  toolCallId?: string;
  session?: TapSubscribableSession;
}

export interface TapRegistryEntry {
  listAgents?: () => unknown[];
}

export function readManagerRegistry(): TapRegistryEntry[] | undefined {
  const value = (globalThis as unknown as Record<PropertyKey, unknown>)[
    Symbol.for(MANAGER_LIST_SYMBOL)
  ];
  if (!(value instanceof Set)) return undefined;
  return [...value] as TapRegistryEntry[];
}

/**
 * 从全局列表里摘掉本次激活登记的 entry。
 * 补丁本想在 `session_shutdown` 里清，但 DeskWand 的宿用 `createAgentSession` +
 * `session.dispose()`，而 `AgentSession.dispose()` 并不发 `session_shutdown`
 * （node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:825-837），
 * 所以必须由调用方在会话释放时主动摘下，否则该条目（连同它的 AgentManager）会到进程结束。
 */
export function releaseManagerRegistryEntry(entry: TapRegistryEntry): void {
  const value = (globalThis as unknown as Record<PropertyKey, unknown>)[
    Symbol.for(MANAGER_LIST_SYMBOL)
  ];
  if (value instanceof Set) value.delete(entry);
}

/** 捕获本次激活新登记的 entry：factory 刚跑完，用 Set 差集就能认出自己那条。 */
export function diffRegistryEntries(
  before: ReadonlySet<TapRegistryEntry>,
): TapRegistryEntry | undefined {
  return (readManagerRegistry() ?? []).find((entry) => !before.has(entry));
}

function findRecord(
  toolCallId: string,
  registry: TapRegistryEntry[],
): TapRecord | undefined {
  for (const entry of registry) {
    const agents = entry.listAgents?.();
    if (!Array.isArray(agents)) continue;
    const hit = agents.find(
      (agent) => (agent as TapRecord | undefined)?.toolCallId === toolCallId,
    );
    if (hit) return hit as TapRecord;
  }
  return undefined;
}

export interface SubagentTapOptions {
  send: (activity: SubagentActivity) => void;
  registry?: () => TapRegistryEntry[] | undefined;
  now?: () => number;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
  throttleMs?: number;
}

export interface SubagentTap {
  observeAgentToolCall(sessionId: string, toolCallId: string): void;
  finishAgent(agentId: string, status: "completed" | "error"): void;
  disposeSession(sessionId: string): void;
}

const DEFAULT_POLL_INTERVAL_MS = 100;
const DEFAULT_MAX_POLL_ATTEMPTS = 20;
/** record 就绪但子会话未建时的轮询间隔：排队可能长达分钟级，所以放慢且不限次。 */
const SESSION_WAIT_INTERVAL_MS = 500;
const DEFAULT_THROTTLE_MS = 150;

interface AgentTapState {
  sessionId: string;
  toolCallId: string;
  state: ActivityState;
  record?: TapRecord;
  unsubscribe?: () => void;
  pollTimer?: ReturnType<typeof setTimeout>;
  flushTimer?: ReturnType<typeof setTimeout>;
  attempts: number;
  finished: boolean;
}

export function createSubagentTap(options: SubagentTapOptions): SubagentTap {
  const now = options.now ?? (() => Date.now());
  const registry = options.registry ?? readManagerRegistry;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxPollAttempts = options.maxPollAttempts ?? DEFAULT_MAX_POLL_ATTEMPTS;
  const throttleMs = options.throttleMs ?? DEFAULT_THROTTLE_MS;
  const agents = new Map<string, AgentTapState>();
  /** completed/failed 事件只带 agentId，反查回 toolCallId 才能对上 agents 表。 */
  const agentIdToToolCallId = new Map<string, string>();

  const clear = (tap: AgentTapState) => {
    if (tap.pollTimer) clearTimeout(tap.pollTimer);
    if (tap.flushTimer) clearTimeout(tap.flushTimer);
    tap.pollTimer = undefined;
    tap.flushTimer = undefined;
  };

  const sendSnapshot = (
    tap: AgentTapState,
    statusOverride?: "running" | "completed" | "error",
  ) => {
    if (!tap.record) return;
    options.send(
      buildSnapshot({
        sessionId: tap.sessionId,
        agentId: tap.record.id ?? tap.toolCallId,
        toolCallId: tap.toolCallId,
        state: tap.state,
        record: tap.record,
        now: now(),
        status: statusOverride,
      }),
    );
  };

  const scheduleFlush = (tap: AgentTapState) => {
    if (tap.finished || tap.flushTimer) return;
    tap.flushTimer = setTimeout(() => {
      tap.flushTimer = undefined;
      sendSnapshot(tap);
      if (tap.record && isTerminalRecordStatus(tap.record.status)) {
        finish(
          tap.toolCallId,
          tap.record.status === "completed" ? "completed" : "error",
        );
      }
    }, throttleMs);
  };

  function finish(toolCallId: string, status: "completed" | "error") {
    const tap = agents.get(toolCallId);
    if (!tap || tap.finished) return;
    tap.finished = true;
    clear(tap);
    // 只把状态传给快照，**绝不回写 record**：插件自己也读 record.status
    // （通知文案、getStatusNote、结果消费都靠它），改它等于破坏上游状态机。
    if (tap.record) sendSnapshot(tap, status);
    tap.unsubscribe?.();
    tap.unsubscribe = undefined;
    agents.delete(toolCallId);
    if (tap.record?.id) agentIdToToolCallId.delete(tap.record.id);
  }

  const poll = (tap: AgentTapState) => {
    if (tap.finished) return;
    const entry = findRecord(tap.toolCallId, registry() ?? []);
    if (entry?.session) {
      tap.record = entry;
      if (entry.id) agentIdToToolCallId.set(entry.id, tap.toolCallId);
      tap.unsubscribe = entry.session.subscribe((event) => {
        const handled = applySessionEvent(
          tap.state,
          event as SessionEventLike,
          now(),
        );
        if (handled) scheduleFlush(tap);
      });
      scheduleFlush(tap);
      return;
    }
    if (entry) {
      // record 已经存在但子会话还没建：典型的「排队等并发位」。这不是失败，
      // 不计入放弃次数，慢慢等；record 已经进入终态就别等了（不会再开会话）。
      tap.record = entry;
      if (entry.id) agentIdToToolCallId.set(entry.id, tap.toolCallId);
      if (isTerminalRecordStatus(entry.status)) {
        clear(tap);
        if (entry.id) agentIdToToolCallId.delete(entry.id);
        agents.delete(tap.toolCallId);
        return;
      }
      tap.pollTimer = setTimeout(() => poll(tap), SESSION_WAIT_INTERVAL_MS);
      return;
    }
    tap.attempts += 1;
    if (tap.attempts >= maxPollAttempts) {
      logWarn(
        `[SubagentTap] Gave up binding subagent: toolCallId=${tap.toolCallId} (record never appeared)`,
      );
      clear(tap);
      agents.delete(tap.toolCallId);
      return;
    }
    tap.pollTimer = setTimeout(() => poll(tap), pollIntervalMs);
  };

  return {
    observeAgentToolCall(sessionId, toolCallId) {
      if (agents.has(toolCallId)) return;
      const tap: AgentTapState = {
        sessionId,
        toolCallId,
        state: createActivityState(),
        attempts: 0,
        finished: false,
      };
      agents.set(toolCallId, tap);
      poll(tap);
    },
    finishAgent(agentId, status) {
      const toolCallId = agentIdToToolCallId.get(agentId);
      if (!toolCallId) return;
      finish(toolCallId, status);
    },
    disposeSession(sessionId) {
      for (const tap of [...agents.values()]) {
        if (tap.sessionId !== sessionId) continue;
        tap.finished = true;
        clear(tap);
        tap.unsubscribe?.();
        if (tap.record?.id) agentIdToToolCallId.delete(tap.record.id);
        agents.delete(tap.toolCallId);
      }
    },
  };
}
