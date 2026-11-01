import { useEffect } from "react";
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../store";
import { usePersistentAgentStore } from "../../store/persistent-agents";
import { formatAgentStatus } from "../../utils/persistent-agent-status";
import { Button } from "../app-button";
import { PartnerAvatar } from "./PartnerAvatar";
import {
  SidebarAnimatedSection,
  SidebarGroupIcon,
} from "../sidebar-disclosure-motion";

interface AgentSidebarGroupProps {
  activeSessionId: string | null;
  expanded: boolean;
  motionVersion: number;
  onToggle: () => void;
  onOpenSession: (sessionId: string) => void;
  onCreate: () => void;
}

/**
 * 侧边栏「伙伴」分组：每个常驻智能体一行，点开就是它的永久会话。
 * 折叠状态由 Sidebar 统一管理（与「最近」「项目」同一套机制）。
 */
export function AgentSidebarGroup({
  activeSessionId,
  expanded,
  motionVersion,
  onToggle,
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
      {/* 「+」放在标题按钮外面：不嵌套 button，点它也不会触发折叠 */}
      <div className="flex items-center">
        <Button
          variant="ghost"
          type="button"
          aria-expanded={expanded}
          aria-label={t(
            expanded ? "persistentAgents.collapse" : "persistentAgents.expand",
          )}
          onClick={onToggle}
          className="flex-1 rounded-lg px-3 py-1 flex items-center gap-2 text-[0.8125rem] font-normal leading-5 text-muted-foreground hover:bg-hover-surface transition-colors h-auto"
        >
          <SidebarGroupIcon
            kind="partners"
            expanded={expanded}
            motionVersion={motionVersion}
          />
          <span>{t("persistentAgents.title")}</span>
        </Button>
        <Button
          variant="ghost"
          type="button"
          aria-label={t("persistentAgents.create")}
          onClick={onCreate}
          className="h-6 w-6 shrink-0 p-0 text-muted-foreground"
        >
          <Plus className="w-3.5 h-3.5" />
        </Button>
      </div>
      <SidebarAnimatedSection expanded={expanded} motionVersion={motionVersion}>
        {list.map((agent) => {
          const running =
            sessions.find((s) => s.id === agent.sessionId)?.status ===
            "running";
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
              <span className="relative shrink-0">
                <PartnerAvatar seed={agent.avatarSeed} size={24} />
                <span
                  data-agent-status-dot
                  className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-2 ring-muted ${dot}`}
                  aria-hidden="true"
                />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{agent.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {formatAgentStatus(agent, running, t, now, false)}
                </span>
              </span>
            </button>
          );
        })}
      </SidebarAnimatedSection>
    </section>
  );
}
