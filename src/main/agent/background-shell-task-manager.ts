/**
 * @module main/agent/background-shell-task-manager
 *
 * 后台终端任务的状态机。只做状态与限额，不碰 fs / IPC / i18n ——
 * 这样它能在没有 Electron 的 vitest 里被直接测。
 */

import type { ShellTask, ShellToolName } from "../../shared/shell-task";

export interface ShellTaskSettleInput {
  exitCode: number | null;
  output: string;
  outputPath?: string;
  /** pi 自己的 timeout 抛出来的（区别于管理器自己的 30 分钟兜底）。 */
  timedOut?: boolean;
}

export interface BackgroundShellTaskManagerOptions {
  onEvent: (task: ShellTask) => void;
  now?: () => number;
  /** 每会话最多几条同时处于 detached。默认 3。 */
  maxDetachedPerSession?: number;
  /** 单任务超时。默认 30 分钟。 */
  timeoutMs?: number;
  /** tail 保留的字符数。默认 8192。 */
  tailBytes?: number;
}

export interface PromoteShellTaskInput {
  sessionId: string;
  toolCallId: string;
  toolName: ShellToolName;
  command: string;
  cwd: string;
  /** 命令开始时间（包装层的 execute 入口），不是 detach 时间。 */
  startedAt: number;
  /** 真正终止该进程（由包装层提供，通常是 inner AbortController.abort）。 */
  kill: () => void;
}

const DEFAULT_MAX_DETACHED = 3;
const DEFAULT_TIMEOUT_MS = 30 * 60_000;
const DEFAULT_TAIL_BYTES = 8 * 1024;

interface Entry {
  task: ShellTask;
  kill: () => void;
  timer?: ReturnType<typeof setTimeout>;
}

export class BackgroundShellTaskManager {
  private readonly onEvent: (task: ShellTask) => void;
  private readonly now: () => number;
  private readonly maxDetached: number;
  private readonly timeoutMs: number;
  private readonly tailBytes: number;
  /** sessionId → (toolCallId → entry) */
  private readonly entries = new Map<string, Map<string, Entry>>();
  private readonly counters = new Map<string, number>();

  constructor(options: BackgroundShellTaskManagerOptions) {
    this.onEvent = options.onEvent;
    this.now = options.now ?? Date.now;
    this.maxDetached = options.maxDetachedPerSession ?? DEFAULT_MAX_DETACHED;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.tailBytes = options.tailBytes ?? DEFAULT_TAIL_BYTES;
  }

  /** 还能不能再挂一条后台任务（IPC 侧提前给出明确的失败，而不是先挂上再退化）。 */
  canPromote(sessionId: string): boolean {
    return this.countDetached(sessionId) < this.maxDetached;
  }

  /** 登记一条后台任务。超限返回 null（调用方应退化为前台等待）。 */
  promote(input: PromoteShellTaskInput): ShellTask | null {
    if (!this.canPromote(input.sessionId)) return null;
    const nextId = (this.counters.get(input.sessionId) ?? 0) + 1;
    this.counters.set(input.sessionId, nextId);
    const task: ShellTask = {
      id: String(nextId),
      sessionId: input.sessionId,
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      command: input.command,
      cwd: input.cwd,
      startedAt: input.startedAt,
      detachedAt: this.now(),
      status: "detached",
      tail: "",
      bytesOut: 0,
    };
    const entry: Entry = { task, kill: input.kill };
    entry.timer = setTimeout(() => this.onTimeout(entry), this.timeoutMs);
    // 不阻止进程退出 —— 应用关掉时不需要等这个定时器
    entry.timer.unref?.();
    this.sessionEntries(input.sessionId).set(input.toolCallId, entry);
    this.onEvent({ ...task });
    return { ...task };
  }

  /** onUpdate 的累计快照 → tail（只保留尾部）。 */
  setTail(sessionId: string, toolCallId: string, tail: string): void {
    const entry = this.entries.get(sessionId)?.get(toolCallId);
    if (!entry || entry.task.status !== "detached") return;
    entry.task.tail =
      tail.length > this.tailBytes ? tail.slice(-this.tailBytes) : tail;
    entry.task.bytesOut = Math.max(entry.task.bytesOut, tail.length);
    this.onEvent({ ...entry.task });
  }

  settle(
    sessionId: string,
    toolCallId: string,
    input: ShellTaskSettleInput,
  ): ShellTask | null {
    const entry = this.entries.get(sessionId)?.get(toolCallId);
    if (!entry) return null;
    if (entry.timer) clearTimeout(entry.timer);
    const { task } = entry;
    // timeout / killed 由 onTimeout / cancel 先落定，这里只补 exitCode 与耗时
    if (task.status === "detached") {
      task.status = input.timedOut
        ? "timeout"
        : input.exitCode === 0
          ? "completed"
          : "failed";
    }
    task.exitCode = input.exitCode ?? undefined;
    task.outputPath = input.outputPath;
    task.settledAt = this.now();
    task.durationMs = task.settledAt - task.startedAt;
    task.bytesOut = Math.max(task.bytesOut, input.output.length);
    if (!input.outputPath && input.output.length > 0) {
      task.tail =
        input.output.length > this.tailBytes
          ? input.output.slice(-this.tailBytes)
          : input.output;
    }
    this.entries.get(sessionId)!.delete(toolCallId);
    this.onEvent({ ...task });
    return { ...task };
  }

  cancel(sessionId: string, taskId: string): boolean {
    const entry = this.findByTaskId(sessionId, taskId);
    if (!entry || entry.task.status !== "detached") return false;
    entry.task.status = "killed";
    entry.task.settledAt = this.now();
    entry.task.durationMs = entry.task.settledAt - entry.task.startedAt;
    if (entry.timer) clearTimeout(entry.timer);
    this.onEvent({ ...entry.task });
    entry.kill();
    return true;
  }

  list(sessionId: string): ShellTask[] {
    return [...(this.entries.get(sessionId)?.values() ?? [])].map((e) => ({
      ...e.task,
    }));
  }

  disposeSession(sessionId: string): void {
    const map = this.entries.get(sessionId);
    if (!map) return;
    for (const entry of map.values()) {
      if (entry.timer) clearTimeout(entry.timer);
      if (entry.task.status === "detached") entry.kill();
    }
    this.entries.delete(sessionId);
    this.counters.delete(sessionId);
  }

  killAll(): void {
    for (const sessionId of [...this.entries.keys()]) {
      this.disposeSession(sessionId);
    }
  }

  private onTimeout(entry: Entry): void {
    if (entry.task.status !== "detached") return;
    entry.task.status = "timeout";
    entry.task.settledAt = this.now();
    entry.task.durationMs = entry.task.settledAt - entry.task.startedAt;
    this.onEvent({ ...entry.task });
    entry.kill();
  }

  private countDetached(sessionId: string): number {
    const map = this.entries.get(sessionId);
    if (!map) return 0;
    let n = 0;
    for (const entry of map.values()) {
      if (entry.task.status === "detached") n += 1;
    }
    return n;
  }

  private findByTaskId(sessionId: string, taskId: string): Entry | undefined {
    for (const entry of this.entries.get(sessionId)?.values() ?? []) {
      if (entry.task.id === taskId) return entry;
    }
    return undefined;
  }

  private sessionEntries(sessionId: string): Map<string, Entry> {
    let map = this.entries.get(sessionId);
    if (!map) {
      map = new Map();
      this.entries.set(sessionId, map);
    }
    return map;
  }
}
