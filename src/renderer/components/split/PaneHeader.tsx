import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Columns2, Rows2, X } from "lucide-react";
import { Button } from "../app-button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../app-tooltip";
import { usePaneSession } from "./pane-context";
import { useSplitRectsStore } from "./split-rects-context";
import {
  usePendingPermissionsForSession,
  usePendingSudoForSession,
} from "../../store/selectors";
import { useSplitLayoutStore } from "../../store/split-layout";
import { canSplit, type PaneId, type SplitDir } from "../../store/split-tree";

type PaneStatus = "running" | "awaitingPermission" | "done" | "error" | null;

export function PaneHeader({
  paneId,
  sessionId,
}: {
  paneId: PaneId;
  sessionId: string | null;
}) {
  const { t } = useTranslation();
  const session = usePaneSession();
  const rect = useSplitRectsStore((s) => s.rects.get(paneId));
  const root = useSplitLayoutStore((s) => s.root);
  const splitPane = useSplitLayoutStore((s) => s.splitPane);
  const closePane = useSplitLayoutStore((s) => s.closePane);
  const hasPermission = usePendingPermissionsForSession(sessionId).length > 0;
  const hasSudo = usePendingSudoForSession(sessionId).length > 0;

  let status: PaneStatus = null;
  if (hasPermission || hasSudo) status = "awaitingPermission";
  else if (session?.status === "running") status = "running";
  else if (session?.status === "error") status = "error";
  else if (session?.status === "completed") status = "done";

  const splitState = (dir: SplitDir) => {
    if (!rect) return { disabled: true, tip: t("split.notEnoughSpace") };
    const check = canSplit(root, rect, dir);
    if (check.ok) return { disabled: false, tip: undefined };
    return {
      disabled: true,
      tip:
        check.reason === "limit"
          ? t("split.limitReached")
          : t("split.notEnoughSpace"),
    };
  };
  const right = splitState("row");
  const down = splitState("column");

  return (
    <div
      role="toolbar"
      className="flex h-8 shrink-0 items-center gap-2 border-b border-border/40 px-3 text-xs text-muted-foreground"
    >
      <span className="min-w-0 flex-1 truncate">
        {session?.title ?? t("sidebar.newChat")}
      </span>
      {status && (
        <span
          data-status={status}
          className={`shrink-0 rounded-full px-2 py-0.5 ${
            status === "awaitingPermission"
              ? "bg-warning/10 text-warning"
              : status === "error"
                ? "bg-destructive/10 text-destructive"
                : "bg-muted text-muted-foreground"
          }`}
        >
          {t(`split.status.${status}`)}
        </span>
      )}
      <HeaderButton
        label={t("split.splitRight")}
        tip={right.tip ?? t("split.splitRight")}
        disabled={right.disabled}
        onClick={() => splitPane(paneId, "row", "after")}
      >
        <Columns2 className="h-3.5 w-3.5" />
      </HeaderButton>
      <HeaderButton
        label={t("split.splitDown")}
        tip={down.tip ?? t("split.splitDown")}
        disabled={down.disabled}
        onClick={() => splitPane(paneId, "column", "after")}
      >
        <Rows2 className="h-3.5 w-3.5" />
      </HeaderButton>
      <HeaderButton
        label={t("split.closePane")}
        tip={t("split.closePane")}
        onClick={() => closePane(paneId)}
      >
        <X className="h-3.5 w-3.5" />
      </HeaderButton>
    </div>
  );
}

/** 带气泡的图标按钮；禁用时由外层 span 承接悬停，气泡才能说明原因。 */
function HeaderButton({
  label,
  tip,
  disabled,
  onClick,
  children,
}: {
  label: string;
  tip: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <Button
            variant="ghost"
            size="iconXs"
            type="button"
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
          >
            {children}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom">{tip}</TooltipContent>
    </Tooltip>
  );
}
