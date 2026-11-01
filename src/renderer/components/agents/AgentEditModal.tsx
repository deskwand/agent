import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Folder, Shuffle, X } from "lucide-react";
import type { PersistentAgentView } from "../../../shared/persistent-agent";
import { useAppStore } from "../../store";
import { usePersistentAgentStore } from "../../store/persistent-agents";
import type { ClientEvent } from "../../types";
import { Button } from "../app-button";
import { TimePicker } from "../TimePicker";
import { PartnerAvatar } from "./PartnerAvatar";
import { OccludingDialog } from "../ui/occluding-dialog";
import { DialogClose, DialogContent, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import {
  DEFAULT_AGENT_SCHEDULE_FORM,
  fromAgentScheduleConfig,
  toAgentScheduleConfig,
  type AgentScheduleFormState,
  type AgentWeekday,
} from "./agent-schedule-form";

interface AgentEditModalProps {
  /** 不传 = 新建。 */
  agent?: PersistentAgentView;
  onClose: () => void;
}

const WEEKDAYS: AgentWeekday[] = [1, 2, 3, 4, 5, 6, 0];
const WEEKDAY_KEYS: Record<AgentWeekday, string> = {
  0: "schedule.weekdaySunday",
  1: "schedule.weekdayMonday",
  2: "schedule.weekdayTuesday",
  3: "schedule.weekdayWednesday",
  4: "schedule.weekdayThursday",
  5: "schedule.weekdayFriday",
  6: "schedule.weekdaySaturday",
};

const FIELD_LABEL = "text-xs font-medium text-muted-foreground";
const SEGMENT =
  "flex-1 py-1.5 text-xs font-medium rounded-md transition-colors h-auto";

export function AgentEditModal({ agent, onClose }: AgentEditModalProps) {
  const { t } = useTranslation();
  const workingDir = useAppStore((s) => s.workingDir);
  const removeSession = useAppStore((s) => s.removeSession);
  const upsert = usePersistentAgentStore((s) => s.upsert);
  const [name, setName] = useState(agent?.name ?? "");
  const [avatarSeed, setAvatarSeed] = useState(
    () => agent?.avatarSeed ?? crypto.randomUUID(),
  );
  const [instructions, setInstructions] = useState(agent?.instructions ?? "");
  const [cwd, setCwd] = useState(agent?.cwd ?? workingDir ?? "");
  const [schedule, setSchedule] = useState<AgentScheduleFormState>(
    agent
      ? fromAgentScheduleConfig(agent.schedule)
      : DEFAULT_AGENT_SCHEDULE_FORM,
  );
  const [wakeImmediately, setWakeImmediately] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteSession, setDeleteSession] = useState(false);

  const patchSchedule = (patch: Partial<AgentScheduleFormState>) =>
    setSchedule((prev) => ({ ...prev, ...patch }));

  const pickFolder = async () => {
    const event: ClientEvent = { type: "folder.select", payload: {} };
    const picked = await window.electronAPI.invoke<string | null>(event);
    if (picked) setCwd(picked);
  };

  const save = async () => {
    const config = toAgentScheduleConfig(schedule);
    if (!name.trim() || !instructions.trim() || !cwd.trim()) {
      setError(t("persistentAgents.form.required"));
      return;
    }
    if (!config) {
      setError(t("persistentAgents.form.invalidSchedule"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = agent
        ? await window.electronAPI.persistentAgents.update(agent.id, {
            name,
            instructions,
            schedule: config,
            avatarSeed,
          })
        : await window.electronAPI.persistentAgents.create({
            name,
            instructions,
            cwd,
            schedule: config,
            wakeImmediately,
            avatarSeed,
          });
      if (saved) upsert(saved);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!agent) return;
    setSaving(true);
    try {
      await window.electronAPI.persistentAgents.delete(agent.id, {
        deleteSession,
      });
      if (deleteSession) removeSession(agent.sessionId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  return (
    <OccludingDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="w-[calc(100%-2rem)] max-w-lg max-h-[85vh] overflow-y-auto bg-card rounded-xl sm:rounded-xl shadow-xl border border-border p-0 gap-0 [&>button]:hidden"
        aria-describedby={undefined}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/60">
          <DialogTitle className="text-sm font-semibold text-foreground">
            {agent
              ? t("persistentAgents.form.editTitle")
              : t("persistentAgents.form.createTitle")}
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

        {confirmDelete ? (
          <div className="px-5 py-6 space-y-3">
            <p className="text-sm font-medium text-foreground">
              {t("persistentAgents.delete.title", { name: agent?.name })}
            </p>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={deleteSession}
                onChange={(e) => setDeleteSession(e.target.checked)}
              />
              {t("persistentAgents.delete.alsoSession")}
            </label>
          </div>
        ) : (
          <div className="px-5 py-4 space-y-4">
            <div className="flex items-center gap-3" data-avatar-preview>
              <PartnerAvatar seed={avatarSeed} size={48} />
              <Button
                variant="ghost"
                type="button"
                onClick={() => setAvatarSeed(crypto.randomUUID())}
                className="h-auto gap-1.5 px-2 py-1 text-xs text-muted-foreground"
              >
                <Shuffle className="h-3.5 w-3.5" />
                {t("persistentAgents.form.shuffleAvatar")}
              </Button>
            </div>
            <div className="space-y-1">
              <label className={FIELD_LABEL} htmlFor="agent-name">
                {t("persistentAgents.form.name")}
              </label>
              <Input
                id="agent-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className={FIELD_LABEL} htmlFor="agent-instructions">
                {t("persistentAgents.form.instructions")}
              </label>
              <Textarea
                id="agent-instructions"
                rows={5}
                value={instructions}
                placeholder={t("persistentAgents.form.instructionsPlaceholder")}
                onChange={(e) => setInstructions(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <span className={FIELD_LABEL}>
                {t("persistentAgents.form.workspace")}
              </span>
              <Button
                variant="outline"
                type="button"
                // 工作目录绑定在会话上，建好后不能改
                disabled={Boolean(agent)}
                onClick={() => void pickFolder()}
                className="w-full justify-start gap-2 text-xs h-9"
              >
                <Folder className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">
                  {cwd || t("persistentAgents.form.pickWorkspace")}
                </span>
              </Button>
            </div>
            <div className="space-y-2">
              <span className={FIELD_LABEL}>
                {t("persistentAgents.form.schedule")}
              </span>
              <div className="flex gap-1 bg-muted rounded-lg p-0.5 border border-border">
                {(["interval", "daily", "weekly"] as const).map((mode) => (
                  <Button
                    variant="ghost"
                    key={mode}
                    type="button"
                    onClick={() => patchSchedule({ mode })}
                    className={`${SEGMENT} ${
                      schedule.mode === mode
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground"
                    }`}
                  >
                    {t(`persistentAgents.form.mode.${mode}`)}
                  </Button>
                ))}
              </div>
              {schedule.mode === "interval" ? (
                <>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{t("persistentAgents.form.every")}</span>
                    <Input
                      type="number"
                      min={1}
                      aria-label={t("persistentAgents.form.every")}
                      className="w-20"
                      value={schedule.every}
                      onChange={(e) =>
                        patchSchedule({ every: Number(e.target.value) })
                      }
                    />
                    <select
                      aria-label={t("persistentAgents.form.unit")}
                      className="h-9 rounded-md border border-border bg-background px-2 text-xs text-foreground"
                      value={schedule.unit}
                      onChange={(e) =>
                        patchSchedule({
                          unit: e.target
                            .value as AgentScheduleFormState["unit"],
                        })
                      }
                    >
                      {(["minute", "hour", "day"] as const).map((unit) => (
                        <option key={unit} value={unit}>
                          {t(`persistentAgents.form.units.${unit}`)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("persistentAgents.form.intervalHint")}
                  </p>
                </>
              ) : (
                <>
                  {schedule.mode === "weekly" && (
                    <div className="flex flex-wrap gap-1">
                      {WEEKDAYS.map((day) => {
                        const on = schedule.weekdays.includes(day);
                        return (
                          <Button
                            variant="ghost"
                            key={day}
                            type="button"
                            aria-pressed={on}
                            onClick={() =>
                              patchSchedule({
                                weekdays: on
                                  ? schedule.weekdays.filter((d) => d !== day)
                                  : [...schedule.weekdays, day],
                              })
                            }
                            className={`px-2 py-1 text-xs rounded-md border h-auto ${
                              on
                                ? "border-primary bg-primary/10 text-primary-text"
                                : "border-border text-muted-foreground"
                            }`}
                          >
                            {t(WEEKDAY_KEYS[day])}
                          </Button>
                        );
                      })}
                    </div>
                  )}
                  <TimePicker
                    selected={schedule.times}
                    onChange={(next) =>
                      setSchedule((prev) => ({
                        ...prev,
                        times:
                          typeof next === "function" ? next(prev.times) : next,
                      }))
                    }
                  />
                </>
              )}
            </div>
            {!agent && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={wakeImmediately}
                  onChange={(e) => setWakeImmediately(e.target.checked)}
                />
                {t("persistentAgents.form.wakeImmediately")}
              </label>
            )}
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="mx-5 mb-3 px-3 py-2 text-xs rounded-lg bg-destructive/10 text-destructive"
          >
            {error}
          </div>
        )}

        <div className="flex items-center gap-2 px-5 py-3 border-t border-border/60">
          {agent && !confirmDelete && (
            <Button
              variant="ghost"
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="text-xs text-destructive h-auto px-2 py-2"
            >
              {t("persistentAgents.delete.action")}
            </Button>
          )}
          <div className="flex-1" />
          <Button
            variant="ghost"
            type="button"
            onClick={() =>
              confirmDelete ? setConfirmDelete(false) : onClose()
            }
            className="px-4 py-2 text-xs font-medium rounded-lg border border-border text-muted-foreground hover:bg-hover-surface h-auto"
          >
            {t("common.cancel")}
          </Button>
          <Button
            variant={confirmDelete ? "destructive" : "default"}
            type="button"
            disabled={saving}
            onClick={() => void (confirmDelete ? remove() : save())}
            className="px-4 py-2 text-xs font-medium rounded-lg h-auto"
          >
            {confirmDelete
              ? t("persistentAgents.delete.confirm")
              : agent
                ? t("common.save")
                : t("persistentAgents.form.create")}
          </Button>
        </div>
      </DialogContent>
    </OccludingDialog>
  );
}
