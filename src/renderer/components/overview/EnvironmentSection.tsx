import { Folder, GitBranch, Monitor } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../store";
import { useAppConfig, useSandboxSetupState } from "../../store/selectors";
import type { RepoSummaryResult } from "../../hooks/use-repo-summary";
import { OverviewSection } from "./OverviewSection";

function Row({
  icon,
  label,
  value,
  title,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  title?: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 truncate text-right text-xs text-foreground">
        {value}
      </span>
    </>
  );

  if (!onClick) {
    return (
      <div className="flex items-center gap-2 px-1 py-0.5" title={title}>
        {content}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-accent"
    >
      {content}
    </button>
  );
}

export function EnvironmentSection({
  cwd,
  repo,
}: {
  cwd: string | null;
  repo: RepoSummaryResult;
}) {
  const { t } = useTranslation();
  const appConfig = useAppConfig();
  const { isComplete } = useSandboxSetupState();
  const toggleFileBrowser = useAppStore((s) => s.toggleFileBrowser);
  const openReview = useAppStore((s) => s.openReview);

  const sandboxed = appConfig?.sandboxEnabled !== false && isComplete;
  const folderName = cwd
    ? (cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd)
    : null;
  const branchLabel = !cwd
    ? "—"
    : repo.isLoading && !repo.summary
      ? "…"
      : repo.error
        ? t("overview.env.readFailed")
        : repo.summary?.isRepo
          ? (repo.summary.branch ?? "—")
          : t("overview.env.notRepo");
  const canOpenReview = Boolean(cwd && repo.summary?.isRepo);

  return (
    <OverviewSection titleKey="overview.env.title">
      <Row
        icon={<Monitor className="w-3.5 h-3.5" />}
        label={t("overview.env.location")}
        value={sandboxed ? t("overview.env.sandbox") : t("overview.env.local")}
      />
      <Row
        icon={<Folder className="w-3.5 h-3.5" />}
        label={t("overview.env.folder")}
        value={folderName ?? t("overview.env.noFolder")}
        title={cwd ?? undefined}
        onClick={cwd ? toggleFileBrowser : undefined}
      />
      <Row
        icon={<GitBranch className="w-3.5 h-3.5" />}
        label={t("overview.env.branch")}
        value={branchLabel}
        onClick={canOpenReview ? openReview : undefined}
      />
    </OverviewSection>
  );
}
