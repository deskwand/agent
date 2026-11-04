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
      {/* 「+」放在标题按钮外面：不嵌套 button，点它也不会触发折叠。
          hover-only：三个入口（新会话在项目里 / 新建项目 / 打开项目）不是常驻操作，
          常驻会跟上面那行放大镜抢注意力，也让 Bot 一行看着比「最近」「项目」重。
          `pointer-events-none` 只为挡住不可见的点击面；键盘 Tab 到它时靠
          `group-focus-within` 浮出（否则就成了只对鼠标可见的功能 ✗）。 */}
      <div className="group/bot flex items-center">
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
        {/* 与上面那颗放大镜同档（32×32 命中区、同一条右缘）：右缘对齐 + 同宽，
            图标中心才落在同一条竖线上。 */}
        <Button
          variant="ghost"
          type="button"
          aria-label={t("persistentAgents.create")}
          onClick={onCreate}
          className="h-8 w-8 shrink-0 p-0 text-muted-foreground opacity-0 pointer-events-none transition-opacity group-hover/bot:opacity-100 group-hover/bot:pointer-events-auto group-focus-within/bot:opacity-100 group-focus-within/bot:pointer-events-auto hover:bg-hover-surface hover:text-foreground"
        >
          <Plus className="h-4 w-4" />
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
