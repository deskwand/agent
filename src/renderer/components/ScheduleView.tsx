/**
 * @module renderer/components/ScheduleView
 *
 * Calendar-first schedule view with toolbar, day/week/month views,
 * and a modal for create/edit. Falls back gracefully when electronAPI is absent.
 */

import { useState, useEffect, useCallback } from "react";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../store";
import type { ScheduleTask } from "../types";
import { ScheduleToolbar } from "./ScheduleToolbar";
import { ScheduleCalendar, type CalendarView } from "./ScheduleCalendar";
import { ScheduleEditModal } from "./ScheduleEditModal";

export function ScheduleView() {
  const { t } = useTranslation();
  const setShowSchedule = useAppStore((s) => s.setShowSchedule);
  const workingDir = useAppStore((s) => s.workingDir) || "";

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
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-background">
      {/* Header */}
      <div className="bg-background/88 backdrop-blur-sm border-b border-border-subtle px-5 py-4 lg:px-8">
        <button
          onClick={() => setShowSchedule(false)}
          className="mb-1 p-1 -ml-1 rounded-lg hover:bg-surface-hover transition-colors inline-flex"
        >
          <ArrowLeft className="w-5 h-5 text-text-secondary" />
        </button>
        <p className="text-xs uppercase tracking-[0.16em] text-text-muted">
          DeskWand
        </p>
        <h2 className="mt-0.5 text-lg font-semibold text-text-primary">
          {t("sidebar.automation")}
        </h2>
        <p className="mt-0.5 text-xs leading-5 text-text-secondary">
          {t("schedule.viewDesc")}
        </p>
      </div>

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

      {/* Calendar */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <ScheduleCalendar
          tasks={tasks}
          view={view}
          currentDate={currentDate}
          onSlotClick={handleSlotClick}
          onTaskClick={handleTaskClick}
        />
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
        />
      )}
    </div>
  );
}
