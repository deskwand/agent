import { LayoutList, RefreshCw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../store";
import { useIsSessionRunning } from "../../store/selectors";
import { useRepoSummary } from "../../hooks/use-repo-summary";
import { Button } from "../app-button";
import { BackgroundTasksSection } from "./BackgroundTasksSection";
import { ChangesSection } from "./ChangesSection";
import { ContextSection } from "./ContextSection";
import { EnvironmentSection } from "./EnvironmentSection";
import { OutputsSection } from "./OutputsSection";

/**
 * 会话概览右栏。作为 rightPanelMode = "overview" 的内容使用；
 * `visible` 只控制数据刷新（槽位收起时 App 用 hidden 保活，不能继续轮询）。
 */
export function SessionOverviewPanel({ visible }: { visible: boolean }) {
  const { t } = useTranslation();
  const toggleOverview = useAppStore((s) => s.toggleOverview);
  const cwd = useAppStore((s) => {
    const sid = s.activeSessionId;
    if (!sid) return null;
    return s.sessions.find((session) => session.id === sid)?.cwd ?? null;
  });
  const isRunning = useIsSessionRunning();
  const repo = useRepoSummary(cwd, {
    visible,
    refetchKey: isRunning ? "running" : "idle",
  });

  return (
    <div className="flex h-full w-full min-w-0 flex-1 flex-col bg-background">
      <div className="flex shrink-0 items-center gap-2 border-b border-border/20 px-4 py-2">
        <LayoutList className="w-4 h-4 text-primary-text" />
        <span className="text-sm font-medium text-foreground">
          {t("overview.title")}
        </span>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="iconXs"
          onClick={repo.refresh}
          aria-label={t("overview.refresh")}
          className="rounded flex items-center justify-center hover:bg-hover-surface text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${repo.isLoading ? "animate-spin" : ""}`}
          />
        </Button>
        <Button
          variant="ghost"
          size="iconSm"
          onClick={toggleOverview}
          aria-label={t("overview.close")}
          className="rounded flex items-center justify-center hover:bg-hover-surface text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        <EnvironmentSection cwd={cwd} repo={repo} />
        <ContextSection />
        <OutputsSection />
        <ChangesSection cwd={cwd} repo={repo} />
        <BackgroundTasksSection />
      </div>
    </div>
  );
}
