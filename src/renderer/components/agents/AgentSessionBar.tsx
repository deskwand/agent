import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlarmClock, Pause, Play, Settings, X, Zap } from "lucide-react";
import type { PersistentAgentWakeup } from "../../../shared/persistent-agent";
import { useAppStore } from "../../store";
import { usePersistentAgentStore } from "../../store/persistent-agents";
import {
  formatAgentStatus,
  formatWakeTime,
} from "../../utils/persistent-agent-status";
import { Button } from "../app-button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { AgentEditModal } from "./AgentEditModal";

const ICON_BUTTON =
  "h-6 w-6 p-0 text-muted-foreground hover:text-foreground hover:bg-hover-surface";

/** 常驻智能体会话头部：状态 + 预约 / 立即唤醒 / 暂停恢复 / 设置。非智能体会话渲染 null。 */
export function AgentSessionBar({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation();
  const agent = usePersistentAgentStore((s) =>
    Object.values(s.agents).find((a) => a.sessionId === sessionId),
  );
  const upsert = usePersistentAgentStore((s) => s.upsert);
  const setGlobalNotice = useAppStore((s) => s.setGlobalNotice);
  const running = useAppStore(
    (s) => s.sessions.find((x) => x.id === sessionId)?.status === "running",
  );
  const [wakeups, setWakeups] = useState<PersistentAgentWakeup[]>([]);
  const [editing, setEditing] = useState(false);
  if (!agent) return null;

  const api = window.electronAPI.persistentAgents;
  const fail = (error: unknown) =>
    setGlobalNotice({
      id: `notice-agent-${Date.now()}`,
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  const apply = (call: Promise<typeof agent | null>): void => {
    call
      .then((next) => {
        if (next) upsert(next);
      })
      .catch(fail);
  };
  const paused = agent.status === "paused";

  return (
    <span className="titlebar-no-drag inline-flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
      <span className="truncate" data-agent-status>
        {formatAgentStatus(agent, running, t, Date.now())}
      </span>
      <Popover
        onOpenChange={(open) => {
          if (open) api.listWakeups(agent.id).then(setWakeups).catch(fail);
        }}
      >
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            type="button"
            aria-label={t("persistentAgents.bar.wakeups")}
            className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground"
          >
            <AlarmClock className="h-3 w-3" />
            {agent.pendingWakeupCount}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 p-2 text-xs">
          {wakeups.length === 0 ? (
            <p className="px-1 py-2 text-muted-foreground">
              {t("persistentAgents.bar.noWakeups")}
            </p>
          ) : (
            wakeups.map((w) => (
              <div key={w.id} className="flex items-center gap-2 px-1 py-1">
                <span className="shrink-0 tabular-nums">
                  {formatWakeTime(w.runAt, Date.now())}
                </span>
                <span className="min-w-0 flex-1 truncate">{w.reason}</span>
                <Button
                  variant="ghost"
                  type="button"
                  aria-label={t("persistentAgents.bar.cancelWakeup")}
                  className={ICON_BUTTON}
                  onClick={() =>
                    api
                      .cancelWakeup(agent.id, w.id)
                      .then(() =>
                        setWakeups((prev) => prev.filter((x) => x.id !== w.id)),
                      )
                      .catch(fail)
                  }
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))
          )}
        </PopoverContent>
      </Popover>
      <Button
        variant="ghost"
        type="button"
        aria-label={t("persistentAgents.bar.wakeNow")}
        title={t("persistentAgents.bar.wakeNow")}
        className={ICON_BUTTON}
        disabled={paused}
        onClick={() => apply(api.wakeNow(agent.id))}
      >
        <Zap className="h-3 w-3" />
      </Button>
      <Button
        variant="ghost"
        type="button"
        aria-label={
          paused
            ? t("persistentAgents.bar.resume")
            : t("persistentAgents.bar.pause")
        }
        title={
          paused
            ? t("persistentAgents.bar.resume")
            : t("persistentAgents.bar.pause")
        }
        className={ICON_BUTTON}
        onClick={() =>
          apply(paused ? api.resume(agent.id) : api.pause(agent.id))
        }
      >
        {paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
      </Button>
      <Button
        variant="ghost"
        type="button"
        aria-label={t("persistentAgents.bar.settings")}
        title={t("persistentAgents.bar.settings")}
        className={ICON_BUTTON}
        onClick={() => setEditing(true)}
      >
        <Settings className="h-3 w-3" />
      </Button>
      {editing && (
        <AgentEditModal agent={agent} onClose={() => setEditing(false)} />
      )}
    </span>
  );
}
