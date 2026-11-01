import { useEffect } from "react";
import { Bot, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../store";
import { usePersistentAgentStore } from "../../store/persistent-agents";
import { formatAgentStatus } from "../../utils/persistent-agent-status";
import { Button } from "../app-button";

interface AgentSidebarGroupProps {
  activeSessionId: string | null;
  onOpenSession: (sessionId: string) => void;
  onCreate: () => void;
}

/** 侧边栏「智能体」分组：每个常驻智能体一行，点开就是它的永久会话。 */
export function AgentSidebarGroup({
  activeSessionId,
  onOpenSession,
  onCreate,
}: AgentSidebarGroupProps) {
  const { t } = useTranslation();
  const agents = usePersistentAgentStore((s) => s.agents);
  const setAll = usePersistentAgentStore((s) => s.setAll);

  // 首次挂载拉一次全量，之后靠主进程推的 persistent-agent.* 事件
  useEffect(() => {
    if (typeof window === "undefined" || !window.electronAPI) return;
    window.electronAPI.persistentAgents
      .list()
      .then(setAll)
      .catch(() => undefined);
  }, [setAll]);
  const sessions = useAppStore((s) => s.sessions);
  const list = Object.values(agents).sort((a, b) => a.createdAt - b.createdAt);
  const now = Date.now();

  return (
    <section className="pb-1.5">
      <div className="flex items-center gap-2 rounded-lg px-3 py-1 text-[0.8125rem] leading-5 text-muted-foreground">
        <Bot className="w-4 h-4" aria-hidden="true" />
        <span className="flex-1">{t("persistentAgents.title")}</span>
        <Button
          variant="ghost"
          type="button"
          aria-label={t("persistentAgents.create")}
          onClick={onCreate}
          className="h-5 w-5 p-0 text-muted-foreground"
        >
          <Plus className="w-3.5 h-3.5" />
        </Button>
      </div>
      {list.map((agent) => {
        const running =
          sessions.find((s) => s.id === agent.sessionId)?.status === "running";
        const dot =
          agent.status === "error"
            ? "bg-destructive"
            : agent.status === "paused"
              ? "bg-muted-foreground"
              : "bg-success";
        return (
          <button
            key={agent.id}
            type="button"
            data-agent-row={agent.id}
            onClick={() => onOpenSession(agent.sessionId)}
            className={`w-full rounded-lg px-3 py-1.5 flex items-center gap-2 text-left hover:bg-hover-surface transition-colors ${
              activeSessionId === agent.sessionId ? "bg-hover-surface" : ""
            }`}
          >
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`}
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{agent.name}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {formatAgentStatus(agent, running, t, now, false)}
              </span>
            </span>
          </button>
        );
      })}
    </section>
  );
}
