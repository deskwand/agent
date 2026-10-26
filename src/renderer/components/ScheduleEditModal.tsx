/**
 * @module renderer/components/ScheduleEditModal
 *
 * Modal dialog for creating or editing a scheduled task.
 * Reuses useScheduleForm hook — same state/logic as SettingsSchedule.
 */

import { useEffect, useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { X, ChevronDown, Check } from "lucide-react";
import { OccludingDialog } from "./ui/occluding-dialog";
import { DialogClose, DialogContent, DialogTitle } from "./ui/dialog";
import type { ScheduleTask } from "../types";
import { useAppStore } from "../store";
import {
  MENU_ITEM_CLASS,
  MENU_ITEM_DEFAULT_CLASS,
  MENU_ITEM_SELECTED_CLASS,
} from "./menu-styles";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { useScheduleForm } from "../hooks/useScheduleForm";
import {
  renderLocalizedBannerMessage,
  type ScheduleFormMode,
} from "./settings/shared";
import type { ScheduleWeekday } from "../types";
import { DEFAULT_WORKDIR_DIRNAME } from "../../shared/workspace-path";
import { Textarea } from "./ui/textarea";
import { Input } from "./ui/input";
import { Button } from "./app-button";

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
  /**
   * 关闭时回不到原入口（入口已被移除）的兜底：父级（ScheduleView）把自己的根容器聚焦。
   * 只在本地返回目标失效时调用，不是关闭业务回调（见 constraints.md 回焦方案）。
   */
  onRestoreFocus?: () => void;
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
  onRestoreFocus,
}: ScheduleEditModalProps) {
  const { t } = useTranslation();
  const returnFocusRef = useRef<HTMLElement | null>(null);
  /**
   * 真成功信号：`useScheduleForm` 只在 create/update/delete 成功后调 `onSaved`
   *（校验失败、服务 reject 都只写 `form.error`，不会调它）。
   * 关闭由这里驱动，而不是 `await submitTask()` 之后无条件 `onClose()` ⇒ 失败不丢输入。
   * 不新增 hook 返回值 / 外部 API / 全局状态。
   */
  const handleSaved = useCallback(() => {
    onSaved();
    onClose();
  }, [onSaved, onClose]);
  const form = useScheduleForm({ workingDir, onSaved: handleSaved });
  const { prompt, isLoading, cwd, setCwd, deleteTask, submitTask } = form;
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Working directory selector — Popover anchored to the trigger. 开关 / 外部点击关闭 /
  // Escape 三样全交给 Radix（手写的 document mousedown 监听会让面板「刚打开就被关掉」，
  // 原实现正是如此，随本次迁移删掉）。
  const [isProjectOpen, setIsProjectOpen] = useState(false);

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
      // 关闭交给 handler 的成功回调（handleSaved）；失败时保持弹窗与输入
      await submitTask();
    } catch {
      // error surfaced in form
    } finally {
      setIsSubmitting(false);
    }
  }, [submitTask]);

  const handleDelete = useCallback(async () => {
    if (!task) return;
    setIsDeleting(true);
    try {
      // 同上：只有真成功（hook 的 onSaved）才关闭
      await deleteTask(task.id);
    } catch {
      // error surfaced in form
    } finally {
      setIsDeleting(false);
    }
  }, [deleteTask, task]);

  const busy = isSubmitting || isDeleting || isLoading;
  const modeOptions: { value: ScheduleFormMode; label: string }[] = [
    { value: "once", label: t("schedule.modeOnce") },
    { value: "daily", label: t("schedule.modeDaily") },
    { value: "weekly", label: t("schedule.modeWeekly") },
  ];

  return (
    <OccludingDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        // 宽度 / 最大高 / 滚动 / 底色 / 圆角 / 阴影保持原面板的值（vendored 的
        // `grid gap-4 p-6 w-full max-w-lg` 由 cn 合并掉：`p-0 gap-0` 让内边距仍由
        // header / body / footer 自己控制）。
        className="w-[calc(100%-2rem)] max-w-lg max-h-[85vh] overflow-y-auto bg-card rounded-xl sm:rounded-xl shadow-xl border border-border p-0 gap-0 [&>button]:hidden"
        aria-describedby={undefined}
        // 矩阵：Escape 禁止关闭外层（嵌套 Popover 的 Escape 由 Popover 自己处理 ——
        // Radix 只把 Escape 交给最高层的 DismissableLayer）。
        onEscapeKeyDown={(event) => event.preventDefault()}
        onOpenAutoFocus={() => {
          const active = document.activeElement;
          returnFocusRef.current =
            active instanceof HTMLElement && active !== document.body
              ? active
              : null;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const target = returnFocusRef.current;
          if (target?.isConnected && !target.matches(":disabled")) {
            target.focus({ preventScroll: true });
            // 连接且非 disabled 仍可能不可聚焦，落焦不成功才用父级 fallback
            if (document.activeElement !== target) onRestoreFocus?.();
          } else onRestoreFocus?.();
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/60">
          <DialogTitle className="text-sm font-semibold text-foreground">
            {task
              ? t("schedule.calendarEditTitle")
              : t("schedule.calendarCreateTitle")}
          </DialogTitle>
          <DialogClose asChild>
            <Button
              variant="ghost"
              type="button"
              aria-label={t("common.close")}
              className="p-1 rounded-md hover:bg-hover-surface text-muted-foreground transition-colors h-auto"
            >
              <X size={16} />
            </Button>
          </DialogClose>
        </div>

        {/* Body */}
        {showDeleteConfirm ? (
          <>
            <div className="px-5 py-6 text-center space-y-3">
              <p className="text-sm font-medium text-foreground">
                {t("schedule.deleteConfirmTitle")}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("schedule.deleteConfirmDesc")}
              </p>
              {/* 删除失败时 `showDeleteConfirm` 仍为 true，而错误横幅原先只在表单分支
                  ⇒ 失败原因不可见。复用同一份 form.error + 语义 token。 */}
              {form.error && (
                <div
                  role="alert"
                  className="flex items-center justify-center gap-2 px-3 py-2 text-xs rounded-lg bg-destructive/10 text-destructive"
                >
                  {renderLocalizedBannerMessage(form.error, t)}
                </div>
              )}
            </div>
            {/* Footer */}
            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border/60">
              <Button
                variant="ghost"
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 text-xs font-medium rounded-lg border border-border text-muted-foreground hover:bg-hover-surface transition-colors h-auto"
              >
                {t("common.cancel")}
              </Button>
              {/* 危险动作走 destructive 变体：皮肤不再手写实心红（Task11 收敛）。 */}
              <Button
                variant="destructive"
                type="button"
                onClick={handleDelete}
                disabled={busy}
                className="px-4 py-2 text-xs font-medium rounded-lg disabled:opacity-50 transition-colors h-auto"
              >
                {t("schedule.confirmDelete")}
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="px-5 py-4 space-y-4">
              {/* Prompt */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  {t("common.prompt")}
                </label>
                <Textarea
                  className="h-24 min-h-0 w-full resize-none rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground shadow-none placeholder:text-muted-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                  placeholder={t("schedule.promptPlaceholder")}
                  value={form.prompt}
                  onChange={(e) => form.setPrompt(e.target.value)}
                />
              </div>

              {/* Working directory */}
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground shrink-0">
                  {t("schedule.project")}
                </span>
                <Popover open={isProjectOpen} onOpenChange={setIsProjectOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="ghost"
                      type="button"
                      className="inline-flex h-9 items-center max-w-[16rem] px-2 rounded-full border border-border/40 bg-background/60 text-xs text-muted-foreground transition-colors hover:border-border"
                    >
                      <span className="mr-1.5 truncate text-foreground">
                        {cwd && !cwd.endsWith(`/${DEFAULT_WORKDIR_DIRNAME}`)
                          ? cwd.split("/").pop() || cwd
                          : t("schedule.defaultWorkspace")}
                      </span>
                      <ChevronDown
                        className={`w-3 h-3 shrink-0 text-muted-foreground transition-transform ${isProjectOpen ? "rotate-180" : ""}`}
                      />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-56 p-1">
                    {[
                      { value: "", label: t("schedule.defaultWorkspace") },
                      ...projects.map((p) => ({
                        value: p,
                        label: p.split("/").pop() || p,
                      })),
                    ].map(({ value, label }) => {
                      const selected = cwd === value;
                      return (
                        <Button
                          variant="ghost"
                          key={value}
                          type="button"
                          className={`${MENU_ITEM_CLASS} ${
                            selected
                              ? MENU_ITEM_SELECTED_CLASS
                              : MENU_ITEM_DEFAULT_CLASS
                          }`}
                          onClick={() => {
                            setCwd(value);
                            setIsProjectOpen(false);
                          }}
                        >
                          <span className="truncate">{label}</span>
                          {selected && <Check className="h-4 w-4 shrink-0" />}
                        </Button>
                      );
                    })}
                  </PopoverContent>
                </Popover>
              </div>

              {/* Mode */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  {t("schedule.mode")}
                </label>
                <div className="flex gap-1 bg-muted rounded-lg p-0.5 border border-border">
                  {modeOptions.map((m) => (
                    <Button
                      variant="ghost"
                      key={m.value}
                      type="button"
                      onClick={() => form.setScheduleMode(m.value)}
                      className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
                        form.scheduleMode === m.value
                          ? "bg-card text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-muted-foreground"
                      }`}
                    >
                      {m.label}
                    </Button>
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
                  <label className="text-xs font-medium text-muted-foreground">
                    {t("schedule.executionTime")}
                  </label>
                  <Input
                    type="datetime-local"
                    className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
                    value={form.runAt}
                    onChange={(e) => form.setRunAt(e.target.value)}
                  />
                </div>
              )}

              {/* Daily: time pickers */}
              {form.scheduleMode === "daily" && (
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">
                    {t("schedule.times")}
                  </label>
                  <TimePicker
                    selected={form.selectedTimes}
                    onChange={form.setSelectedTimes}
                  />
                  <p className="text-xs text-muted-foreground">
                    {t("schedule.dailyHint")}
                  </p>
                </div>
              )}

              {/* Weekly: weekdays + time pickers */}
              {form.scheduleMode === "weekly" && (
                <>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">
                      {t("schedule.weekday")}
                    </label>
                    <div className="flex gap-1 flex-wrap">
                      {WEEKDAY_OPTIONS.map((wd) => {
                        const active = form.selectedWeekdays.includes(wd.value);
                        return (
                          <Button
                            variant="ghost"
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
                                ? "bg-primary/10 border-primary/30 text-primary-text font-medium"
                                : "border-border text-muted-foreground hover:bg-hover-surface"
                            }`}
                          >
                            {t(wd.labelKey)}
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">
                      {t("schedule.times")}
                    </label>
                    <TimePicker
                      selected={form.selectedTimes}
                      onChange={form.setSelectedTimes}
                    />
                    <p className="text-xs text-muted-foreground">
                      {t("schedule.weeklyHint")}
                    </p>
                  </div>
                </>
              )}

              {/* Status banners */}
              {form.error && (
                <div
                  role="alert"
                  className="flex items-center gap-2 px-3 py-2 text-xs rounded-lg bg-destructive/10 text-destructive"
                >
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
            <div className="flex items-center justify-between px-5 py-3 border-t border-border/60">
              <div>
                {task && (
                  <Button
                    variant="ghost"
                    type="button"
                    onClick={() => setShowDeleteConfirm(true)}
                    disabled={busy}
                    className="px-3 py-2 text-xs font-medium rounded-lg border border-destructive/30 text-destructive hover:bg-destructive/5 disabled:opacity-50 transition-colors h-auto"
                  >
                    {t("common.delete")}
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-xs font-medium rounded-lg border border-border text-muted-foreground hover:bg-hover-surface transition-colors h-auto"
                >
                  {t("common.cancel")}
                </Button>
                {/* 主操作走 default 变体：皮肤不再手写实心主色（Task11 收敛）。 */}
                <Button
                  variant="default"
                  type="button"
                  onClick={handleSubmit}
                  disabled={busy || !prompt.trim()}
                  className="px-4 py-2 text-xs font-medium rounded-lg disabled:opacity-50 transition-colors h-auto"
                >
                  {isSubmitting
                    ? t("common.saving")
                    : task
                      ? t("schedule.saveChanges")
                      : t("schedule.createTask")}
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </OccludingDialog>
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
      <label className="text-xs font-medium text-muted-foreground">
        {executionTimeLabel}
      </label>
      <Input
        type="date"
        className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
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
              className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-md bg-primary/10 text-primary-text"
            >
              {t}
              <Button
                variant="ghost"
                type="button"
                size="iconSm"
                onClick={() => remove(t)}
                className="hover:text-destructive transition-colors leading-none"
              >
                ×
              </Button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-1">
        <Input
          type="text"
          value={customInput}
          onChange={(e) => setCustomInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addCustom()}
          placeholder="HH:mm"
          maxLength={5}
          className="h-auto flex-1 rounded-md border border-border bg-muted px-2 py-1 text-xs text-foreground shadow-none placeholder:text-muted-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
        />
        <Button
          variant="ghost"
          type="button"
          onClick={addCustom}
          className="px-3 py-1 text-xs font-medium rounded-md bg-muted border border-border text-muted-foreground hover:bg-selected-surface transition-colors h-auto"
        >
          {label}
        </Button>
      </div>
      <div className="h-60 overflow-y-auto bg-muted border border-border rounded-lg">
        {TIMES_30MIN.map((time) => {
          const isSelected = selected.includes(time);
          return (
            <Button
              variant="ghost"
              key={time}
              type="button"
              onClick={() => toggle(time)}
              className={`w-full flex items-center justify-between px-3 py-1.5 text-xs transition-colors hover:bg-hover-surface ${isSelected ? "text-primary-text bg-primary/5" : "text-muted-foreground"}`}
            >
              <span>{time}</span>
              {isSelected && (
                <span className="text-primary-text font-bold">✓</span>
              )}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
