/**
 * @module main/schedule/scheduled-task-manager
 *
 * Cron-like scheduled task system (488 lines).
 *
 * Responsibilities:
 * - Scheduled task CRUD with daily/weekly/interval repeat modes
 * - Timer-based execution engine with tick loop
 * - Task persistence via SQLite (ScheduledTask rows)
 * - Delegates execution to session-manager for AI-powered tasks
 *
 * Dependencies: session-manager, database
 */
import {
  buildScheduledTaskFallbackTitle,
  buildScheduledTaskTitle,
} from "../../shared/schedule/task-title";
import { getLocale } from "../i18n";
import { log, logError } from "../utils/logger";
import {
  MAX_TIMER_DELAY_MS,
  computeNextRunAt,
  isRepeatingRule,
  normalizeRepeatEvery,
  normalizeRepeatUnit,
  normalizeScheduleConfig,
} from "./schedule-rules";

export type ScheduleRepeatUnit = "minute" | "hour" | "day";
export type ScheduledTaskWeekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface ScheduledTaskDailyScheduleConfig {
  kind: "daily";
  times: string[];
}

export interface ScheduledTaskWeeklyScheduleConfig {
  kind: "weekly";
  weekdays: ScheduledTaskWeekday[];
  times: string[];
}

export type ScheduledTaskScheduleConfig =
  | ScheduledTaskDailyScheduleConfig
  | ScheduledTaskWeeklyScheduleConfig;

export interface ScheduledTask {
  id: string;
  title: string;
  prompt: string;
  cwd: string;
  runAt: number;
  nextRunAt: number | null;
  scheduleConfig: ScheduledTaskScheduleConfig | null;
  repeatEvery: number | null;
  repeatUnit: ScheduleRepeatUnit | null;
  enabled: boolean;
  lastRunAt: number | null;
  lastRunSessionId: string | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ScheduledTaskCreateInput {
  title?: string;
  prompt: string;
  cwd: string;
  runAt: number;
  nextRunAt?: number | null;
  scheduleConfig?: ScheduledTaskScheduleConfig | null;
  repeatEvery?: number | null;
  repeatUnit?: ScheduleRepeatUnit | null;
  enabled?: boolean;
}

export interface ScheduledTaskUpdateInput {
  title?: string;
  prompt?: string;
  cwd?: string;
  runAt?: number;
  nextRunAt?: number | null;
  scheduleConfig?: ScheduledTaskScheduleConfig | null;
  repeatEvery?: number | null;
  repeatUnit?: ScheduleRepeatUnit | null;
  enabled?: boolean;
  lastRunAt?: number | null;
  lastRunSessionId?: string | null;
  lastError?: string | null;
}

export interface ScheduledTaskStore {
  list(): ScheduledTask[];
  get(id: string): ScheduledTask | null;
  create(input: ScheduledTaskCreateInput): ScheduledTask;
  update(id: string, updates: ScheduledTaskUpdateInput): ScheduledTask | null;
  delete(id: string): boolean;
}

export interface ScheduledTaskRunResult {
  sessionId: string;
}

interface ScheduledTaskExecutionRecord {
  success: boolean;
  sessionId?: string;
  error?: string;
}

interface ScheduledTaskManagerOptions {
  store: ScheduledTaskStore;
  executeTask: (task: ScheduledTask) => Promise<ScheduledTaskRunResult>;
  onTaskError?: (taskId: string, error: string) => void;
  now?: () => number;
}

export class ScheduledTaskManager {
  private readonly store: ScheduledTaskStore;
  private readonly executeTask: (
    task: ScheduledTask,
  ) => Promise<ScheduledTaskRunResult>;
  private readonly onTaskError?: (taskId: string, error: string) => void;
  private readonly now: () => number;
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly executingTasks = new Set<string>();
  private running = false;

  constructor(options: ScheduledTaskManagerOptions) {
    this.store = options.store;
    this.executeTask = options.executeTask;
    this.onTaskError = options.onTaskError;
    this.now = options.now ?? (() => Date.now());
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const tasks = this.store.list();
    for (const task of tasks) {
      this.scheduleTask(task);
    }
  }

  stop(): void {
    this.running = false;
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  list(): ScheduledTask[] {
    return this.store.list().sort((a, b) => {
      if (a.enabled !== b.enabled) {
        return a.enabled ? -1 : 1;
      }
      const aNextRun = a.nextRunAt ?? Number.MAX_SAFE_INTEGER;
      const bNextRun = b.nextRunAt ?? Number.MAX_SAFE_INTEGER;
      if (aNextRun !== bNextRun) {
        return aNextRun - bNextRun;
      }
      return b.createdAt - a.createdAt;
    });
  }

  get(id: string): ScheduledTask | null {
    return this.store.get(id);
  }

  create(input: ScheduledTaskCreateInput): ScheduledTask {
    const normalizedPrompt = input.prompt.trim();
    const normalizedTitle = input.title
      ? buildScheduledTaskTitle(input.title, getLocale())
      : buildScheduledTaskFallbackTitle(normalizedPrompt, getLocale());
    const normalizedScheduleConfig = normalizeScheduleConfig(
      input.scheduleConfig,
    );
    const normalizedRepeatEvery = normalizedScheduleConfig
      ? null
      : normalizeRepeatEvery(input.repeatEvery);
    const normalizedRepeatUnit =
      normalizedScheduleConfig || normalizedRepeatEvery === null
        ? null
        : normalizeRepeatUnit(input.repeatUnit);
    const created = this.store.create({
      ...input,
      title: normalizedTitle,
      prompt: normalizedPrompt,
      scheduleConfig: normalizedScheduleConfig,
      nextRunAt: input.nextRunAt ?? input.runAt,
      enabled: input.enabled ?? true,
      repeatEvery: normalizedRepeatEvery,
      repeatUnit: normalizedRepeatUnit,
    });
    this.scheduleTask(created);
    return created;
  }

  update(id: string, updates: ScheduledTaskUpdateInput): ScheduledTask | null {
    const current = this.store.get(id);
    if (!current) return null;
    const nextPrompt =
      updates.prompt === undefined ? current.prompt : updates.prompt.trim();
    const nextTitle =
      updates.title === undefined
        ? current.title
        : buildScheduledTaskTitle(updates.title || nextPrompt, getLocale());
    const nextScheduleConfig =
      updates.scheduleConfig === undefined
        ? undefined
        : normalizeScheduleConfig(updates.scheduleConfig);
    const usesScheduleConfig =
      nextScheduleConfig !== undefined
        ? nextScheduleConfig !== null
        : current.scheduleConfig !== null;
    const nextRepeatEvery = usesScheduleConfig
      ? null
      : updates.repeatEvery === undefined
        ? undefined
        : normalizeRepeatEvery(updates.repeatEvery);
    let nextRepeatUnit = usesScheduleConfig
      ? null
      : updates.repeatUnit === undefined
        ? undefined
        : normalizeRepeatUnit(updates.repeatUnit);
    if (
      !usesScheduleConfig &&
      nextRepeatEvery !== undefined &&
      nextRepeatEvery === null
    ) {
      nextRepeatUnit = null;
    }
    const updated = this.store.update(id, {
      ...updates,
      prompt: nextPrompt,
      title: nextTitle,
      scheduleConfig: nextScheduleConfig,
      repeatEvery: nextRepeatEvery,
      repeatUnit: nextRepeatUnit,
    });
    if (!updated) return null;
    this.scheduleTask(updated);
    return updated;
  }

  delete(id: string): boolean {
    this.clearTimer(id);
    return this.store.delete(id);
  }

  toggle(id: string, enabled: boolean): ScheduledTask | null {
    const current = this.store.get(id);
    if (!current) return null;
    if (enabled && !isRepeatingRule(current)) {
      const oneTimeRunAt = current.nextRunAt ?? current.runAt;
      if (oneTimeRunAt <= this.now()) {
        throw new Error(
          "Cannot enable: one-time task is overdue. Edit the schedule first.",
        );
      }
    }
    const nextRunAt = enabled ? this.computeToggleNextRunAt(current) : null;
    const updated = this.store.update(id, { enabled, nextRunAt });
    if (!updated) return null;
    this.scheduleTask(updated);
    return updated;
  }

  async runNow(id: string): Promise<ScheduledTask | null> {
    const task = this.store.get(id);
    if (!task) return null;
    if (this.executingTasks.has(id)) {
      throw new Error("Task is already executing");
    }
    this.executingTasks.add(id);
    const taskToExecute = this.prepareExecution(task);
    try {
      const execution = await this.executeAndRecord(taskToExecute);
      if (!execution.success) {
        throw new Error(execution.error ?? "Scheduled task execution failed");
      }
    } finally {
      this.executingTasks.delete(id);
    }
    return this.store.get(id);
  }

  private scheduleTask(task: ScheduledTask): void {
    this.clearTimer(task.id);
    if (!this.running) return;
    if (!task.enabled) return;
    if (task.nextRunAt === null) return;
    const delay = Math.max(0, task.nextRunAt - this.now());
    const effectiveDelay = Math.min(delay, MAX_TIMER_DELAY_MS);
    if (effectiveDelay < delay) {
      log("[Scheduler] Delay clamped to max for task:", task.id);
    }
    const timer = setTimeout(() => {
      this.handleTrigger(task.id);
    }, effectiveDelay);
    this.timers.set(task.id, timer);
  }

  private handleTrigger(taskId: string): void {
    this.timers.delete(taskId);
    const task = this.store.get(taskId);
    if (!task || !task.enabled) return;
    if (task.nextRunAt === null) return;
    if (task.nextRunAt > this.now()) {
      this.scheduleTask(task);
      return;
    }
    if (this.executingTasks.has(taskId)) {
      return;
    }
    this.executingTasks.add(taskId);
    const taskToExecute = this.prepareExecution(task);
    this.executeAndRecord(taskToExecute)
      .catch((err) => {
        const errorMessage = err instanceof Error ? err.message : String(err);
        try {
          this.store.update(taskToExecute.id, {
            lastRunAt: this.now(),
            lastRunSessionId: null,
            lastError: errorMessage,
          });
        } catch (updateError) {
          logError(
            "[ScheduledTaskManager] Failed to update store after unhandled error:",
            updateError,
          );
        }
        this.onTaskError?.(taskToExecute.id, errorMessage);
        logError(
          `[ScheduledTask] Unhandled error executing task ${taskToExecute.id}:`,
          err,
        );
      })
      .finally(() => {
        this.executingTasks.delete(taskId);
      });
  }

  private prepareExecution(task: ScheduledTask): ScheduledTask {
    this.clearTimer(task.id);

    if (!task.enabled) {
      return task;
    }

    if (isRepeatingRule(task)) {
      const nextRunAt = computeNextRunAt(task, this.now());
      if (nextRunAt !== null) {
        const updated = this.store.update(task.id, {
          nextRunAt,
          enabled: true,
        });
        if (updated) {
          this.scheduleTask(updated);
          return updated;
        }
      }
    }

    return (
      this.store.update(task.id, {
        enabled: false,
        nextRunAt: null,
      }) ?? task
    );
  }

  private computeToggleNextRunAt(task: ScheduledTask): number {
    const now = this.now();
    if (isRepeatingRule(task)) {
      const nextRunAt = computeNextRunAt(task, now);
      if (nextRunAt !== null) {
        return nextRunAt;
      }
    }
    const base = task.nextRunAt ?? task.runAt ?? now;
    return Math.max(base, now);
  }

  private async executeAndRecord(
    task: ScheduledTask,
  ): Promise<ScheduledTaskExecutionRecord> {
    try {
      const result = await this.executeTask(task);
      try {
        this.store.update(task.id, {
          lastRunAt: this.now(),
          lastRunSessionId: result.sessionId,
          lastError: null,
        });
      } catch (error) {
        logError("[ScheduledTaskManager] Failed to update store:", error);
      }
      return { success: true, sessionId: result.sessionId };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      try {
        this.store.update(task.id, {
          lastRunAt: this.now(),
          lastRunSessionId: null,
          lastError: message,
        });
      } catch (updateError) {
        logError("[ScheduledTaskManager] Failed to update store:", updateError);
      }
      this.onTaskError?.(task.id, message);
      return { success: false, error: message };
    }
  }

  private clearTimer(taskId: string): void {
    const timer = this.timers.get(taskId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(taskId);
    }
  }
}
