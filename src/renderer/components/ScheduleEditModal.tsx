/**
 * @module renderer/components/ScheduleEditModal
 *
 * Modal dialog for creating or editing a scheduled task.
 * Reuses useScheduleForm hook — same state/logic as SettingsSchedule.
 */

import { useEffect, useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { X, ChevronDown } from "lucide-react";
import type { ScheduleTask } from "../types";
import { useAppStore } from "../store";
import { useScheduleForm } from "../hooks/useScheduleForm";
import {
  renderLocalizedBannerMessage,
  type ScheduleFormMode,
} from "./settings/shared";
import type { ScheduleWeekday } from "../types";
import { DEFAULT_WORKDIR_DIRNAME } from "../../shared/workspace-path";

export interface ScheduleEditModalProps {
  /** Task to edit, or null for create mode. */
  task: ScheduleTask | null;
  /** Current working directory for new tasks. */
  workingDir: string;
  /** Pre-filled date/time for create mode (from calendar slot click). */
  prefillDate?: Date;
  /** Pre-filled time string "HH:mm" for create mode. */
  prefillTime?: string;
  onClose: () => void;
  onSaved: () => void;
}

const WEEKDAY_OPTIONS: { value: ScheduleWeekday; labelKey: string }[] = [
  { value: 1, labelKey: "schedule.weekdayMonday" },
  { value: 2, labelKey: "schedule.weekdayTuesday" },
  { value: 3, labelKey: "schedule.weekdayWednesday" },
  { value: 4, labelKey: "schedule.weekdayThursday" },
  { value: 5, labelKey: "schedule.weekdayFriday" },
  { value: 6, labelKey: "schedule.weekdaySaturday" },
  { value: 0, labelKey: "schedule.weekdaySunday" },
];

export function ScheduleEditModal({
  task,
  workingDir,
  prefillDate,
  prefillTime,
  onClose,
  onSaved,
}: ScheduleEditModalProps) {
  const { t } = useTranslation();
  const form = useScheduleForm({ workingDir, onSaved });
  const { prompt, isLoading, cwd, setCwd, deleteTask, submitTask } = form;
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Project selector — custom dropdown (matching ChatInputBottomBar model selector style)
  const [isProjectOpen, setIsProjectOpen] = useState(false);
  const projectMenuRef = useRef<HTMLDivElement>(null);

  const sessions = useAppStore((s) => s.sessions);

  const projects = useMemo(() => {
    const seen = new Set<string>();
    const cwds: string[] = [];
    for (const s of sessions) {
      const c = (s.cwd || "").trim().replace(/\/+$/, "");
      if (
        !c ||
        c.toLowerCase() === "default" ||
        c.endsWith(DEFAULT_WORKDIR_DIRNAME) ||
        seen.has(c)
      )
        continue;
      seen.add(c);
      cwds.push(c);
    }
    return cwds.sort();
  }, [sessions]);

  // Click-outside to close project dropdown
  useEffect(() => {
    if (!isProjectOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        projectMenuRef.current &&
        !projectMenuRef.current.contains(e.target as Node)
      ) {
        setIsProjectOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isProjectOpen]);

  // Initialise form on mount / when task changes
  useEffect(() => {
    if (task) {
      form.editTask(task);
    } else {
      form.clearForm();
      if (prefillDate) {
        const year = prefillDate.getFullYear();
        const month = String(prefillDate.getMonth() + 1).padStart(2, "0");
        const day = String(prefillDate.getDate()).padStart(2, "0");
        const time = prefillTime || "09:00";
        form.setRunAt(`${year}-${month}-${day}T${time}`);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id]);

  const handleSubmit = useCallback(async () => {
    setIsSubmitting(true);
    try {
      await submitTask();
      onClose();
    } catch {
      // error surfaced in form
    } finally {
      setIsSubmitting(false);
    }
  }, [submitTask, onClose]);

  const handleDelete = useCallback(async () => {
    if (!task) return;
    setIsDeleting(true);
    try {
      await deleteTask(task.id);
      onClose();
    } catch {
      // error surfaced in form
    } finally {
      setIsDeleting(false);
    }
  }, [deleteTask, task, onClose]);

  const busy = isSubmitting || isDeleting || isLoading;
  const modeOptions: { value: ScheduleFormMode; label: string }[] = [
    { value: "once", label: t("schedule.modeOnce") },
    { value: "daily", label: t("schedule.modeDaily") },
    { value: "weekly", label: t("schedule.modeWeekly") },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30 animate-fade-in" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-lg max-h-[85vh] overflow-y-auto bg-surface rounded-xl shadow-xl border border-border mx-4 animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-muted">
          <h3 className="text-sm font-semibold text-text-primary">
            {task
              ? t("schedule.calendarEditTitle")
              : t("schedule.calendarCreateTitle")}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md hover:bg-surface-hover text-text-muted transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        {showDeleteConfirm ? (
          <>
            <div className="px-5 py-6 text-center space-y-3">
              <p className="text-sm font-medium text-text-primary">
                {t("schedule.deleteConfirmTitle")}
              </p>
              <p className="text-xs text-text-muted">
                {t("schedule.deleteConfirmDesc")}
              </p>
            </div>
            {/* Footer */}
            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border-muted">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 text-xs font-medium rounded-lg border border-border text-text-secondary hover:bg-surface-hover transition-colors"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={busy}
                className="px-4 py-2 text-xs font-medium rounded-lg bg-error text-white hover:bg-error/90 disabled:opacity-50 transition-colors"
              >
                {t("schedule.confirmDelete")}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="px-5 py-4 space-y-4">
              {/* Prompt */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-text-secondary">
                  {t("common.prompt")}
                </label>
                <textarea
                  className="w-full h-24 px-3 py-2 text-sm bg-surface-muted border border-border rounded-lg resize-none focus:outline-none focus:ring-1 focus:ring-accent text-text-primary placeholder:text-text-muted"
                  placeholder={t("schedule.promptPlaceholder")}
                  value={form.prompt}
                  onChange={(e) => form.setPrompt(e.target.value)}
                />
              </div>

              {/* Working directory */}
              <div className="flex items-center gap-1.5" ref={projectMenuRef}>
                <span className="text-xs text-text-muted shrink-0">
                  {t("schedule.project")}
                </span>
                <div className="relative">
                  <button
                    type="button"
                    className="inline-flex h-9 items-center max-w-[16rem] px-2 rounded-full border border-border-subtle bg-background/60 text-xs text-text-muted transition-colors hover:border-border"
                    onClick={() => setIsProjectOpen((v) => !v)}
                  >
                    <span className="mr-1.5 truncate text-text-primary">
                      {cwd &&
                      !cwd.endsWith(`/${DEFAULT_WORKDIR_DIRNAME}`)
                        ? cwd.split("/").pop() || cwd
                        : t("schedule.defaultWorkspace")}
                    </span>
                    <ChevronDown
                      className={`w-3 h-3 shrink-0 text-text-muted transition-transform ${isProjectOpen ? "rotate-180" : ""}`}
                    />
                  </button>
                  {isProjectOpen && (
                    <div className="absolute left-0 z-[200] mt-1 w-56 rounded-xl border border-border bg-background shadow-soft p-1">
                      {[
                        { value: "", label: t("schedule.defaultWorkspace") },
                        ...projects.map((p) => ({
                          value: p,
                          label: p.split("/").pop() || p,
                        })),
                      ].map(({ value, label }) => {
                        const selected = cwd === value;
                        return (
                          <button
                            key={value}
                            type="button"
                            className={`w-full truncate rounded-lg px-2.5 py-1.5 text-left text-xs ${selected ? "bg-accent text-background" : "text-text-primary hover:bg-surface-hover"}`}
                            onClick={() => {
                              setCwd(value);
                              setIsProjectOpen(false);
                            }}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Mode */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-text-secondary">
                  {t("schedule.mode")}
                </label>
                <div className="flex gap-1 bg-surface-muted rounded-lg p-0.5 border border-border">
                  {modeOptions.map((m) => (
                    <button
                      key={m.value}
                      type="button"
                      onClick={() => form.setScheduleMode(m.value)}
                      className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
                        form.scheduleMode === m.value
                          ? "bg-surface text-text-primary shadow-sm"
                          : "text-text-muted hover:text-text-secondary"
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Once: date picker + time picker (single-select, consistent with Daily) */}
              {form.scheduleMode === "once" && (
                <OnceDateTimePicker
                  runAt={form.runAt}
                  setRunAt={form.setRunAt}
                  executionTimeLabel={t("schedule.executionTime")}
                  t={t}
                />
              )}

              {/* Legacy-interval: keep original datetime-local */}
              {form.scheduleMode === "legacy-interval" && (
                <div className="space-y-1">
                  <label className="text-xs font-medium text-text-secondary">
                    {t("schedule.executionTime")}
                  </label>
                  <input
                    type="datetime-local"
                    className="w-full px-3 py-2 text-sm bg-surface-muted border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-accent text-text-primary"
                    value={form.runAt}
                    onChange={(e) => form.setRunAt(e.target.value)}
                  />
                </div>
              )}

              {/* Daily: time pickers */}
              {form.scheduleMode === "daily" && (
                <div className="space-y-1">
                  <label className="text-xs font-medium text-text-secondary">
                    {t("schedule.times")}
                  </label>
                  <TimePicker
                    selected={form.selectedTimes}
                    onChange={form.setSelectedTimes}
                  />
                  <p className="text-xs text-text-muted">
                    {t("schedule.dailyHint")}
                  </p>
                </div>
              )}

              {/* Weekly: weekdays + time pickers */}
              {form.scheduleMode === "weekly" && (
                <>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-text-secondary">
                      {t("schedule.weekday")}
                    </label>
                    <div className="flex gap-1 flex-wrap">
                      {WEEKDAY_OPTIONS.map((wd) => {
                        const active = form.selectedWeekdays.includes(wd.value);
                        return (
                          <button
                            key={wd.value}
                            type="button"
                            onClick={() => {
                              const next = form.selectedWeekdays.includes(
                                wd.value,
                              )
                                ? form.selectedWeekdays.filter(
                                    (v) => v !== wd.value,
                                  )
                                : [...form.selectedWeekdays, wd.value].sort(
                                    (a, b) => a - b,
                                  );
                              form.setSelectedWeekdays(next);
                            }}
                            className={`px-2 py-1 text-xs rounded-md border transition-colors ${
                              active
                                ? "bg-accent/10 border-accent/30 text-accent font-medium"
                                : "border-border text-text-muted hover:bg-surface-hover"
                            }`}
                          >
                            {t(wd.labelKey)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-text-secondary">
                      {t("schedule.times")}
                    </label>
                    <TimePicker
                      selected={form.selectedTimes}
                      onChange={form.setSelectedTimes}
                    />
                    <p className="text-xs text-text-muted">
                      {t("schedule.weeklyHint")}
                    </p>
                  </div>
                </>
              )}

              {/* Status banners */}
              {form.error && (
                <div className="flex items-center gap-2 px-3 py-2 text-xs rounded-lg bg-error/10 text-error">
                  {renderLocalizedBannerMessage(form.error, t)}
                </div>
              )}
              {form.success && (
                <div className="flex items-center gap-2 px-3 py-2 text-xs rounded-lg bg-success/10 text-success">
                  {renderLocalizedBannerMessage(form.success, t)}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-5 py-3 border-t border-border-muted">
              <div>
                {task && (
                  <button
                    type="button"
                    onClick={() => setShowDeleteConfirm(true)}
                    disabled={busy}
                    className="px-3 py-2 text-xs font-medium rounded-lg border border-error/30 text-error hover:bg-error/5 disabled:opacity-50 transition-colors"
                  >
                    {t("common.delete")}
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-xs font-medium rounded-lg border border-border text-text-secondary hover:bg-surface-hover transition-colors"
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={busy || !prompt.trim()}
                  className="px-4 py-2 text-xs font-medium rounded-lg bg-accent text-accent-foreground hover:bg-accent/90 disabled:opacity-50 transition-colors"
                >
                  {isSubmitting
                    ? t("common.saving")
                    : task
                      ? t("schedule.saveChanges")
                      : t("schedule.createTask")}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// OnceDateTimePicker — date input + single-select TimePicker for Once mode
// ---------------------------------------------------------------------------

function OnceDateTimePicker({
  runAt,
  setRunAt,
  executionTimeLabel,
  t,
}: {
  runAt: string;
  setRunAt: (v: string) => void;
  executionTimeLabel: string;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  const date = useMemo(() => runAt.split("T")[0] || "", [runAt]);
  const time = useMemo(() => runAt.split("T")[1] || "08:00", [runAt]);

  return (
    <div className="space-y-2">
      <label className="text-xs font-medium text-text-secondary">
        {executionTimeLabel}
      </label>
      <input
        type="date"
        className="w-full px-3 py-2 text-sm bg-surface-muted border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-accent text-text-primary"
        value={date}
        onChange={(e) => {
          if (e.target.value) {
            setRunAt(`${e.target.value}T${time}`);
          }
        }}
      />
      <TimePicker
        single
        selected={time ? [time] : []}
        onChange={(times) => {
          // In single mode, onChange always receives string[] (never a setter function)
          const nextTime = Array.isArray(times) ? times[0] : null;
          setRunAt(`${date}T${nextTime || time || "08:00"}`);
        }}
        addTimeLabel={t("schedule.addTime")}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// TimePicker — single-column scrollable list, Feishu Calendar style
// ---------------------------------------------------------------------------

const TIMES_30MIN: string[] = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2);
  const m = i % 2 === 0 ? "00" : "30";
  return `${String(h).padStart(2, "0")}:${m}`;
});

function TimePicker({
  selected,
  onChange,
  single = false,
  addTimeLabel,
}: {
  selected: string[];
  onChange: (v: string[] | ((prev: string[]) => string[])) => void;
  single?: boolean;
  addTimeLabel?: string;
}) {
  const { t } = useTranslation();
  const [customInput, setCustomInput] = useState("");

  const remove = (time: string) => {
    onChange((prev) => prev.filter((t) => t !== time));
  };

  const toggle = (time: string) => {
    if (single) {
      onChange([time]);
    } else {
      onChange((prev) => {
        const next = prev.includes(time)
          ? prev.filter((t) => t !== time)
          : [...prev, time];
        return next.sort();
      });
    }
  };

  const addCustom = () => {
    const raw = customInput.trim();
    if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(raw)) return;
    if (single) {
      onChange([raw]);
      setCustomInput("");
      return;
    }
    onChange((prev) => {
      if (prev.includes(raw)) return prev;
      return [...prev, raw].sort();
    });
    setCustomInput("");
  };

  const label = addTimeLabel ?? t("schedule.addTime");

  return (
    <div className="space-y-2">
      {/* Chips row — selected times feedback */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selected.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-md bg-accent/10 text-accent"
            >
              {t}
              <button
                type="button"
                onClick={() => remove(t)}
                className="hover:text-error transition-colors leading-none"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-1">
        <input
          type="text"
          value={customInput}
          onChange={(e) => setCustomInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addCustom()}
          placeholder="HH:mm"
          maxLength={5}
          className="flex-1 px-2 py-1 text-xs bg-surface-muted border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-accent text-text-primary placeholder:text-text-muted"
        />
        <button
          type="button"
          onClick={addCustom}
          className="px-3 py-1 text-xs font-medium rounded-md bg-surface-muted border border-border text-text-secondary hover:bg-surface-hover transition-colors"
        >
          {label}
        </button>
      </div>
      <div className="h-60 overflow-y-auto bg-surface-muted border border-border rounded-lg">
        {TIMES_30MIN.map((time) => {
          const isSelected = selected.includes(time);
          return (
            <button
              key={time}
              type="button"
              onClick={() => toggle(time)}
              className={`w-full flex items-center justify-between px-3 py-1.5 text-xs transition-colors hover:bg-surface-hover ${isSelected ? "text-accent bg-accent/5" : "text-text-secondary"}`}
            >
              <span>{time}</span>
              {isSelected && <span className="text-accent font-bold">✓</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
