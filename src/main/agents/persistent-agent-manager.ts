/**
 * @module main/agents/persistent-agent-manager
 *
 * 常驻智能体的生命周期与唤醒调度。
 *
 * 一个智能体绑定一个永久会话；唤醒 = 往这个会话 `continueSession` 一条
 * `<agent_wakeup>` 消息。唤醒来源有四种：
 * - 兜底（interval 规则）：`nextPeriodicAt` 是 deadline，每轮结束重置为「结束时刻 + N」；
 * - 周期（daily / weekly 规则）：`nextPeriodicAt` 是下个固定时刻；
 * - 签到：智能体自己设的下次唤醒（`nextCheckInAt`，单槽位，interval 下不晚于兜底）；
 * - 预约：智能体预约的具体时刻（store 里的 wakeups）。
 * 每个智能体只挂一个定时器，指向它们中最早的那个。
 *
 * 会话忙（用户在聊 / 上一轮唤醒没跑完）时不并发投递：触发原因先攒在内存里，
 * 轮次结束时合并成一条再投。
 */
import { v4 as uuidv4 } from "uuid";
import {
  AGENT_SESSION_LOST_ERROR,
  MAX_CONSECUTIVE_FAILURES,
  MAX_PENDING_WAKEUPS,
  MIN_WAKEUP_DELAY_MS,
  type AgentScheduleConfig,
  type PersistentAgent,
  type PersistentAgentCreateInput,
  type PersistentAgentUpdateInput,
  type PersistentAgentView,
  type PersistentAgentWakeup,
} from "../../shared/persistent-agent";
import {
  MAX_TIMER_DELAY_MS,
  computeNextRunAt,
  countSlotsBetween,
  type ScheduleRule,
} from "../schedule/schedule-rules";
import { logError } from "../utils/logger";
import type { PersistentAgentStore } from "./persistent-agent-store";
import { buildWakeupMessage, type WakeupTrigger } from "./wakeup-message";

export interface AgentSessionPort {
  createAgentSession(name: string, cwd: string): string;
  continueSession(sessionId: string, prompt: string): Promise<void>;
  isSessionRunning(sessionId: string): boolean;
  sessionExists(sessionId: string): boolean;
  renameSession(sessionId: string, title: string): void;
  /** 删除智能体但保留会话时调用：会话 kind 改回 ordinary。 */
  releaseSession(sessionId: string): void;
  deleteSession(sessionId: string): Promise<void>;
}

export type PersistentAgentEvent =
  | { type: "updated"; agent: PersistentAgentView }
  | { type: "removed"; agentId: string }
  | { type: "auto-paused"; agent: PersistentAgentView };

export interface PersistentAgentManagerOptions {
  store: PersistentAgentStore;
  sessions: AgentSessionPort;
  /** 返回工作目录不可用的原因；可用时返回 null。 */
  checkWorkspace: (cwd: string) => string | null;
  onEvent: (event: PersistentAgentEvent) => void;
  now?: () => number;
}

export type AgentTurnResult = "success" | "failure" | "cancelled";

interface PendingDelivery {
  triggers: WakeupTrigger[];
  missedCount: number;
}

function toRule(
  schedule: AgentScheduleConfig,
  runAt: number,
  nextRunAt: number | null,
): ScheduleRule {
  if (schedule.kind === "interval") {
    return {
      runAt,
      nextRunAt,
      scheduleConfig: null,
      repeatEvery: schedule.every,
      repeatUnit: schedule.unit,
    };
  }
  return {
    runAt,
    nextRunAt,
    scheduleConfig: schedule,
    repeatEvery: null,
    repeatUnit: null,
  };
}

/** 从「现在」起算的下一个周期点（新建 / 改规则 / 恢复时用）。 */
function nextPeriodicFrom(
  schedule: AgentScheduleConfig,
  now: number,
): number | null {
  return computeNextRunAt(toRule(schedule, now, null), now);
}

export class PersistentAgentManager {
  private readonly store: PersistentAgentStore;
  private readonly sessions: AgentSessionPort;
  private readonly checkWorkspace: (cwd: string) => string | null;
  private readonly onEvent: (event: PersistentAgentEvent) => void;
  private readonly now: () => number;
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly pending = new Map<string, PendingDelivery>();
  /** 已投递、还没等到轮次结果的唤醒（按智能体 id）。 */
  private readonly inFlight = new Set<string>();
  private running = false;

  constructor(options: PersistentAgentManagerOptions) {
    this.store = options.store;
    this.sessions = options.sessions;
    this.checkWorkspace = options.checkWorkspace;
    this.onEvent = options.onEvent;
    this.now = options.now ?? (() => Date.now());
  }

  start(): void {
    this.running = true;
    // 已过期的智能体会立刻触发一次，错过的周期在 fire 里合并成「错过 N 次」。
    // 窗口比 manager 先建好，渲染层挂载时拉列表可能拿到空数组，这里补推一遍。
    for (const agent of this.store.list()) {
      this.arm(agent.id);
      this.emit(agent.id);
    }
  }

  stop(): void {
    this.running = false;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  list(): PersistentAgentView[] {
    return this.store.list().map((agent) => this.toView(agent));
  }

  get(id: string): PersistentAgentView | null {
    const agent = this.store.get(id);
    return agent ? this.toView(agent) : null;
  }

  findBySessionId(sessionId: string): PersistentAgent | null {
    return this.store.getBySessionId(sessionId);
  }

  listWakeups(id: string): PersistentAgentWakeup[] {
    return this.store.listWakeups(id);
  }

  async create(
    input: PersistentAgentCreateInput,
  ): Promise<PersistentAgentView> {
    const now = this.now();
    const sessionId = this.sessions.createAgentSession(input.name, input.cwd);
    const agent: PersistentAgent = {
      id: uuidv4(),
      name: input.name,
      instructions: input.instructions,
      cwd: input.cwd,
      sessionId,
      avatarSeed: input.avatarSeed?.trim() || uuidv4(),
      schedule: input.schedule,
      enabled: true,
      nextPeriodicAt: nextPeriodicFrom(input.schedule, now),
      consecutiveFailures: 0,
      lastWakeupAt: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
      nextCheckInAt: null,
      checkInNote: null,
    };
    this.store.insert(agent);
    this.arm(agent.id);
    if (input.wakeImmediately) {
      await this.deliver(agent.id, [{ type: "manual" }], 0);
    }
    return this.emit(agent.id)!;
  }

  update(
    id: string,
    patch: PersistentAgentUpdateInput,
  ): PersistentAgentView | null {
    let scheduleFields: Partial<PersistentAgent> = {};
    if (patch.schedule) {
      const deadline = nextPeriodicFrom(patch.schedule, this.now());
      scheduleFields = { nextPeriodicAt: deadline };
      // 改成 interval 后，已有签到不能晚于新的兜底 deadline
      const checkInAt = this.store.get(id)?.nextCheckInAt ?? null;
      if (
        patch.schedule.kind === "interval" &&
        deadline !== null &&
        checkInAt !== null &&
        checkInAt > deadline
      ) {
        scheduleFields.nextCheckInAt = deadline;
      }
    }
    const updated = this.store.update(id, { ...patch, ...scheduleFields });
    if (!updated) return null;
    if (patch.name !== undefined) {
      this.sessions.renameSession(updated.sessionId, updated.name);
    }
    this.arm(id);
    return this.emit(id);
  }

  async delete(
    id: string,
    options: { deleteSession: boolean },
  ): Promise<boolean> {
    const agent = this.store.get(id);
    if (!agent) return false;
    this.forget(id);
    this.store.delete(id);
    if (options.deleteSession) {
      await this.sessions.deleteSession(agent.sessionId);
    } else if (this.sessions.sessionExists(agent.sessionId)) {
      this.sessions.releaseSession(agent.sessionId);
    }
    this.onEvent({ type: "removed", agentId: id });
    return true;
  }

  pause(id: string): PersistentAgentView | null {
    if (!this.store.update(id, { enabled: false })) return null;
    this.forget(id);
    return this.emit(id);
  }

  resume(id: string): PersistentAgentView | null {
    const agent = this.store.get(id);
    if (!agent) return null;
    const sessionId = this.sessions.sessionExists(agent.sessionId)
      ? agent.sessionId
      : this.sessions.createAgentSession(agent.name, agent.cwd);
    this.store.update(id, {
      enabled: true,
      sessionId,
      consecutiveFailures: 0,
      lastError: null,
      nextPeriodicAt: nextPeriodicFrom(agent.schedule, this.now()),
      nextCheckInAt: null,
      checkInNote: null,
    });
    this.arm(id);
    return this.emit(id);
  }

  async wakeNow(id: string): Promise<PersistentAgentView | null> {
    const agent = this.store.get(id);
    if (!agent) return null;
    if (agent.enabled) await this.deliver(id, [{ type: "manual" }], 0);
    return this.emit(id);
  }

  /** 校验失败抛 Error，文案是给模型看的英文。 */
  scheduleWakeup(
    agentId: string,
    runAt: number,
    reason: string,
  ): PersistentAgentWakeup {
    if (!this.store.get(agentId)) throw new Error("Unknown agent.");
    if (runAt < this.now() + MIN_WAKEUP_DELAY_MS) {
      throw new Error("Wakeup must be at least 1 minute in the future.");
    }
    if (this.store.countWakeups(agentId) >= MAX_PENDING_WAKEUPS) {
      throw new Error(
        `Too many pending wakeups (max ${MAX_PENDING_WAKEUPS}). Cancel some first.`,
      );
    }
    const wakeup: PersistentAgentWakeup = {
      id: uuidv4(),
      agentId,
      runAt,
      reason,
      createdAt: this.now(),
    };
    this.store.insertWakeup(wakeup);
    this.arm(agentId);
    this.emit(agentId);
    return wakeup;
  }

  cancelWakeup(agentId: string, wakeupId: string): boolean {
    const removed = this.store.deleteWakeup(agentId, wakeupId);
    if (removed) {
      this.arm(agentId);
      this.emit(agentId);
    }
    return removed;
  }

  /** 会话一轮结束（任何轮次）。只有唤醒轮次计成败；随后把攒着的唤醒投出去。 */
  onTurnFinished(
    sessionId: string,
    result: AgentTurnResult,
    error?: string,
  ): void {
    const agent = this.store.getBySessionId(sessionId);
    if (!agent) return;

    if (this.inFlight.delete(agent.id) && result !== "cancelled") {
      if (result === "success") {
        this.store.update(agent.id, {
          consecutiveFailures: 0,
          lastError: null,
        });
      } else {
        const failures = agent.consecutiveFailures + 1;
        const tripped = failures >= MAX_CONSECUTIVE_FAILURES;
        this.store.update(agent.id, {
          consecutiveFailures: failures,
          lastError: error ?? "Turn failed",
          ...(tripped ? { enabled: false } : {}),
        });
        if (tripped) {
          this.forget(agent.id);
          const view = this.get(agent.id);
          if (view) this.onEvent({ type: "auto-paused", agent: view });
          return;
        }
      }
    }
    this.resetWatchdog(agent.id);
    this.emit(agent.id);

    const queued = this.pending.get(agent.id);
    if (queued && this.store.get(agent.id)?.enabled) {
      this.pending.delete(agent.id);
      // 伙伴刚结束一轮，排队的兜底触发作废；其他触发照常投
      const triggers = queued.triggers.filter(
        (trigger) => trigger.type !== "watchdog",
      );
      // 轮次结束钩子触发时会话可能还没切回 idle；continueSession 本身会排队，直接投
      if (triggers.length > 0) {
        void this.deliver(agent.id, triggers, queued.missedCount, true);
      }
    }
  }

  onSessionLost(sessionId: string): void {
    const agent = this.store.getBySessionId(sessionId);
    if (!agent) return;
    this.forget(agent.id);
    this.store.update(agent.id, {
      enabled: false,
      lastError: AGENT_SESSION_LOST_ERROR,
    });
    this.emit(agent.id);
  }

  /** 设置下次签到（覆盖式）。校验失败抛 Error，文案是给模型看的英文。 */
  setCheckIn(
    agentId: string,
    runAt: number,
    note: string | null,
  ): { runAt: number; capped: boolean; schedule: AgentScheduleConfig } {
    const agent = this.store.get(agentId);
    if (!agent) throw new Error("Unknown agent.");
    const now = this.now();
    if (runAt < now + MIN_WAKEUP_DELAY_MS) {
      throw new Error("Check-in must be at least 1 minute in the future.");
    }
    let at = runAt;
    let capped = false;
    if (agent.schedule.kind === "interval") {
      const limit = nextPeriodicFrom(agent.schedule, now);
      if (limit !== null && at > limit) {
        at = limit;
        capped = true;
      }
    }
    this.store.update(agentId, { nextCheckInAt: at, checkInNote: note });
    this.arm(agentId);
    this.emit(agentId);
    return { runAt: at, capped, schedule: agent.schedule };
  }

  /** 一轮结束后重置 interval 兜底 deadline，并把签到截到它之内。 */
  private resetWatchdog(id: string): void {
    const agent = this.store.get(id);
    if (!agent?.enabled || agent.schedule.kind !== "interval") return;
    const deadline = nextPeriodicFrom(agent.schedule, this.now());
    if (deadline === null) return;
    this.store.update(id, {
      nextPeriodicAt: deadline,
      ...(agent.nextCheckInAt !== null && agent.nextCheckInAt > deadline
        ? { nextCheckInAt: deadline }
        : {}),
    });
    this.arm(id);
  }

  private toView(agent: PersistentAgent): PersistentAgentView {
    const wakeups = this.store.listWakeups(agent.id);
    const earliest = wakeups[0];
    let nextWakeup: PersistentAgentView["nextWakeup"] = null;
    if (agent.enabled) {
      // 同一时刻的优先级：预约 > 签到 > 兜底 / 周期（候选顺序即优先级，严格小于才替换）
      const candidates: NonNullable<PersistentAgentView["nextWakeup"]>[] = [];
      if (earliest) {
        candidates.push({
          at: earliest.runAt,
          kind: "appointment",
          reason: earliest.reason,
        });
      }
      if (agent.nextCheckInAt !== null) {
        candidates.push({
          at: agent.nextCheckInAt,
          kind: "check_in",
          reason: agent.checkInNote,
        });
      }
      if (agent.nextPeriodicAt !== null) {
        candidates.push({
          at: agent.nextPeriodicAt,
          kind: agent.schedule.kind === "interval" ? "watchdog" : "periodic",
          reason: null,
        });
      }
      for (const candidate of candidates) {
        if (!nextWakeup || candidate.at < nextWakeup.at) nextWakeup = candidate;
      }
    }
    return {
      ...agent,
      status: !agent.enabled
        ? "paused"
        : agent.lastError
          ? "error"
          : "sleeping",
      nextWakeup,
      pendingWakeupCount: wakeups.length,
    };
  }

  private emit(id: string): PersistentAgentView | null {
    const view = this.get(id);
    if (view) this.onEvent({ type: "updated", agent: view });
    return view;
  }

  private clearTimer(id: string): void {
    const timer = this.timers.get(id);
    if (timer) clearTimeout(timer);
    this.timers.delete(id);
  }

  private forget(id: string): void {
    this.clearTimer(id);
    this.pending.delete(id);
    this.inFlight.delete(id);
  }

  private nextTarget(agent: PersistentAgent): number | null {
    const earliest = this.store.listWakeups(agent.id)[0]?.runAt ?? null;
    const candidates = [agent.nextCheckInAt, agent.nextPeriodicAt, earliest];
    const present = candidates.filter((at): at is number => at !== null);
    return present.length > 0 ? Math.min(...present) : null;
  }

  private arm(id: string): void {
    this.clearTimer(id);
    if (!this.running) return;
    const agent = this.store.get(id);
    if (!agent?.enabled) return;
    const target = this.nextTarget(agent);
    if (target === null) return;
    const delay = Math.max(0, target - this.now());
    this.timers.set(
      id,
      setTimeout(() => void this.fire(id), Math.min(delay, MAX_TIMER_DELAY_MS)),
    );
  }

  private async fire(id: string): Promise<void> {
    this.timers.delete(id);
    const agent = this.store.get(id);
    if (!agent?.enabled) return;
    const now = this.now();
    const target = this.nextTarget(agent);
    if (target === null) return;
    if (target > now) {
      // 延迟被截断过（超过 setTimeout 上限）：到点只重挂
      this.arm(id);
      return;
    }

    const triggers: WakeupTrigger[] = [];
    let missedCount = 0;
    let nextPeriodicAt = agent.nextPeriodicAt;
    let nextCheckInAt = agent.nextCheckInAt;
    let checkInNote = agent.checkInNote;
    const checkInDue = nextCheckInAt !== null && nextCheckInAt <= now;
    if (checkInDue) {
      triggers.push({ type: "check_in", note: checkInNote });
      nextCheckInAt = null;
      checkInNote = null;
    }
    if (nextPeriodicAt !== null && nextPeriodicAt <= now) {
      if (agent.schedule.kind === "interval") {
        // 兜底不算错过：只醒一次。签到同时到期时，签到行已说明原因，不再加兜底行。
        if (!checkInDue) triggers.push({ type: "watchdog" });
        // 先留一个新 deadline：投递失败时定时器也不会失联，轮次结束再按结束时刻覆盖
        nextPeriodicAt = nextPeriodicFrom(agent.schedule, now);
      } else {
        triggers.push({ type: "periodic" });
        const rule = toRule(agent.schedule, agent.createdAt, nextPeriodicAt);
        missedCount = countSlotsBetween(rule, nextPeriodicAt, now);
        nextPeriodicAt = computeNextRunAt(rule, now);
      }
    }
    for (const due of this.store.takeDueWakeups(id, now)) {
      triggers.push({ type: "scheduled", reason: due.reason });
    }
    this.store.update(id, { nextPeriodicAt, nextCheckInAt, checkInNote });
    await this.deliver(id, triggers, missedCount);
  }

  private async deliver(
    id: string,
    triggers: WakeupTrigger[],
    missedCount: number,
    ignoreBusy = false,
  ): Promise<void> {
    const agent = this.store.get(id);
    if (!agent?.enabled || triggers.length === 0) {
      this.arm(id);
      return;
    }
    const sessionRunning = this.sessions.isSessionRunning(agent.sessionId);
    // 轮次被取消而结束钩子没触发时，在途标记会一直挂着；会话已经不跑了就清掉
    if (this.inFlight.has(id) && !sessionRunning) this.inFlight.delete(id);

    if (!this.sessions.sessionExists(agent.sessionId)) {
      this.onSessionLost(agent.sessionId);
      return;
    }
    const unavailable = this.checkWorkspace(agent.cwd);
    if (unavailable) {
      this.store.update(id, { lastError: unavailable });
      this.arm(id);
      this.emit(id);
      return;
    }
    if (!ignoreBusy && (this.inFlight.has(id) || sessionRunning)) {
      const queued = this.pending.get(id);
      this.pending.set(id, {
        triggers: [...(queued?.triggers ?? []), ...triggers],
        missedCount: (queued?.missedCount ?? 0) + missedCount,
      });
      this.arm(id);
      return;
    }

    const now = this.now();
    const prompt = buildWakeupMessage({
      now,
      schedule: agent.schedule,
      triggers,
      upcoming: this.store.listWakeups(id),
      missedCount,
    });
    this.inFlight.add(id);
    this.store.update(id, { lastWakeupAt: now });
    this.arm(id);
    this.emit(id);
    try {
      await this.sessions.continueSession(agent.sessionId, prompt);
    } catch (error) {
      logError("[PersistentAgentManager] Wakeup delivery failed:", error);
      this.onTurnFinished(
        agent.sessionId,
        "failure",
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}
