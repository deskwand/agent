/**
 * @module renderer/components/ScheduleView
 *
 * Calendar-first schedule view with toolbar, day/week/month views,
 * and a modal for create/edit. Falls back gracefully when electronAPI is absent.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../store";
import type { ScheduleTask } from "../types";
import { ScheduleToolbar } from "./ScheduleToolbar";
import { ScheduleCalendar, type CalendarView } from "./ScheduleCalendar";
import { ScheduleEditModal } from "./ScheduleEditModal";
import { Button } from "./app-button";
import { PAGE_INSET_X } from "./page-styles";

export function ScheduleView() {
  const { t } = useTranslation();
  const setShowSchedule = useAppStore((s) => s.setShowSchedule);
  const workingDir = useAppStore((s) => s.workingDir) || "";
  const rootRef = useRef<HTMLDivElement>(null);

  // ------- View state -------
  const [view, setView] = useState<CalendarView>("week");
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [tasks, setTasks] = useState<ScheduleTask[]>([]);

  // ------- Modal state -------
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<ScheduleTask | null>(null);
  const [prefillDate, setPrefillDate] = useState<Date | undefined>();
  const [prefillTime, setPrefillTime] = useState<string | undefined>();

  // ------- Data loading -------
  const loadTasks = useCallback(async () => {
    if (typeof window === "undefined" || !window.electronAPI) return;
    try {
      const list = await window.electronAPI.schedule.list();
      setTasks(list);
    } catch {
      // silently ignore — electronAPI.schedule handles logging
    }
  }, []);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  // ------- Navigation -------
  const navigate = useCallback(
    (delta: number) => {
      setCurrentDate((prev) => {
        const d = new Date(prev);
        if (view === "day") d.setDate(d.getDate() + delta);
        else if (view === "week") d.setDate(d.getDate() + delta * 7);
        else d.setMonth(d.getMonth() + delta);
        return d;
      });
    },
    [view],
  );

  const goToday = useCallback(() => setCurrentDate(new Date()), []);

  // ------- Calendar event handlers -------
  const handleSlotClick = useCallback((date: Date, time?: string) => {
    setEditingTask(null);
    setPrefillDate(date);
    setPrefillTime(time);
    setModalOpen(true);
  }, []);

  const handleTaskClick = useCallback(
    (taskId: string) => {
      const task = tasks.find((t) => t.id === taskId);
      if (task) {
        setEditingTask(task);
        setPrefillDate(undefined);
        setPrefillTime(undefined);
        setModalOpen(true);
      }
    },
    [tasks],
  );

  const handleSaved = useCallback(() => {
    loadTasks();
  }, [loadTasks]);

  const handleCloseModal = useCallback(() => {
    setModalOpen(false);
    setEditingTask(null);
    setPrefillDate(undefined);
    setPrefillTime(undefined);
  }, []);

  const handleCreateClick = useCallback(() => {
    setEditingTask(null);
    setPrefillDate(undefined);
    setPrefillTime(undefined);
    setModalOpen(true);
  }, []);

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      className="flex-1 min-h-0 flex flex-col overflow-hidden bg-background"
    >
      {/* 页面级内边距只在**这一处**给出：页头文字、工具栏底色带、日历网格共用同一个盒，
          所以带子不会比下方网格宽出 20px（2026-10-11 截图报障），三条左边缘也同在基线上。
          这里**不设宽度上限**：自动化页与其他六页一样铺满主区（2026-10-11 截图对照后就定了）。 */}
      <div className={`${PAGE_INSET_X} flex min-h-0 flex-1 flex-col`}>
        {/* Header —— 形状对齐其余六页：返回键与标题同行，h1 + 副标题 */}
        <header className="flex items-center justify-between gap-4 py-3">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              type="button"
              onClick={() => setShowSchedule(false)}
              aria-label={t("common.back")}
              className="p-1.5 -ml-1.5 rounded-lg hover:bg-hover-surface transition-colors h-auto"
            >
              <ArrowLeft className="w-5 h-5 text-muted-foreground" />
            </Button>
            <div>
              <h1 className="text-xl font-semibold text-foreground">
                {t("sidebar.automation")}
              </h1>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {t("schedule.viewDesc")}
              </p>
            </div>
          </div>
        </header>

        {/* Toolbar */}
        <ScheduleToolbar
          view={view}
          currentDate={currentDate}
          onViewChange={setView}
          onNavigatePrev={() => navigate(-1)}
          onNavigateNext={() => navigate(1)}
          onToday={goToday}
          onCreateClick={handleCreateClick}
        />

        {/* Calendar —— 与页头、工具栏共用同一个盒 */}
        <div className="flex-1 min-h-0 overflow-hidden">
          <ScheduleCalendar
            tasks={tasks}
            view={view}
            currentDate={currentDate}
            onSlotClick={handleSlotClick}
            onTaskClick={handleTaskClick}
          />
        </div>
      </div>

      {/* Edit Modal */}
      {modalOpen && (
        <ScheduleEditModal
          task={editingTask}
          workingDir={workingDir}
          prefillDate={prefillDate}
          prefillTime={prefillTime}
          onClose={handleCloseModal}
          onSaved={handleSaved}
          onRestoreFocus={() => rootRef.current?.focus({ preventScroll: true })}
        />
      )}
    </div>
  );
}
