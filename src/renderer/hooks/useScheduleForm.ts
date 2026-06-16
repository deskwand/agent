/**
 * @module renderer/hooks/useScheduleForm
 *
 * Encapsulates all schedule-task form state, derived values, validation,
 * and async submit/edit/clear actions.  Consumers (SettingsSchedule,
 * ScheduleEditModal) only render UI — no form logic leaks.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { DEFAULT_WORKDIR_DIRNAME } from "../../shared/workspace-path";
import type {
  ScheduleConfig,
  ScheduleTask,
  ScheduleRepeatUnit,
  ScheduleWeekday,
  ScheduleCreateInput,
  ScheduleUpdateInput,
} from "../types";
import { joinAppList } from "../utils/i18n-format";
import type {
  LocalizedBanner,
  ScheduleFormMode,
} from "../components/settings/shared";

// ---------------------------------------------------------------------------
// Public hook
// ---------------------------------------------------------------------------

export interface UseScheduleFormOptions {
  /** Current working directory (default cwd for new tasks). */
  workingDir: string;
  /** Called after a successful create or update so the caller can refresh lists. */
  onSaved?: () => void;
}

export interface UseScheduleFormReturn {
  // ------ Form state ------
  editingId: string | null;
  prompt: string;
  setPrompt: (v: string) => void;
  cwd: string;
  setCwd: (v: string) => void;
  runAt: string;
  setRunAt: (v: string) => void;
  scheduleMode: ScheduleFormMode;
  setScheduleMode: (v: ScheduleFormMode) => void;
  selectedTimes: string[];
  setSelectedTimes: (v: string[] | ((prev: string[]) => string[])) => void;
  selectedWeekdays: ScheduleWeekday[];
  setSelectedWeekdays: (
    v: ScheduleWeekday[] | ((prev: ScheduleWeekday[]) => ScheduleWeekday[]),
  ) => void;
  enabled: boolean;
  setEnabled: (v: boolean) => void;
  repeatEvery: number;
  setRepeatEvery: (v: number) => void;
  repeatUnit: ScheduleRepeatUnit;
  setRepeatUnit: (v: ScheduleRepeatUnit) => void;

  // ------ Derived values ------
  scheduleConfig: ScheduleConfig | null;
  schedulePreview: string;
  previewTitle: string;
  selectedWeekdayLabels: string;
  selectedTimeLabels: string;
  promptChangedWhileEditing: boolean;

  // ------ Status ------
  isLoading: boolean;
  setIsLoading: (v: boolean) => void;
  error: LocalizedBanner | null;
  setError: (v: LocalizedBanner | null) => void;
  success: LocalizedBanner | null;
  setSuccess: (v: LocalizedBanner | null) => void;

  // ------ Actions ------
  editTask: (task: ScheduleTask) => void;
  clearForm: () => void;
  submitTask: () => Promise<void>;
  deleteTask: (taskId: string) => Promise<void>;
}

export function useScheduleForm({
  workingDir,
  onSaved,
}: UseScheduleFormOptions): UseScheduleFormReturn {
  const { t } = useTranslation();

  // ---- state ----
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTaskSnapshot, setEditingTaskSnapshot] =
    useState<ScheduleTask | null>(null);
  const [prompt, setPrompt] = useState("");
  const [cwd, setCwd] = useState("");
  const [runAt, setRunAt] = useState("");
  const [scheduleMode, setScheduleMode] = useState<ScheduleFormMode>("once");
  const [selectedTimes, setSelectedTimes] = useState<string[]>(["08:00"]);
  const [selectedWeekdays, setSelectedWeekdays] = useState<ScheduleWeekday[]>([
    1,
  ]);
  const [enabled, setEnabled] = useState(true);
  const [repeatEvery, setRepeatEvery] = useState(1);
  const [repeatUnit, setRepeatUnit] = useState<ScheduleRepeatUnit>("day");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<LocalizedBanner | null>(null);
  const [success, setSuccess] = useState<LocalizedBanner | null>(null);

  // Sync workingDir when it changes and form has no explicit cwd
  const workingDirRef = useRef(workingDir);
  workingDirRef.current = workingDir;

  useEffect(() => {
    if (!cwd) {
      const dir = workingDir || "";
      setCwd(dir && !dir.endsWith(`/${DEFAULT_WORKDIR_DIRNAME}`) ? dir : "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workingDir]);

  // Default runAt = now + 5 min (set once on mount)
  useEffect(() => {
    const defaultRunAt = Date.now() + 5 * 60 * 1000;
    setRunAt(toLocalDateTimeInput(defaultRunAt));
  }, []);

  // ---- derived ----
  const scheduleConfig = buildScheduleConfigFromForm(
    scheduleMode,
    selectedTimes,
    selectedWeekdays,
  );
  const schedulePreview = buildSchedulePreview(
    scheduleMode,
    runAt,
    scheduleConfig,
    t,
  );
  const promptChangedWhileEditing = Boolean(
    editingTaskSnapshot && prompt.trim() !== editingTaskSnapshot.prompt.trim(),
  );

  const weekdayOptions = getScheduleWeekdayOptions(t);
  const selectedWeekdayLabels = joinAppList(
    selectedWeekdays
      .map(
        (weekday) =>
          weekdayOptions.find((option) => option.value === weekday)?.label ??
          t("schedule.unknownWeekday"),
      )
      .filter(Boolean),
  );
  const selectedTimeLabels = joinAppList(selectedTimes);

  const previewTitle = editingId
    ? promptChangedWhileEditing
      ? t("schedule.autoTitleEditingChanged")
      : editingTaskSnapshot?.title || t("schedule.autoTitleEditingUnchanged")
    : t("schedule.autoTitleCreating");

  // ---- actions ----
  const editTask = useCallback((task: ScheduleTask) => {
    setEditingId(task.id);
    setEditingTaskSnapshot(task);
    setPrompt(task.prompt);
    setCwd(
      task.cwd && !task.cwd.endsWith(`/${DEFAULT_WORKDIR_DIRNAME}`)
        ? task.cwd
        : "",
    );
    setRunAt(toLocalDateTimeInput(task.nextRunAt ?? task.runAt));
    setEnabled(task.enabled);
    setScheduleMode(detectScheduleMode(task));
    setSelectedTimes(task.scheduleConfig?.times ?? ["08:00"]);
    setSelectedWeekdays(
      task.scheduleConfig?.kind === "weekly"
        ? task.scheduleConfig.weekdays
        : [1],
    );
    setRepeatEvery(task.repeatEvery ?? 1);
    setRepeatUnit(task.repeatUnit ?? "day");
    setError(null);
    setSuccess(null);
  }, []);

  const clearForm = useCallback(() => {
    const defaultRunAt = Date.now() + 5 * 60 * 1000;
    setEditingId(null);
    setEditingTaskSnapshot(null);
    setPrompt("");
    setCwd(workingDirRef.current || "");
    setRunAt(toLocalDateTimeInput(defaultRunAt));
    setScheduleMode("once");
    setSelectedTimes(["08:00"]);
    setSelectedWeekdays([1]);
    setEnabled(true);
    setRepeatEvery(1);
    setRepeatUnit("day");
  }, []);

  const submitTask = useCallback(async () => {
    if (typeof window === "undefined" || !window.electronAPI) return;

    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      setError({ key: "schedule.promptRequired" });
      return;
    }
    if (
      scheduleMode === "daily" &&
      (!scheduleConfig || scheduleConfig.times.length === 0)
    ) {
      setError({ key: "schedule.dailyTimesRequired" });
      return;
    }
    if (scheduleMode === "weekly") {
      if (
        !scheduleConfig ||
        scheduleConfig.kind !== "weekly" ||
        scheduleConfig.times.length === 0
      ) {
        setError({ key: "schedule.weeklyTimesRequired" });
        return;
      }
      if (scheduleConfig.weekdays.length === 0) {
        setError({ key: "schedule.weekdayRequired" });
        return;
      }
    }

    const usesDateTimeInput =
      scheduleMode === "once" || scheduleMode === "legacy-interval";
    const runAtValue: number | null = usesDateTimeInput
      ? new Date(runAt).getTime()
      : computeNextScheduledRun(scheduleConfig, Date.now());

    if (runAtValue === null || !Number.isFinite(runAtValue)) {
      setError({
        key: usesDateTimeInput
          ? "schedule.invalidTime"
          : "schedule.nextRunCalculationFailed",
      });
      return;
    }

    setIsLoading(true);
    setError(null);
    setSuccess(null);

    try {
      if (editingId) {
        const originalRunAtInput = editingTaskSnapshot
          ? toLocalDateTimeInput(
              editingTaskSnapshot.nextRunAt ?? editingTaskSnapshot.runAt,
            )
          : null;
        const nextScheduleSignature = buildScheduleSignatureFromForm(
          scheduleMode,
          runAt,
          selectedTimes,
          selectedWeekdays,
          repeatEvery,
          repeatUnit,
        );
        const originalScheduleSignature = editingTaskSnapshot
          ? buildScheduleSignatureFromTask(editingTaskSnapshot)
          : null;
        const shouldRegenerateTitle =
          !editingTaskSnapshot ||
          trimmedPrompt !== editingTaskSnapshot.prompt.trim();
        const shouldResetScheduleTime =
          !editingTaskSnapshot ||
          nextScheduleSignature !== originalScheduleSignature ||
          runAt !== originalRunAtInput ||
          (enabled && editingTaskSnapshot.nextRunAt === null);

        if (shouldResetScheduleTime && runAtValue <= Date.now()) {
          setError({ key: "schedule.futureTimeRequired" });
          setIsLoading(false);
          return;
        }

        const payload: ScheduleUpdateInput = {
          cwd: cwd.trim() || workingDirRef.current || "",
          enabled,
          scheduleConfig,
          repeatEvery: scheduleMode === "legacy-interval" ? repeatEvery : null,
          repeatUnit: scheduleMode === "legacy-interval" ? repeatUnit : null,
        };
        if (shouldRegenerateTitle) {
          payload.prompt = trimmedPrompt;
        }
        if (shouldResetScheduleTime) {
          payload.runAt = runAtValue;
          payload.nextRunAt = runAtValue;
        }

        const updated = await window.electronAPI.schedule.update(
          editingId,
          payload,
        );
        if (!updated) {
          throw new Error(t("schedule.taskMissing"));
        }
        setSuccess({ key: "schedule.updated" });
      } else {
        if (runAtValue <= Date.now()) {
          setError({ key: "schedule.futureTimeRequired" });
          setIsLoading(false);
          return;
        }

        const payload: ScheduleCreateInput = {
          prompt: trimmedPrompt,
          cwd: cwd.trim() || workingDirRef.current || "",
          runAt: runAtValue,
          nextRunAt: runAtValue,
          scheduleConfig,
          enabled,
          repeatEvery: scheduleMode === "legacy-interval" ? repeatEvery : null,
          repeatUnit: scheduleMode === "legacy-interval" ? repeatUnit : null,
        };
        await window.electronAPI.schedule.create(payload);
        setSuccess({ key: "schedule.created" });
      }
      clearForm();
      onSaved?.();
    } catch (err) {
      setError(
        err instanceof Error
          ? { text: err.message }
          : { key: "schedule.saveFailed" },
      );
    } finally {
      setIsLoading(false);
    }
  }, [
    prompt,
    cwd,
    runAt,
    scheduleMode,
    selectedTimes,
    selectedWeekdays,
    enabled,
    repeatEvery,
    repeatUnit,
    scheduleConfig,
    editingId,
    editingTaskSnapshot,
    t,
    clearForm,
    onSaved,
  ]);

  const deleteTask = useCallback(
    async (taskId: string) => {
      if (typeof window === "undefined" || !window.electronAPI) return;
      setIsLoading(true);
      setError(null);
      try {
        await window.electronAPI.schedule.delete(taskId);
        clearForm();
        onSaved?.();
      } catch (err) {
        setError(
          err instanceof Error
            ? { text: err.message }
            : { key: "schedule.saveFailed" },
        );
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [clearForm, onSaved],
  );

  return {
    // state
    editingId,
    prompt,
    setPrompt,
    cwd,
    setCwd,
    runAt,
    setRunAt,
    scheduleMode,
    setScheduleMode,
    selectedTimes,
    setSelectedTimes,
    selectedWeekdays,
    setSelectedWeekdays,
    enabled,
    setEnabled,
    repeatEvery,
    setRepeatEvery,
    repeatUnit,
    setRepeatUnit,
    // derived
    scheduleConfig,
    schedulePreview,
    previewTitle,
    selectedWeekdayLabels,
    selectedTimeLabels,
    promptChangedWhileEditing,
    // status
    isLoading,
    setIsLoading,
    error,
    setError,
    success,
    setSuccess,
    // actions
    editTask,
    clearForm,
    submitTask,
    deleteTask,
  };
}

// ---------------------------------------------------------------------------
// Pure helpers (exported so consumers don't need to redefine them)
// ---------------------------------------------------------------------------

export function toLocalDateTimeInput(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hour = pad(date.getHours());
  const minute = pad(date.getMinutes());
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

export function detectScheduleMode(task: ScheduleTask): ScheduleFormMode {
  if (task.scheduleConfig?.kind === "daily") return "daily";
  if (task.scheduleConfig?.kind === "weekly") return "weekly";
  if (task.repeatEvery && task.repeatUnit) return "legacy-interval";
  return "once";
}

export function buildScheduleConfigFromForm(
  mode: ScheduleFormMode,
  times: string[],
  weekdays: ScheduleWeekday[],
): ScheduleConfig | null {
  const normalizedTimes = Array.from(new Set(times)).sort();
  if (mode === "daily" && normalizedTimes.length > 0) {
    return { kind: "daily", times: normalizedTimes };
  }
  if (mode === "weekly" && normalizedTimes.length > 0 && weekdays.length > 0) {
    return {
      kind: "weekly",
      weekdays: Array.from(new Set(weekdays)).sort((a, b) => a - b),
      times: normalizedTimes,
    };
  }
  return null;
}

export function computeNextScheduledRun(
  scheduleConfig: ScheduleConfig | null,
  now: number,
): number | null {
  if (!scheduleConfig || scheduleConfig.times.length === 0) return null;

  const allowedWeekdays =
    scheduleConfig.kind === "weekly" ? new Set(scheduleConfig.weekdays) : null;
  const nowDate = new Date(now);

  for (let dayOffset = 0; dayOffset <= 14; dayOffset += 1) {
    const candidateDate = new Date(
      nowDate.getFullYear(),
      nowDate.getMonth(),
      nowDate.getDate() + dayOffset,
      0,
      0,
      0,
      0,
    );
    if (
      allowedWeekdays &&
      !allowedWeekdays.has(candidateDate.getDay() as ScheduleWeekday)
    ) {
      continue;
    }
    for (const time of scheduleConfig.times) {
      const [hour, minute] = time.split(":").map(Number);
      const candidate = new Date(
        candidateDate.getFullYear(),
        candidateDate.getMonth(),
        candidateDate.getDate(),
        hour,
        minute,
        0,
        0,
      ).getTime();
      if (candidate > now) return candidate;
    }
  }
  return null;
}

export function toggleTimeValue(current: string[], target: string): string[] {
  if (!isValidTimeValue(target)) return current;
  const next = current.includes(target)
    ? current.filter((v) => v !== target)
    : [...current, target];
  return next.sort();
}

export function toggleWeekdayValue(
  current: ScheduleWeekday[],
  target: ScheduleWeekday,
): ScheduleWeekday[] {
  const next = current.includes(target)
    ? current.filter((v) => v !== target)
    : [...current, target];
  return next.sort((a, b) => a - b);
}

export function isValidTimeValue(value: string): boolean {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);
}

// ---- Internal helpers (not exported) ----

function getScheduleWeekdayOptions(
  t: TFunction,
): Array<{ value: ScheduleWeekday; label: string }> {
  return [
    { value: 1, label: t("schedule.weekdayMonday") },
    { value: 2, label: t("schedule.weekdayTuesday") },
    { value: 3, label: t("schedule.weekdayWednesday") },
    { value: 4, label: t("schedule.weekdayThursday") },
    { value: 5, label: t("schedule.weekdayFriday") },
    { value: 6, label: t("schedule.weekdaySaturday") },
    { value: 0, label: t("schedule.weekdaySunday") },
  ];
}

function buildSchedulePreview(
  mode: ScheduleFormMode,
  runAt: string,
  scheduleConfig: ScheduleConfig | null,
  t: TFunction,
): string {
  if (mode === "once" || mode === "legacy-interval") {
    const timestamp = new Date(runAt).getTime();
    return Number.isFinite(timestamp)
      ? t("schedule.previewNextRun", { value: formatAppDateTime(timestamp) })
      : t("schedule.previewSelectValidTime");
  }
  const nextRunAt = computeNextScheduledRun(scheduleConfig, Date.now());
  return nextRunAt === null
    ? t("schedule.previewSelectAtLeastOne")
    : t("schedule.previewAutoFind", { value: formatAppDateTime(nextRunAt) });
}

// Mirrors SettingsSchedule.buildScheduleSignatureFromForm
function buildScheduleSignatureFromForm(
  mode: ScheduleFormMode,
  runAt: string,
  times: string[],
  weekdays: ScheduleWeekday[],
  repeatEvery: number,
  repeatUnit: ScheduleRepeatUnit,
): string {
  if (mode === "daily" || mode === "weekly") {
    return JSON.stringify(buildScheduleConfigFromForm(mode, times, weekdays));
  }
  if (mode === "legacy-interval") {
    return JSON.stringify({ mode, runAt, repeatEvery, repeatUnit });
  }
  return JSON.stringify({ mode, runAt });
}

// Mirrors SettingsSchedule.buildScheduleSignatureFromTask
function buildScheduleSignatureFromTask(task: ScheduleTask): string {
  if (task.scheduleConfig) {
    return JSON.stringify(task.scheduleConfig);
  }
  if (task.repeatEvery && task.repeatUnit) {
    return JSON.stringify({
      mode: "legacy-interval",
      runAt: toLocalDateTimeInput(task.nextRunAt ?? task.runAt),
      repeatEvery: task.repeatEvery,
      repeatUnit: task.repeatUnit,
    });
  }
  return JSON.stringify({
    mode: "once",
    runAt: toLocalDateTimeInput(task.nextRunAt ?? task.runAt),
  });
}

function formatAppDateTime(timestamp: number): string {
  // Reuse the existing i18n-aware formatter from utils
  // We inline a simple version to avoid circular deps
  const d = new Date(timestamp);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hour = String(d.getHours()).padStart(2, "0");
  const minute = String(d.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}`;
}
